#!/usr/bin/env python3
"""Build persistent transcriptome matrix caches.

This script is intended for server warmup. It converts the large CSV matrices
used by transcriptome analysis into pandas pickle files under
routes/data/matrix_cache, so gunicorn preload can load the matrices much faster
on the next restart.
"""

from pathlib import Path
import sys
import time


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from routes.transcriptome import (  # noqa: E402
    MATRIX_CACHE_DIR,
    load_count_matrix,
    load_expression_matrix,
)


def build_one(label, loader):
    started = time.time()
    print(f"[MatrixCache] building {label} cache...", flush=True)
    df = loader()
    elapsed = time.time() - started
    if df is None:
        print(f"[MatrixCache] {label} failed after {elapsed:.1f}s", flush=True)
        return 1

    print(
        f"[MatrixCache] {label} ready: {df.shape[0]} rows x {df.shape[1]} columns "
        f"in {elapsed:.1f}s",
        flush=True,
    )
    return 0


def main():
    Path(MATRIX_CACHE_DIR).mkdir(parents=True, exist_ok=True)
    status = 0
    status |= build_one("TPM", load_expression_matrix)
    status |= build_one("Raw Count", load_count_matrix)
    print(f"[MatrixCache] cache_dir={MATRIX_CACHE_DIR}", flush=True)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
