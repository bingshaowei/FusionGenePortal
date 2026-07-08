#!/bin/bash
set -euo pipefail

############################
# 1️⃣ 激活 Conda 环境
############################
if [ -f /opt/miniforge3/etc/profile.d/conda.sh ]; then
    source /opt/miniforge3/etc/profile.d/conda.sh
elif [ -f /home/debian/miniforge3/etc/profile.d/conda.sh ]; then
    source /home/debian/miniforge3/etc/profile.d/conda.sh
elif [ -f /home/debian/miniconda3/etc/profile.d/conda.sh ]; then
    source /home/debian/miniconda3/etc/profile.d/conda.sh
else
    echo "ERROR: Cannot find conda.sh. Please check conda installation path." >&2
    exit 1
fi

conda activate arriba

############################
# 2️⃣ 路径配置（下沙服务器）
############################
BASE=/home/debian/fusion-gene-portal/backend
TOOLS=$BASE/tools
INPUT_DIR=$TOOLS/arriba_outputs
OUTPUT_DIR=$BASE/arriba/cache

ANNOTATION=$TOOLS/gencode.v36.annotation.gtf
CYTOBANDS=$TOOLS/cytobands_hg38.nochr.tsv
PROTEIN=$TOOLS/protein_domains_hg38_GRCh38_v2.5.1.nochr.gff3
DRAW=$TOOLS/draw_fusions.R
FAILED_LOG=$TOOLS/failed.log

############################
# 3️⃣ 并行数
############################
JOBS=15

echo "Using conda env: arriba"
echo "Using parallel jobs: $JOBS"
echo "BASE: $BASE"
echo "TOOLS: $TOOLS"
echo "INPUT_DIR: $INPUT_DIR"
echo "OUTPUT_DIR: $OUTPUT_DIR"

############################
# 4️⃣ 基础检查
############################
for f in "$DRAW" "$ANNOTATION" "$CYTOBANDS" "$PROTEIN"; do
    if [ ! -f "$f" ]; then
        echo "ERROR: Required file not found: $f" >&2
        exit 1
    fi
done

if [ ! -d "$INPUT_DIR" ]; then
    echo "ERROR: Input directory not found: $INPUT_DIR" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -f "$FAILED_LOG"

############################
# 5️⃣ 开始并行运行
############################
echo "Start parallel Arriba drawing..."

export OUTPUT_DIR ANNOTATION CYTOBANDS PROTEIN DRAW FAILED_LOG

find "$INPUT_DIR" -maxdepth 1 -name "*.tsv" | sort -V | \
parallel -j "$JOBS" --bar '
    name=$(basename {} .tsv)
    output="$OUTPUT_DIR/$name.pdf"

    # 跳过已存在文件
    if [ -f "$output" ]; then
        exit 0
    fi

    if Rscript "$DRAW" \
        --fusions="{}" \
        --annotation="$ANNOTATION" \
        --cytobands="$CYTOBANDS" \
        --proteinDomains="$PROTEIN" \
        --plotPanels=fusion,domains,readcounts \
        --output="$output"
    then
        :
    else
        echo "$name FAILED" >> "$FAILED_LOG"
    fi
'

echo "All finished."
echo "Failed jobs (if any) saved in $FAILED_LOG"


