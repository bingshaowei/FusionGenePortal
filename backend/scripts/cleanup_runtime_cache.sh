#!/usr/bin/env bash
set -euo pipefail

BASE="/home/debian/fusion-gene-portal/backend"
TMP_DIR="$BASE/routes/data/r_enrichment_tmp"
LOG_FILE="/var/log/fusiongp-cache-cleanup.log"

{
  echo "[$(date -Is)] cleanup started"

  if [ -d "$TMP_DIR" ]; then
    echo "before_tmp_size=$(du -sh "$TMP_DIR" 2>/dev/null | awk '{print $1}')"
    find "$TMP_DIR" -type f -mtime +7 -print -delete
    find "$TMP_DIR" -mindepth 1 -type d -empty -print -delete
    echo "after_tmp_size=$(du -sh "$TMP_DIR" 2>/dev/null | awk '{print $1}')"
  fi

  journalctl --vacuum-time=14d --vacuum-size=1G >/dev/null 2>&1 || true

  echo "[$(date -Is)] cleanup finished"
} >> "$LOG_FILE" 2>&1
