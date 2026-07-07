#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
fast_colabfold_from_fasta.py

用途：
  从 fusion.fasta 中读取 >T{squeue} 序列，快速批量跑 ColabFold，并把结果保存成：
    backend/pdb_cache/cache/T6.pdb
    backend/pdb_cache/cache/T7.pdb
    ...

核心加速策略：
  1. 默认使用 --msa-mode single_sequence，跳过 MMseqs2 MSA 搜索，速度快很多；
  2. 自动按序列去重：完全相同的 FUSION_TRANSL 只预测一次，然后复制成多个 T*.pdb；
  3. 已存在 cache/T*.pdb 的编号自动跳过；
  4. 支持 --limit、--max-len 先小规模测试；
  5. 支持断点续跑。
"""

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from collections import defaultdict

VALID_AA = set("ACDEFGHIKLMNPQRSTVWY")


def clean_seq(seq: str) -> str:
    seq = (seq or "").strip().rstrip("*")
    seq = re.sub(r"\s+", "", seq).upper()
    return "".join(aa for aa in seq if aa in VALID_AA)


def read_fasta(path: Path):
    records = []
    name = None
    chunks = []

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith(">"):
                if name is not None:
                    seq = clean_seq("".join(chunks))
                    if seq:
                        records.append((name, seq))
                name = line[1:].strip().split()[0]
                chunks = []
            else:
                chunks.append(line)

    if name is not None:
        seq = clean_seq("".join(chunks))
        if seq:
            records.append((name, seq))

    return records


def write_fasta(records, path: Path):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for rid, seq in records:
            f.write(f">{rid}\n")
            for i in range(0, len(seq), 60):
                f.write(seq[i:i+60] + "\n")


def find_best_pdb(out_dir: Path, query_id: str):
    """
    ColabFold 输出名通常类似：
      T6_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_000.pdb
      T6_relaxed_rank_001_*.pdb
    这里优先找 rank_001 的 pdb。
    """
    patterns = [
        f"{query_id}*rank_001*.pdb",
        f"{query_id}*.pdb",
    ]
    for pat in patterns:
        hits = sorted(out_dir.glob(pat))
        if hits:
            # 如果有 relaxed，优先 relaxed；否则用第一个 rank_001
            relaxed = [p for p in hits if "relaxed" in p.name]
            if relaxed:
                return relaxed[0]
            return hits[0]
    return None


def chunk_list(items, size):
    for i in range(0, len(items), size):
        yield i // size + 1, items[i:i+size]


def run_cmd(cmd, log_path: Path, env):
    print("[RUN]", " ".join(map(str, cmd)))
    print("[LOG]", log_path)
    with open(log_path, "w", encoding="utf-8", errors="ignore") as log:
        log.write("COMMAND: " + " ".join(map(str, cmd)) + "\n\n")
        log.flush()
        proc = subprocess.Popen(
            cmd,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=env,
        )
        return proc.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fasta", required=True, help="输入 fusion.fasta")
    ap.add_argument("--cache-dir", required=True, help="最终 PDB 保存目录，如 backend/pdb_cache/cache")
    ap.add_argument("--work-dir", required=True, help="ColabFold 临时工作目录，建议放 Linux 目录，如 ~/fusion_colabfold_fast")
    ap.add_argument("--colabfold-cmd", default="colabfold_batch", help="colabfold_batch 完整路径")
    ap.add_argument("--batch-size", type=int, default=4, help="每批预测几个唯一序列；显存不够就设为 1")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 个唯一序列，用于测试；0 表示不限制")
    ap.add_argument("--max-len", type=int, default=0, help="跳过长度大于该值的序列；0 表示不限制")
    ap.add_argument("--min-len", type=int, default=10, help="跳过长度小于该值的序列")
    ap.add_argument("--overwrite", action="store_true", help="即使 T*.pdb 已存在也重新生成")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不运行 ColabFold")
    ap.add_argument(
        "--colabfold-args",
        default="--msa-mode single_sequence --num-recycle 1 --num-models 1 --num-relax 0",
        help="附加 ColabFold 参数。默认是快速 single_sequence 模式。"
    )
    args = ap.parse_args()

    fasta = Path(args.fasta).expanduser().resolve()
    cache_dir = Path(args.cache_dir).expanduser().resolve()
    work_dir = Path(args.work_dir).expanduser().resolve()

    cache_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"[INFO] fasta     = {fasta}")
    print(f"[INFO] cache_dir = {cache_dir}")
    print(f"[INFO] work_dir  = {work_dir}")

    raw_records = read_fasta(fasta)
    print(f"[INFO] fasta records = {len(raw_records)}")

    # 过滤长度、已有 PDB
    id_seq = []
    skipped_existing = 0
    skipped_length = 0
    skipped_badid = 0

    for rid, seq in raw_records:
        # 只保留类似 T6 / TP6 这样的 ID；不强制，但建议
        rid = rid.strip()
        if not rid:
            skipped_badid += 1
            continue

        if len(seq) < args.min_len:
            skipped_length += 1
            continue

        if args.max_len and len(seq) > args.max_len:
            skipped_length += 1
            continue

        pdb_path = cache_dir / f"{rid}.pdb"
        if pdb_path.exists() and pdb_path.stat().st_size > 100 and not args.overwrite:
            skipped_existing += 1
            continue

        id_seq.append((rid, seq))

    # 按序列去重
    seq_to_ids = defaultdict(list)
    for rid, seq in id_seq:
        seq_to_ids[seq].append(rid)

    unique_records = []
    for seq, ids in seq_to_ids.items():
        # 用第一个 ID 作为代表跑 ColabFold
        unique_records.append((ids[0], seq))

    # 长度从短到长跑，先快速得到一批容易成功的结果
    unique_records.sort(key=lambda x: len(x[1]))

    if args.limit and args.limit > 0:
        unique_records = unique_records[:args.limit]

    print(f"[INFO] skipped_existing = {skipped_existing}")
    print(f"[INFO] skipped_length   = {skipped_length}")
    print(f"[INFO] skipped_badid    = {skipped_badid}")
    print(f"[INFO] pending ids      = {len(id_seq)}")
    print(f"[INFO] unique sequences = {len(unique_records)}")
    if unique_records:
        lens = [len(s) for _, s in unique_records]
        print(f"[INFO] length range     = {min(lens)} - {max(lens)} aa")

    if args.dry_run:
        print("[DRY-RUN] 不运行 ColabFold。")
        return 0

    if not unique_records:
        print("[INFO] 没有需要预测的序列。")
        return 0

    # 设置低内存相关环境变量
    env = os.environ.copy()
    env.setdefault("XLA_PYTHON_CLIENT_PREALLOCATE", "false")
    env.setdefault("XLA_PYTHON_CLIENT_MEM_FRACTION", "0.60")
    env.setdefault("XLA_FLAGS", "--xla_gpu_force_compilation_parallelism=1")

    run_log_rows = []
    batch_size = max(1, args.batch_size)
    extra_args = args.colabfold_args.split() if args.colabfold_args else []

    for batch_idx, batch in chunk_list(unique_records, batch_size):
        batch_dir = work_dir / f"batch_{batch_idx:05d}"
        out_dir = batch_dir / "out"
        batch_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)

        batch_fasta = batch_dir / f"batch_{batch_idx:05d}.fasta"
        write_fasta(batch, batch_fasta)

        print(f"\n[INFO] batch_{batch_idx:05d}: {len(batch)} unique sequences")
        print(f"[INFO] length: {', '.join(str(len(seq)) for _, seq in batch)}")

        cmd = [args.colabfold_cmd, str(batch_fasta), str(out_dir)] + extra_args
        log_path = batch_dir / f"batch_{batch_idx:05d}.colabfold.log"
        code = run_cmd(cmd, log_path, env)

        if code != 0:
            print(f"[WARN] batch_{batch_idx:05d} failed, return code = {code}")

        # 收集并复制 PDB
        for rep_id, seq in batch:
            pdb = find_best_pdb(out_dir, rep_id)
            all_ids = seq_to_ids.get(seq, [rep_id])

            if pdb is None:
                print(f"[FAIL] {rep_id}: no PDB found")
                for rid in all_ids:
                    run_log_rows.append({
                        "id": rid,
                        "rep_id": rep_id,
                        "length": len(seq),
                        "status": "failed",
                        "source_pdb": "",
                        "target_pdb": str(cache_dir / f"{rid}.pdb"),
                        "return_code": code,
                    })
                continue

            for rid in all_ids:
                target = cache_dir / f"{rid}.pdb"
                if target.exists() and target.stat().st_size > 100 and not args.overwrite:
                    status = "exists_skip_after_dedup"
                else:
                    shutil.copy2(pdb, target)
                    status = "done"

                run_log_rows.append({
                    "id": rid,
                    "rep_id": rep_id,
                    "length": len(seq),
                    "status": status,
                    "source_pdb": str(pdb),
                    "target_pdb": str(target),
                    "return_code": code,
                })

            print(f"[OK] {rep_id} -> copied to {len(all_ids)} id(s)")

        # 每批写一次总日志，避免中途断掉没记录
        log_csv = work_dir / "fast_colabfold_from_fasta_log.csv"
        with open(log_csv, "w", encoding="utf-8-sig", newline="") as f:
            fieldnames = ["id", "rep_id", "length", "status", "source_pdb", "target_pdb", "return_code"]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(run_log_rows)

    print("\n✓ 全部完成")
    print(f"[INFO] log = {work_dir / 'fast_colabfold_from_fasta_log.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
