#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import os
import re
import sys

VALID_AA = set("ACDEFGHIKLMNPQRSTVWY")

def try_read_full_file(path, encoding):
    with open(path, "r", encoding=encoding, newline="") as f:
        f.read()

def detect_encoding(path):
    """
    先尝试 gb18030/gbk，因为你的 fusion.csv 已经确认不是 utf-8。
    这里会读取完整文件，而不是只读前几 KB，避免前面能读、后面报 UnicodeDecodeError。
    """
    for enc in ["gb18030", "gbk", "cp936", "utf-8-sig", "utf-8", "latin1"]:
        try:
            try_read_full_file(path, enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin1"

def detect_delimiter(path, encoding):
    with open(path, "r", encoding=encoding, newline="") as f:
        header = f.readline()
    if header.count("\t") > header.count(","):
        return "\t"
    return ","

def clean_sequence(raw_seq):
    if raw_seq is None:
        return ""

    seq = str(raw_seq).strip()

    if not seq or seq in {".", "NA", "NaN", "nan", "None", "none", "NULL", "null"}:
        return ""

    # 去掉终止密码子符号，尤其是末尾的 *
    seq = seq.rstrip("*")

    # 去掉空格、换行、制表符
    seq = re.sub(r"\s+", "", seq)

    # 转大写，只保留标准 20 种氨基酸
    seq = seq.upper()
    seq = "".join(aa for aa in seq if aa in VALID_AA)

    return seq

def wrap_fasta(seq, width=60):
    return "\n".join(seq[i:i + width] for i in range(0, len(seq), width))

def normalize_colname(name):
    return str(name).replace("\ufeff", "").strip()

def csv_to_fasta(input_file, output_file=None):
    if output_file is None:
        output_file = os.path.splitext(input_file)[0] + ".fasta"

    input_file = os.path.abspath(input_file)
    output_file = os.path.abspath(output_file)

    if not os.path.exists(input_file):
        print(f"错误：输入文件不存在：{input_file}")
        sys.exit(1)

    encoding = detect_encoding(input_file)
    delimiter = detect_delimiter(input_file, encoding)

    valid = 0
    skipped_empty = 0
    skipped_invalid = 0

    with open(input_file, "r", encoding=encoding, newline="") as fin, \
         open(output_file, "w", encoding="utf-8", newline="\n") as fout:

        reader = csv.DictReader(fin, delimiter=delimiter)

        if not reader.fieldnames:
            print("错误：文件为空或没有表头")
            sys.exit(1)

        original_cols = reader.fieldnames
        col_map = {normalize_colname(c): c for c in original_cols}

        if "squeue" not in col_map:
            print("错误：找不到 'squeue' 列")
            print(f"当前识别到的前10个列名：{[normalize_colname(c) for c in original_cols[:10]]}")
            print(f"当前分隔符识别为：{repr(delimiter)}")
            sys.exit(1)

        if "FUSION_TRANSL" not in col_map:
            print("错误：找不到 'FUSION_TRANSL' 列")
            print(f"当前识别到的前20个列名：{[normalize_colname(c) for c in original_cols[:20]]}")
            print(f"当前分隔符识别为：{repr(delimiter)}")
            sys.exit(1)

        squeue_col = col_map["squeue"]
        transl_col = col_map["FUSION_TRANSL"]

        for row in reader:
            seq_id = str(row.get(squeue_col, "")).strip()
            raw_seq = row.get(transl_col, "")

            if not seq_id:
                skipped_invalid += 1
                continue

            seq = clean_sequence(raw_seq)

            if not seq:
                skipped_empty += 1
                continue

            fout.write(f">T{seq_id}\n{wrap_fasta(seq)}\n")
            valid += 1

    print("\n✓ 完成！")
    print(f"  输入文件     : {input_file}")
    print(f"  输出文件     : {output_file}")
    print(f"  文件编码     : {encoding}")
    print(f"  分隔符       : {repr(delimiter)}")
    print(f"  有效序列     : {valid} 条")
    print(f"  跳过空序列   : {skipped_empty} 条")
    print(f"  跳过异常行   : {skipped_invalid} 条")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法：")
        print("  python csv_to_fasta.py fusion.csv")
        print("  python csv_to_fasta.py fusion.csv fusion.fasta")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) >= 3 else None
    csv_to_fasta(input_file, output_file)