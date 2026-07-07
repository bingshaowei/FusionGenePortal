#!/usr/bin/env python3
"""Build persistent cellfusion CSV caches."""

from pathlib import Path
import sys
import time


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from routes import cellfusion_routes as cf  # noqa: E402


def main():
    started = time.time()
    cf._load_cellfusion_csv()
    elapsed = time.time() - started
    rows = len(cf._df) if cf._df is not None else 0
    rows_all = len(cf._df_all) if cf._df_all is not None else 0
    print(f"cellfusion_cache_ready rows={rows} rows_all={rows_all} elapsed={elapsed:.1f}s", flush=True)
    return 0 if rows and rows_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
