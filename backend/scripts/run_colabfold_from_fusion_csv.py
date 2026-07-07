#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch-run local ColabFold/AlphaFold2 for all valid FUSION_TRANSL entries in fusion.csv.

Input rule:
  - squeue = 1  -> output PDB: backend/pdb_cache/cache/T1.pdb
  - FUSION_TRANSL = '.' / empty / NA -> skip
  - FUSION_TRANSL may end with '*' -> '*' is removed before running

Recommended:
  conda activate colabfold310
  python backend/scripts/run_colabfold_from_fusion_csv.py \
    --fusion-csv backend/fusion.csv \
    --cache-dir backend/pdb_cache/cache \
    --work-dir backend/pdb_cache/colabfold_work \
    --batch-size 1
"""

from __future__ import annotations

import argparse
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd

VALID_AA = set("ACDEFGHIKLMNPQRSTVWY")
SKIP_VALUES = {"", ".", "NA", "N/A", "NONE", "NULL", "NAN"}


def find_column(df: pd.DataFrame, wanted: str) -> str:
    """Find a column ignoring case, leading/trailing spaces, and BOM."""
    norm_wanted = wanted.strip().lower()
    for col in df.columns:
        norm_col = str(col).strip().lstrip("\ufeff").lower()
        if norm_col == norm_wanted:
            return col
    raise ValueError(f"找不到列: {wanted}。当前列名为: {list(df.columns)}")


def normalize_squeue(value: object) -> str:
    """Convert squeue value to cache id, e.g. 1 / 1.0 -> T1."""
    s = "" if pd.isna(value) else str(value).strip()
    if not s:
        raise ValueError("squeue 为空")
    # Excel/CSV sometimes stores integer id as 1.0
    if re.fullmatch(r"\d+\.0", s):
        s = s.split(".", 1)[0]
    # Remove internal whitespace only; keep original id characters otherwise
    s = re.sub(r"\s+", "", s)
    return f"T{s}"


def clean_fusion_translation(value: object, drop_invalid: bool = True) -> Tuple[str, str, str, int]:
    """
    Clean FUSION_TRANSL.
    Returns: cleaned_seq, skip_reason, invalid_chars, raw_length
    """
    raw = "" if pd.isna(value) else str(value).strip()
    if raw.upper() in SKIP_VALUES:
        return "", "empty_or_dot", "", 0

    raw_len = len(raw)
    seq = raw.upper()
    # Remove common FASTA/CSV artifacts: whitespace, stop codon marker '*'
    seq = re.sub(r"\s+", "", seq)
    seq = seq.replace("*", "")

    invalid_chars = "".join(sorted({ch for ch in seq if ch not in VALID_AA}))
    if invalid_chars:
        if drop_invalid:
            seq = "".join(ch for ch in seq if ch in VALID_AA)
        else:
            return "", f"invalid_chars:{invalid_chars}", invalid_chars, raw_len

    if not seq:
        return "", "no_valid_amino_acid", invalid_chars, raw_len

    return seq, "", invalid_chars, raw_len


def write_fasta(records: List[Dict[str, object]], fasta_path: Path) -> None:
    fasta_path.parent.mkdir(parents=True, exist_ok=True)
    with fasta_path.open("w", encoding="utf-8") as f:
        for rec in records:
            protein_id = str(rec["protein_id"])
            seq = str(rec["sequence"])
            f.write(f">{protein_id}\n")
            for i in range(0, len(seq), 80):
                f.write(seq[i:i + 80] + "\n")


def chunks(items: List[Dict[str, object]], size: int) -> Iterable[List[Dict[str, object]]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]




def read_csv_flexible(csv_path: Path, encoding: Optional[str] = None) -> Tuple[pd.DataFrame, str]:
    """
    Read fusion.csv with automatic encoding fallback.
    Windows/Excel exported CSV files are often GBK/GB18030 instead of UTF-8.
    """
    encodings = [encoding] if encoding else [
        "utf-8-sig",
        "utf-8",
        "gb18030",
        "gbk",
        "cp936",
        "latin1",
    ]
    last_error: Optional[Exception] = None
    for enc in encodings:
        if not enc:
            continue
        try:
            df = pd.read_csv(csv_path, dtype=str, sep=None, engine="python", encoding=enc)
            return df, enc
        except UnicodeDecodeError as e:
            last_error = e
            continue
        except Exception as e:
            # If delimiter sniffing fails for a specific encoding, keep trying others.
            last_error = e
            continue
    raise RuntimeError(
        f"无法读取CSV文件: {csv_path}\n"
        f"尝试的编码: {encodings}\n"
        f"最后错误: {last_error}\n"
        "建议先用 --csv-encoding gb18030，或者把 fusion.csv 另存为 UTF-8 编码。"
    )

def find_best_pdb(out_dir: Path, protein_id: str) -> Optional[Path]:
    """Find the best-ranked PDB for one query id from a ColabFold output directory."""
    candidates = []
    # Use T1_*.pdb instead of T1*.pdb to avoid matching T10/T11.
    candidates.extend(out_dir.rglob(f"{protein_id}_*.pdb"))
    candidates.extend(out_dir.rglob(f"{protein_id}.pdb"))

    candidates = [p for p in candidates if p.is_file()]
    if not candidates:
        return None

    def sort_key(p: Path) -> Tuple[int, int, int, str]:
        name = p.name.lower()
        m = re.search(r"rank_0*([0-9]+)", name)
        rank = int(m.group(1)) if m else 999
        # If relaxed PDB exists, prefer relaxed rank 1; otherwise unrelaxed rank 1 is fine.
        relaxed_preference = 0 if re.search(r"(^|_)relaxed(_|$)", name) else 1
        return (rank, relaxed_preference, len(name), name)

    return sorted(candidates, key=sort_key)[0]


def run_colabfold_batch(
    colabfold_cmd: str,
    fasta_path: Path,
    out_dir: Path,
    log_file: Path,
    extra_args: str = "",
) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    cmd = [colabfold_cmd]
    if extra_args.strip():
        cmd.extend(shlex.split(extra_args))
    cmd.extend([str(fasta_path), str(out_dir)])

    print("\n[RUN]", " ".join(shlex.quote(x) for x in cmd))
    print(f"[LOG] {log_file}")

    with log_file.open("w", encoding="utf-8") as lf:
        lf.write("COMMAND: " + " ".join(shlex.quote(x) for x in cmd) + "\n\n")
        lf.flush()
        proc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, text=True)
    return proc.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local ColabFold for every valid FUSION_TRANSL in fusion.csv")
    parser.add_argument("--fusion-csv", required=True, help="fusion.csv 路径")
    parser.add_argument("--csv-encoding", default=None, help="fusion.csv 编码；不填则自动尝试 utf-8-sig/utf-8/gb18030/gbk/cp936/latin1")
    parser.add_argument("--dry-run", action="store_true", help="只检查CSV、清理序列并生成日志，不真正运行ColabFold")
    parser.add_argument("--cache-dir", required=True, help="PDB 最终缓存目录，例如 backend/pdb_cache/cache")
    parser.add_argument("--work-dir", default=None, help="ColabFold 中间结果目录，默认在 cache-dir 同级 colabfold_work")
    parser.add_argument("--squeue-col", default="squeue", help="编号列名，默认 squeue")
    parser.add_argument("--transl-col", default="FUSION_TRANSL", help="蛋白序列列名，默认 FUSION_TRANSL")
    parser.add_argument("--batch-size", type=int, default=1, help="每次提交给 colabfold_batch 的序列数；显存小建议 1")
    parser.add_argument("--max-aa", type=int, default=2000, help="超过该长度跳过；设为 0 表示不限制")
    parser.add_argument("--overwrite", action="store_true", help="若 T{id}.pdb 已存在，仍重新预测并覆盖")
    parser.add_argument("--keep-invalid", action="store_true", help="遇到非标准氨基酸字符时不自动删除，而是跳过该条")
    parser.add_argument("--colabfold-cmd", default="colabfold_batch", help="colabfold_batch 命令路径")
    parser.add_argument("--colabfold-args", default="", help="传给 colabfold_batch 的额外参数，例如 '--num-recycle 3 --model-type alphafold2_ptm'")
    args = parser.parse_args()

    fusion_csv = Path(args.fusion_csv).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    work_dir = Path(args.work_dir).resolve() if args.work_dir else cache_dir.parent / "colabfold_work"
    cache_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    if args.batch_size < 1:
        raise ValueError("--batch-size 必须 >= 1")

    print(f"[INFO] fusion_csv = {fusion_csv}")
    print(f"[INFO] cache_dir  = {cache_dir}")
    print(f"[INFO] work_dir   = {work_dir}")

    if not args.dry_run and shutil.which(args.colabfold_cmd) is None:
        print(f"[ERROR] 找不到 colabfold_batch 命令: {args.colabfold_cmd}", file=sys.stderr)
        print("[HINT] 先运行: which colabfold_batch", file=sys.stderr)
        print("[HINT] 如果命令在其他位置，请使用 --colabfold-cmd /完整路径/colabfold_batch", file=sys.stderr)
        return 127

    df, used_encoding = read_csv_flexible(fusion_csv, args.csv_encoding)
    print(f"[INFO] csv_encoding = {used_encoding}")
    df.columns = [str(c).strip().lstrip("\ufeff") for c in df.columns]

    squeue_col = find_column(df, args.squeue_col)
    transl_col = find_column(df, args.transl_col)

    records: List[Dict[str, object]] = []
    pending: List[Dict[str, object]] = []
    seen_ids = set()

    for idx, row in df.iterrows():
        rec: Dict[str, object] = {
            "row_index": idx + 2,  # +2 because CSV header is row 1
            "squeue": row.get(squeue_col, ""),
            "protein_id": "",
            "raw_length": 0,
            "clean_length": 0,
            "invalid_chars": "",
            "status": "",
            "message": "",
            "pdb_path": "",
        }

        try:
            protein_id = normalize_squeue(row[squeue_col])
            rec["protein_id"] = protein_id
        except Exception as e:
            rec["status"] = "skip"
            rec["message"] = f"bad_squeue: {e}"
            records.append(rec)
            continue

        seq, reason, invalid_chars, raw_len = clean_fusion_translation(
            row[transl_col],
            drop_invalid=not args.keep_invalid,
        )
        rec["raw_length"] = raw_len
        rec["clean_length"] = len(seq)
        rec["invalid_chars"] = invalid_chars

        if reason:
            rec["status"] = "skip"
            rec["message"] = reason
            records.append(rec)
            continue

        if args.max_aa and len(seq) > args.max_aa:
            rec["status"] = "skip"
            rec["message"] = f"too_long:{len(seq)}>{args.max_aa}"
            records.append(rec)
            continue

        target_pdb = cache_dir / f"{protein_id}.pdb"
        rec["pdb_path"] = str(target_pdb)

        if protein_id in seen_ids:
            rec["status"] = "skip"
            rec["message"] = "duplicate_squeue"
            records.append(rec)
            continue
        seen_ids.add(protein_id)

        if target_pdb.exists() and not args.overwrite:
            rec["status"] = "exists_skip"
            rec["message"] = "pdb already exists; use --overwrite to rerun"
            records.append(rec)
            continue

        rec["sequence"] = seq
        rec["status"] = "pending"
        pending.append(rec)
        records.append(rec)

    print(f"[INFO] total rows: {len(df)}")
    print(f"[INFO] pending predictions: {len(pending)}")
    print(f"[INFO] skipped/existing: {len(records) - len(pending)}")

    # Map protein_id -> record dict so we can update status after running.
    rec_by_id = {str(r["protein_id"]): r for r in records if r.get("protein_id")}

    if args.dry_run:
        log_csv = work_dir / "fusion_colabfold_run_log.csv"
        pd.DataFrame(records).drop(columns=["sequence"], errors="ignore").to_csv(
            log_csv, index=False, encoding="utf-8-sig"
        )
        status_counts = pd.Series([r.get("status", "") for r in records]).value_counts().to_dict()
        print("\n[DRY-RUN] status counts:", status_counts)
        print(f"[DRY-RUN] log csv: {log_csv}")
        print("[DRY-RUN] 未运行 ColabFold。确认 pending 数量无误后，去掉 --dry-run 再运行。")
        return 0

    start_time = time.time()
    for batch_no, batch in enumerate(chunks(pending, args.batch_size), start=1):
        batch_tag = f"batch_{batch_no:04d}"
        batch_dir = work_dir / batch_tag
        fasta_path = batch_dir / f"{batch_tag}.fasta"
        out_dir = batch_dir / "out"
        log_file = batch_dir / f"{batch_tag}.colabfold.log"

        write_fasta(batch, fasta_path)
        print(f"\n[INFO] {batch_tag}: {len(batch)} sequences -> {fasta_path}")

        return_code = run_colabfold_batch(
            args.colabfold_cmd,
            fasta_path,
            out_dir,
            log_file,
            args.colabfold_args,
        )

        if return_code != 0:
            print(f"[WARN] {batch_tag} colabfold_batch returned non-zero code: {return_code}")

        for item in batch:
            protein_id = str(item["protein_id"])
            rec = rec_by_id[protein_id]
            best_pdb = find_best_pdb(out_dir, protein_id)
            target_pdb = cache_dir / f"{protein_id}.pdb"
            if best_pdb and best_pdb.exists():
                shutil.copyfile(best_pdb, target_pdb)
                rec["status"] = "done"
                rec["message"] = f"copied from {best_pdb.name}"
                rec["pdb_path"] = str(target_pdb)
                print(f"[OK] {protein_id} -> {target_pdb}")
            else:
                rec["status"] = "failed"
                rec["message"] = f"no pdb found; see {log_file}; return_code={return_code}"
                print(f"[FAIL] {protein_id}: no PDB found")

        # Write progress after every batch.
        pd.DataFrame(records).drop(columns=["sequence"], errors="ignore").to_csv(
            work_dir / "fusion_colabfold_run_log.csv",
            index=False,
            encoding="utf-8-sig",
        )

    elapsed = time.time() - start_time
    log_csv = work_dir / "fusion_colabfold_run_log.csv"
    pd.DataFrame(records).drop(columns=["sequence"], errors="ignore").to_csv(
        log_csv,
        index=False,
        encoding="utf-8-sig",
    )

    status_counts = pd.Series([r.get("status", "") for r in records]).value_counts().to_dict()
    print("\n[DONE] status counts:", status_counts)
    print(f"[DONE] log csv: {log_csv}")
    print(f"[DONE] elapsed: {elapsed / 60:.1f} min")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[INTERRUPTED] user stopped the run", file=sys.stderr)
        raise SystemExit(130)
