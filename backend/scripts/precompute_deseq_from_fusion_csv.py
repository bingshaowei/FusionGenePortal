#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
precompute_deseq_from_fusion_csv.py

用途：
  从 backend/fusion.csv 读取 Fusion.Name 和 sample.name 两列；
  合并相同融合名的所有 sample.name（逗号分隔，自动去重）；
  用 backend/routes/data/raw_count 做 DESeq2；
  为每个融合生成一个 JSON，供网站后端直接读取。

推荐运行位置：
  cd /mnt/c/Users/15850/Desktop/fusion-gene-portal/backend

示例：
  python scripts/precompute_deseq_from_fusion_csv.py \
    --fusion-csv fusion.csv \
    --raw-count routes/data/raw_count \
    --out routes/data/precomputed_deseq
"""

import argparse
import json
import math
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd


# =========================
# 依赖检查：pyDESeq2
# =========================
try:
    from pydeseq2.dds import DeseqDataSet
    from pydeseq2.ds import DeseqStats
    HAS_PYDESEQ2 = True
except Exception:
    HAS_PYDESEQ2 = False


# =========================
# 工具函数
# =========================

def safe_fusion_name(fusion_name: str) -> str:
    """
    RUNX1--RUNX1T1 -> RUNX1__RUNX1T1.json
    其他不适合做文件名的字符统一替换成 _
    """
    s = str(fusion_name).strip().replace("--", "__")
    s = re.sub(r"[^A-Za-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "unknown_fusion"


def resolve_existing_path(path_like: str, extra_suffixes: Optional[List[str]] = None) -> Path:
    """
    允许用户传 routes/data/raw_count，也允许真实文件是 raw_count.csv / raw_count.xlsx 等。
    """
    p = Path(path_like)
    if p.exists():
        return p

    suffixes = extra_suffixes or ["", ".csv", ".tsv", ".txt", ".xlsx", ".xls"]
    for suf in suffixes:
        q = Path(str(p) + suf)
        if q.exists():
            return q

    raise FileNotFoundError(f"找不到文件：{path_like}；也没有找到这些后缀版本：{suffixes}")


# 常见文本表格编码。
# Windows/Excel 导出的中文 CSV 常见为 gbk/gb18030；UTF-8 文件也兼容。
CSV_ENCODINGS = ["utf-8-sig", "utf-8", "gb18030", "gbk", "latin1"]


def guess_csv_encoding(path: Path, sample_size: int = 1024 * 1024) -> str:
    """
    自动猜测 CSV/TSV/TXT 编码，避免 Windows 导出的 fusion.csv 触发 UnicodeDecodeError。

    说明：
    1. 先读取前 1MB 字节判断编码，避免把很大的 raw_count 一次性读入内存；
    2. 如果后面仍有少量异常字符，read_csv 会使用 encoding_errors='replace'，不再中断；
    3. 表头和样本名通常是英文/数字，所以少量中文乱码不会影响主要计算。
    """
    with open(path, "rb") as f:
        raw = f.read(sample_size)

    for enc in CSV_ENCODINGS:
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue

    # 理论上 latin1 总能兜底；这里保留一个最终兜底。
    return "latin1"


def read_table_auto(path: Path, index_col=None, usecols=None, chunksize=None) -> pd.DataFrame:
    """
    自动读取 csv/tsv/txt/xlsx/xls。
    对 csv/tsv/txt 会依次尝试 sep=None、tab、comma，并自动处理编码。
    """
    ext = path.suffix.lower()

    if ext in [".xlsx", ".xls"]:
        if chunksize is not None:
            # Excel 不支持 chunksize，直接读。fusion.csv 一般不是 Excel。
            return pd.read_excel(path, index_col=index_col, usecols=usecols)
        return pd.read_excel(path, index_col=index_col, usecols=usecols)

    # CSV/TSV/TXT 或者无后缀
    encoding = guess_csv_encoding(path)
    print(f"[ReadTable] {path} 使用编码：{encoding}")

    last_err = None
    for sep in [None, "\t", ","]:
        try:
            common_kwargs = dict(
                filepath_or_buffer=path,
                sep=sep,
                engine="python",
                usecols=usecols,
                encoding=encoding,
                encoding_errors="replace",
            )

            if chunksize is not None:
                return pd.read_csv(
                    **common_kwargs,
                    chunksize=chunksize,
                    dtype=str,
                    keep_default_na=False,
                )

            return pd.read_csv(
                **common_kwargs,
                index_col=index_col,
            )
        except Exception as e:
            last_err = e

    raise RuntimeError(f"读取表格失败：{path}\n最后错误：{last_err}")


def get_columns_auto(path: Path) -> List[str]:
    ext = path.suffix.lower()
    if ext in [".xlsx", ".xls"]:
        return list(pd.read_excel(path, nrows=0).columns)

    encoding = guess_csv_encoding(path)
    print(f"[ReadHeader] {path} 使用编码：{encoding}")

    last_err = None
    for sep in [None, "\t", ","]:
        try:
            return list(
                pd.read_csv(
                    path,
                    sep=sep,
                    engine="python",
                    nrows=0,
                    encoding=encoding,
                    encoding_errors="replace",
                ).columns
            )
        except Exception as e:
            last_err = e
    raise RuntimeError(f"无法读取表头：{path}\n最后错误：{last_err}")


def find_column(columns: Iterable[str], wanted: str, aliases: List[str]) -> str:
    """
    容忍大小写、空格、下划线、点号差异。
    """
    cols = list(columns)

    def norm(x: str) -> str:
        return re.sub(r"[\s._-]+", "", str(x).strip().lower())

    targets = [wanted] + aliases
    target_norms = {norm(x) for x in targets}

    for c in cols:
        if str(c).strip() in targets:
            return c

    for c in cols:
        if norm(c) in target_norms:
            return c

    raise KeyError(
        f"找不到列：{wanted}\n"
        f"可接受别名：{aliases}\n"
        f"当前表头前30列：{cols[:30]}"
    )


def split_sample_names(sample_cell) -> List[str]:
    """
    sample.name 里可能是：
      TARGET.20.A, TARGET.20.B
    需要拆开、去空格、去重。
    """
    if sample_cell is None:
        return []
    text = str(sample_cell).strip()
    if not text or text.lower() in ["nan", "none", "na", "n/a"]:
        return []

    # 中英文逗号都处理；分号也顺手处理
    parts = re.split(r"[,，;；]+", text)
    out = []
    seen = set()
    for p in parts:
        s = p.strip()
        if not s:
            continue
        if s not in seen:
            out.append(s)
            seen.add(s)
    return out


def normalize_sample_name(name: str) -> str:
    """
    和后端 match_sample_names 的逻辑保持接近：
    TARGET-20-XXX / TARGET.20.XXX / TARGET_20_XXX 都能互相匹配。
    注意 TARGET.20.PADYIR.09A 和 TARGET.20.PADYIR.09A.1 会变成不同 key，不会混掉。
    """
    return str(name).replace("-", "_").replace(".", "_").upper()


def match_sample_names(fusion_samples: List[str], matrix_columns: Iterable[str]) -> List[str]:
    matrix_columns = list(matrix_columns)
    matrix_map = {normalize_sample_name(col): col for col in matrix_columns}

    matched = []
    seen = set()

    for sample in fusion_samples:
        norm = normalize_sample_name(sample)

        # 先精确匹配
        if norm in matrix_map:
            col = matrix_map[norm]
            if col not in seen:
                matched.append(col)
                seen.add(col)
            continue

        # 再做保守的部分匹配
        for k, v in matrix_map.items():
            if norm in k or k in norm:
                if v not in seen:
                    matched.append(v)
                    seen.add(v)
                break

    return matched


def load_fusion_groups(
    fusion_csv: Path,
    fusion_col_arg: str,
    sample_col_arg: str,
    chunksize: int = 200000,
) -> Dict[str, List[str]]:
    """
    一次性读取 fusion.csv 的 Fusion.Name / sample.name 两列，
    合并同名融合的所有样本，自动去重。

    虽然你的文件已经把相同融合名放在一起了，
    这里仍然用 dict 累积，避免跨 chunk 边界出错。
    只读取两列，不会把整个大文件所有列读进内存。
    """
    columns = get_columns_auto(fusion_csv)
    fusion_col = find_column(
        columns,
        fusion_col_arg,
        aliases=["Fusion.Name", "FusionName", "fusion_name", "fusion name", "x_fusion_name"],
    )
    sample_col = find_column(
        columns,
        sample_col_arg,
        aliases=["sample.name", "sample_name", "Sample.Name", "Sample", "samples", "sample"],
    )

    print(f"[FusionCSV] 使用列：fusion_col={fusion_col!r}, sample_col={sample_col!r}")

    groups: Dict[str, List[str]] = {}
    seen_per_fusion: Dict[str, set] = {}

    ext = fusion_csv.suffix.lower()
    if ext in [".xlsx", ".xls"]:
        df = pd.read_excel(fusion_csv, usecols=[fusion_col, sample_col], dtype=str)
        iterator = [df]
    else:
        # 这里用 chunksize，只读两列，适合很大的 fusion.csv
        iterator = read_table_auto(
            fusion_csv,
            usecols=[fusion_col, sample_col],
            chunksize=chunksize,
        )

    row_count = 0
    for chunk in iterator:
        # 某些读取情况下列名可能带空格，这里再对齐一次
        if fusion_col not in chunk.columns or sample_col not in chunk.columns:
            chunk.columns = [str(c).strip() for c in chunk.columns]

        for _, row in chunk.iterrows():
            row_count += 1
            fusion = str(row.get(fusion_col, "")).strip()
            if not fusion or fusion.lower() in ["nan", "none", "na", "n/a"]:
                continue

            samples = split_sample_names(row.get(sample_col, ""))
            if not samples:
                continue

            if fusion not in groups:
                groups[fusion] = []
                seen_per_fusion[fusion] = set()

            for s in samples:
                # 这里按原始样本名去重，保留 .1 这种不同样本
                if s not in seen_per_fusion[fusion]:
                    groups[fusion].append(s)
                    seen_per_fusion[fusion].add(s)

    print(f"[FusionCSV] 读取行数：{row_count}")
    print(f"[FusionCSV] 融合数量：{len(groups)}")
    return groups


def load_raw_count_matrix(raw_count: Path) -> pd.DataFrame:
    """
    读取 raw count 矩阵：第一列为 gene，后续列为样本。
    """
    print(f"[Count] 读取 raw count：{raw_count}")

    counts = read_table_auto(raw_count, index_col=0)

    # 去掉空基因名、重复基因名
    counts.index = counts.index.astype(str).str.strip()
    counts = counts[counts.index.notna()]
    counts = counts[counts.index != ""]
    if counts.index.duplicated().any():
        print("[Count] 检测到重复基因名，保留第一次出现。")
        counts = counts[~counts.index.duplicated(keep="first")]

    # 全部转成数值，缺失填 0
    counts = counts.apply(pd.to_numeric, errors="coerce").fillna(0)

    # raw count 应该是非负整数；如果 Excel 读成 float，这里四舍五入为整数
    counts[counts < 0] = 0
    counts = np.rint(counts).astype(np.int64)

    print(f"[Count] 矩阵大小：{counts.shape[0]} genes × {counts.shape[1]} samples")
    print(f"[Count] 前5个样本：{list(counts.columns[:5])}")
    return counts


# =========================
# DESeq2
# =========================

def run_pydeseq2(
    counts_df: pd.DataFrame,
    positive_samples: List[str],
    negative_samples: List[str],
    min_count: int,
    min_samples: int,
) -> Optional[pd.DataFrame]:
    """
    对一个融合做 DESeq2。
    返回列：
      gene, gene_symbol, base_mean, log2FC, p_value, adj_p_value, significant, direction
    """
    all_samples = positive_samples + negative_samples
    all_samples = [s for s in all_samples if s in counts_df.columns]

    positive_samples = [s for s in positive_samples if s in counts_df.columns]
    negative_samples = [s for s in negative_samples if s in counts_df.columns]

    if len(positive_samples) < 2 or len(negative_samples) < 2:
        return None

    sub_counts = counts_df.loc[:, all_samples].copy()

    # 过滤低表达基因
    keep = (sub_counts >= min_count).sum(axis=1) >= min_samples
    sub_counts = sub_counts.loc[keep]

    if sub_counts.shape[0] == 0:
        return None

    metadata = pd.DataFrame(
        {
            "condition": ["positive"] * len(positive_samples) + ["negative"] * len(negative_samples)
        },
        index=all_samples,
    )

    counts_t = sub_counts.T

    # pyDESeq2 不同版本参数略有差异，这里做兼容
    try:
        dds = DeseqDataSet(
            counts=counts_t,
            metadata=metadata,
            design_factors="condition",
            refit_cooks=True,
            quiet=True,
        )
    except TypeError:
        try:
            dds = DeseqDataSet(
                counts=counts_t,
                metadata=metadata,
                design_factors="condition",
                refit_cooks=True,
            )
        except TypeError:
            # 新版本可能使用 design="~condition"
            dds = DeseqDataSet(
                counts=counts_t,
                metadata=metadata,
                design="~condition",
                refit_cooks=True,
            )

    dds.deseq2()

    try:
        stat_res = DeseqStats(
            dds,
            contrast=["condition", "positive", "negative"],
            quiet=True,
        )
    except TypeError:
        stat_res = DeseqStats(
            dds,
            contrast=["condition", "positive", "negative"],
        )

    stat_res.summary()
    res = stat_res.results_df.copy()
    res["gene"] = res.index.astype(str)

    rename_map = {
        "baseMean": "base_mean",
        "log2FoldChange": "log2FC",
        "pvalue": "p_value",
        "padj": "adj_p_value",
    }
    res = res.rename(columns=rename_map)

    # 兼容字段缺失
    if "base_mean" not in res.columns:
        res["base_mean"] = 0.0
    if "log2FC" not in res.columns:
        res["log2FC"] = 0.0
    if "p_value" not in res.columns:
        res["p_value"] = 1.0
    if "adj_p_value" not in res.columns:
        res["adj_p_value"] = 1.0

    res["gene_symbol"] = res["gene"].apply(lambda x: str(x).split("^")[0])
    res["log2FC"] = pd.to_numeric(res["log2FC"], errors="coerce").fillna(0.0)
    res["p_value"] = pd.to_numeric(res["p_value"], errors="coerce").fillna(1.0)
    res["adj_p_value"] = pd.to_numeric(res["adj_p_value"], errors="coerce").fillna(1.0)
    res["base_mean"] = pd.to_numeric(res["base_mean"], errors="coerce").fillna(0.0)

    res["significant"] = (res["adj_p_value"] < 0.05) & (res["log2FC"].abs() > 1.0)
    res["direction"] = "ns"
    res.loc[res["significant"] & (res["log2FC"] > 0), "direction"] = "up"
    res.loc[res["significant"] & (res["log2FC"] < 0), "direction"] = "down"

    return res


def build_output_json(
    fusion_name: str,
    deg_df: pd.DataFrame,
    positive_samples: List[str],
    negative_samples: List[str],
    raw_fusion_samples: List[str],
    count_source: str,
) -> dict:
    """
    构建和前端/后端一致的 JSON 结构。
    """
    up_df = deg_df[deg_df["direction"] == "up"].sort_values("log2FC", ascending=False).head(100)
    down_df = deg_df[deg_df["direction"] == "down"].sort_values("log2FC", ascending=True).head(100)

    def table_rows(df: pd.DataFrame, direction: str) -> List[dict]:
        rows = []
        for _, row in df.iterrows():
            rows.append(
                {
                    "gene": str(row["gene_symbol"]),
                    "gene_full": str(row["gene"]),
                    "log2FC": round(float(row["log2FC"]), 4),
                    "p_value": float(row["p_value"]) if math.isfinite(float(row["p_value"])) else 1.0,
                    "adj_p_value": float(row["adj_p_value"]) if math.isfinite(float(row["adj_p_value"])) else 1.0,
                    "base_mean": float(row["base_mean"]) if math.isfinite(float(row["base_mean"])) else 0.0,
                    "direction": direction,
                }
            )
        return rows

    volcano_data = []
    for _, row in deg_df.iterrows():
        adj_p = float(row["adj_p_value"]) if math.isfinite(float(row["adj_p_value"])) else 1.0
        volcano_data.append(
            {
                "gene": str(row["gene_symbol"]),
                "log2FC": round(float(row["log2FC"]), 4),
                "neg_log10_pval": round(-np.log10(adj_p + 1e-300), 2),
                "significant": bool(row["significant"]),
                "direction": str(row["direction"]),
            }
        )

    up_genes = deg_df.loc[deg_df["direction"] == "up", "gene_symbol"].astype(str).tolist()
    down_genes = deg_df.loc[deg_df["direction"] == "down", "gene_symbol"].astype(str).tolist()

    return {
        "fusion_name": fusion_name,
        "method": "DESeq2 precomputed",
        "parameters": {
            "log2fc_threshold": 1.0,
            "fdr_threshold": 0.05,
            "count_source": count_source,
        },
        "sample_info": {
            "positive_count": len(positive_samples),
            "negative_count": len(negative_samples),
            "positive_samples": positive_samples[:20],
            "raw_fusion_samples_count": len(raw_fusion_samples),
            "raw_fusion_samples_preview": raw_fusion_samples[:20],
        },
        "summary": {
            "total_genes_tested": int(len(deg_df)),
            "up_regulated": int(len(up_genes)),
            "down_regulated": int(len(down_genes)),
        },
        "up_genes": up_genes,
        "down_genes": down_genes,
        "up_table": table_rows(up_df, "up"),
        "down_table": table_rows(down_df, "down"),
        "volcano_data": volcano_data,
    }


def main():
    parser = argparse.ArgumentParser(description="Precompute DESeq2 JSON files from fusion.csv and raw_count matrix.")
    parser.add_argument("--fusion-csv", default="fusion.csv", help="backend 下的 fusion.csv 路径，默认 fusion.csv")
    parser.add_argument("--raw-count", default="routes/data/raw_count", help="raw count 矩阵路径，默认 routes/data/raw_count，会自动尝试后缀")
    parser.add_argument("--out", default="routes/data/precomputed_deseq", help="输出 JSON 目录")
    parser.add_argument("--fusion-col", default="Fusion.Name", help="融合名列名，默认 Fusion.Name")
    parser.add_argument("--sample-col", default="sample.name", help="样本名列名，默认 sample.name")
    parser.add_argument("--min-pos", type=int, default=2, help="最少融合阳性样本数，默认 2")
    parser.add_argument("--min-neg", type=int, default=2, help="最少融合阴性样本数，默认 2")
    parser.add_argument("--min-count", type=int, default=10, help="低表达过滤阈值：count >= min-count，默认 10")
    parser.add_argument("--min-samples", type=int, default=0, help="低表达过滤需要满足的样本数；0 表示自动 min(10, 样本数//5)")
    parser.add_argument("--fusion", action="append", default=None, help="只计算指定融合，可重复传入，例如 --fusion RUNX1--RUNX1T1")
    parser.add_argument("--max-fusions", type=int, default=0, help="最多计算多少个融合；0 表示不限制")
    parser.add_argument("--overwrite", action="store_true", help="已存在 JSON 时是否覆盖，默认跳过")
    parser.add_argument("--chunksize", type=int, default=200000, help="读取 fusion.csv 的 chunksize")
    args = parser.parse_args()

    if not HAS_PYDESEQ2:
        print("[ERROR] 当前环境没有安装 pyDESeq2。")
        print("请先运行：pip install pydeseq2")
        sys.exit(1)

    fusion_csv = resolve_existing_path(args.fusion_csv, ["", ".csv", ".tsv", ".txt", ".xlsx", ".xls"])
    raw_count = resolve_existing_path(args.raw_count, ["", ".csv", ".tsv", ".txt", ".xlsx", ".xls"])
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("[Step 1] 读取 fusion.csv 并合并每个融合的 sample.name")
    print("=" * 80)
    fusion_groups = load_fusion_groups(
        fusion_csv=fusion_csv,
        fusion_col_arg=args.fusion_col,
        sample_col_arg=args.sample_col,
        chunksize=args.chunksize,
    )

    if args.fusion:
        wanted = set(args.fusion)
        fusion_groups = {k: v for k, v in fusion_groups.items() if k in wanted}
        print(f"[Filter] 只计算指定融合：{len(fusion_groups)} 个")

    print("=" * 80)
    print("[Step 2] 读取 raw_count")
    print("=" * 80)
    counts_df = load_raw_count_matrix(raw_count)
    all_samples = list(counts_df.columns)

    skipped_path = out_dir / "skipped_fusions.tsv"
    finished = 0
    skipped_records = []

    print("=" * 80)
    print("[Step 3] 逐个融合运行 DESeq2 并保存 JSON")
    print("=" * 80)

    for idx, (fusion_name, raw_samples) in enumerate(fusion_groups.items(), start=1):
        if args.max_fusions and finished >= args.max_fusions:
            break

        out_file = out_dir / f"{safe_fusion_name(fusion_name)}.json"

        if out_file.exists() and not args.overwrite:
            print(f"[{idx}/{len(fusion_groups)}] SKIP 已存在：{fusion_name} -> {out_file.name}")
            continue

        positive_samples = match_sample_names(raw_samples, all_samples)
        negative_samples = [s for s in all_samples if s not in set(positive_samples)]

        print(
            f"\n[{idx}/{len(fusion_groups)}] {fusion_name} | "
            f"raw_samples={len(raw_samples)}, matched_pos={len(positive_samples)}, neg={len(negative_samples)}"
        )

        if len(positive_samples) < args.min_pos:
            reason = f"positive samples too few: {len(positive_samples)} < {args.min_pos}"
            print(f"  -> SKIP: {reason}")
            skipped_records.append((fusion_name, len(raw_samples), len(positive_samples), len(negative_samples), reason))
            continue

        if len(negative_samples) < args.min_neg:
            reason = f"negative samples too few: {len(negative_samples)} < {args.min_neg}"
            print(f"  -> SKIP: {reason}")
            skipped_records.append((fusion_name, len(raw_samples), len(positive_samples), len(negative_samples), reason))
            continue

        min_samples = args.min_samples
        if min_samples <= 0:
            min_samples = max(2, min(10, len(positive_samples + negative_samples) // 5))

        try:
            deg_df = run_pydeseq2(
                counts_df=counts_df,
                positive_samples=positive_samples,
                negative_samples=negative_samples,
                min_count=args.min_count,
                min_samples=min_samples,
            )

            if deg_df is None or len(deg_df) == 0:
                reason = "DESeq2 returned no result"
                print(f"  -> SKIP: {reason}")
                skipped_records.append((fusion_name, len(raw_samples), len(positive_samples), len(negative_samples), reason))
                continue

            output = build_output_json(
                fusion_name=fusion_name,
                deg_df=deg_df,
                positive_samples=positive_samples,
                negative_samples=negative_samples,
                raw_fusion_samples=raw_samples,
                count_source=str(raw_count),
            )

            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)

            finished += 1
            print(
                f"  -> OK: {out_file.name} | "
                f"genes={output['summary']['total_genes_tested']}, "
                f"up={output['summary']['up_regulated']}, "
                f"down={output['summary']['down_regulated']}"
            )

        except Exception as e:
            reason = f"{type(e).__name__}: {e}"
            print(f"  -> ERROR: {reason}")
            traceback.print_exc()
            skipped_records.append((fusion_name, len(raw_samples), len(positive_samples), len(negative_samples), reason))
            continue

    if skipped_records:
        with open(skipped_path, "w", encoding="utf-8") as f:
            f.write("fusion_name\traw_sample_count\tmatched_positive_count\tnegative_count\treason\n")
            for r in skipped_records:
                f.write("\t".join(map(str, r)) + "\n")

    print("\n" + "=" * 80)
    print("[DONE]")
    print(f"成功生成 JSON：{finished}")
    print(f"输出目录：{out_dir.resolve()}")
    if skipped_records:
        print(f"跳过/失败记录：{skipped_path.resolve()}")
    print("=" * 80)


if __name__ == "__main__":
    main()
    
