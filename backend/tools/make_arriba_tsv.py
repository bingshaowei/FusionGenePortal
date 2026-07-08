#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import argparse
import re
from pathlib import Path

ARRIBA_HEADER = [
    "#gene1","gene2","strand1(gene/fusion)","strand2(gene/fusion)",
    "breakpoint1","breakpoint2","site1","site2","type",
    "split_reads1","split_reads2","discordant_mates",
    "coverage1","coverage2","confidence","reading_frame","tags",
    "retained_protein_domains","closest_genomic_breakpoint1","closest_genomic_breakpoint2",
    "gene_id1","gene_id2","transcript_id1","transcript_id2",
    "direction1","direction2","filters","fusion_transcript","peptide_sequence","read_identifiers"
]


# =========================
# 工具函数
# =========================

def norm_key(s: str) -> str:
    if s is None:
        return ""
    s = s.replace("\ufeff", "")
    s = s.replace("\r", "").strip()
    s = re.sub(r"[^0-9A-Za-z._]+", "", s).lower()
    return s


def clean_gene(x: str) -> str:
    return re.sub(r"\^.*$", "", (x or "").strip())


def keep_ens_gene_id(x: str) -> str:
    x = (x or "").strip()
    x = re.sub(r"^.*\^", "", x)
    return x if x else "."


def keep_transcript_id(x: str) -> str:
    x = (x or "").strip()
    return x if x else "."


def parse_breakpoint(bp: str):
    bp = (bp or "").strip()
    m = re.match(r"^(chr)?([^:]+):(\d+):([+-])$", bp)
    if not m:
        raise ValueError(f"Bad breakpoint format: {bp}")
    has_chr = m.group(1) is not None
    contig = ("chr" if has_chr else "") + m.group(2)
    pos = int(m.group(3))
    strand = m.group(4)
    return contig, pos, strand


def sniff_delimiter(path: str) -> str:
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        sample = f.read(8192)

    first_line = sample.splitlines()[0] if sample else ""

    if first_line.count("\t") > first_line.count(","):
        return "\t"
    if first_line.count(",") > 0:
        return ","

    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t")
        return dialect.delimiter
    except Exception:
        return ","


def read_table(path: str):
    delim = sniff_delimiter(path)
    rows = []

    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=delim)
        if not reader.fieldnames:
            return rows

        for row in reader:
            r = {}
            for raw_k, v in row.items():
                nk = norm_key(raw_k)
                if isinstance(v, str):
                    v = v.replace("\r", "")
                r[nk] = v
            rows.append(r)

    return rows


def getv(r, *candidates, default=""):
    for c in candidates:
        nk = norm_key(c)
        if nk in r and r[nk] not in (None, ""):
            return r[nk]
    return default


def to_int(x, default=1):
    try:
        return int(float(x))
    except Exception:
        return default


# =========================
# 主程序
# =========================

def main():
    ap = argparse.ArgumentParser(
        description="Convert all rows of fusion.CSV to Arriba-like TSV files"
    )
    ap.add_argument("--input","-i", required=True, help="fusion.CSV or TSV")
    ap.add_argument("--output-dir","-o", required=True, help="output directory")
    ap.add_argument("--keep-chr", action="store_true", help="keep 'chr' prefix")
    args = ap.parse_args()

    rows = read_table(args.input)

    if not rows:
        raise SystemExit("No rows found in input file.")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    file_index = 1

    for idx, row in enumerate(rows, start=1):

        left_gene_raw  = getv(row, "LeftGene")
        right_gene_raw = getv(row, "RightGene")
        left_bp_raw    = getv(row, "LeftBreakpoint")
        right_bp_raw   = getv(row, "RightBreakpoint")

        if not (left_gene_raw and right_gene_raw and left_bp_raw and right_bp_raw):
            print(f"Skipping row {idx}: missing required columns")
            continue

        # breakpoint 保护
        try:
            contig1, pos1, strand1 = parse_breakpoint(left_bp_raw)
            contig2, pos2, strand2 = parse_breakpoint(right_bp_raw)
        except Exception as e:
            print(f"Skipping row {idx}: {e}")
            continue

        if not args.keep_chr:
            contig1 = re.sub(r"^chr", "", contig1, flags=re.IGNORECASE)
            contig2 = re.sub(r"^chr", "", contig2, flags=re.IGNORECASE)

        gene1 = clean_gene(left_gene_raw)
        gene2 = clean_gene(right_gene_raw)

        strand1_out = f"{strand1}/{strand1}"
        strand2_out = f"{strand2}/{strand2}"

        direction1 = "downstream" if strand1 == "+" else "upstream"
        direction2 = "upstream" if strand2 == "+" else "downstream"

        gene_id1 = keep_ens_gene_id(left_gene_raw)
        gene_id2 = keep_ens_gene_id(right_gene_raw)

        tx1 = keep_transcript_id(getv(row, "CDS_LEFT_ID", default="."))
        tx2 = keep_transcript_id(getv(row, "CDS_RIGHT_ID", default="."))

        # 结构类型
        if contig1 != contig2:
            ftype = "translocation"
        else:
            if direction1 == direction2:
                ftype = "inversion"
            else:
                ftype = "deletion" if ((direction1 == "downstream") == (pos1 < pos2)) else "duplication"

        split1 = to_int(getv(row, "Avg.JunctionReadCount", "JunctionReadCount", default="1"))
        disc   = to_int(getv(row, "Avg.SpanningFragCount", "SpanningFragCount", default="1"))

        # reading frame
        prot_type = (getv(row, "PROT_FUSION_TYPE", default="") or "").strip().upper()
        if "INFRAME" in prot_type:
            reading_frame = "in-frame"
        elif "FRAMESHIFT" in prot_type:
            reading_frame = "out-of-frame"
        else:
            reading_frame = "."

        # peptide
        pep = (getv(row, "FUSION_TRANSL", default=".") or ".").strip()
        if pep not in ("", "."):
            pep = pep.rstrip("*")
        else:
            pep = "."

        out_row = {
            "#gene1": gene1,
            "gene2": gene2,
            "strand1(gene/fusion)": strand1_out,
            "strand2(gene/fusion)": strand2_out,
            "breakpoint1": f"{contig1}:{pos1}",
            "breakpoint2": f"{contig2}:{pos2}",
            "site1": "exon",
            "site2": "exon",
            "type": ftype,
            "split_reads1": split1,
            "split_reads2": 0,
            "discordant_mates": disc,
            "coverage1": split1,
            "coverage2": disc,
            "confidence": "high",
            "reading_frame": reading_frame,
            "tags": ".",
            "retained_protein_domains": ".",
            "closest_genomic_breakpoint1": ".",
            "closest_genomic_breakpoint2": ".",
            "gene_id1": gene_id1,
            "gene_id2": gene_id2,
            "transcript_id1": tx1,
            "transcript_id2": tx2,
            "direction1": direction1,
            "direction2": direction2,
            "filters": ".",
            "fusion_transcript": ".",
            "peptide_sequence": pep,
            "read_identifiers": ".",
        }

        out_path = out_dir / f"{file_index}.tsv"

        with open(out_path, "w", encoding="utf-8", newline="") as g:
            g.write("\t".join(ARRIBA_HEADER) + "\n")
            g.write("\t".join(str(out_row[h]) for h in ARRIBA_HEADER) + "\n")

        print(f"Wrote {out_path}")
        file_index += 1

    print("All fusions processed.")


if __name__ == "__main__":
    main()








