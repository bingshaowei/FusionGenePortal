#!/usr/bin/env python3
"""Build persistent GDSC table caches."""

from pathlib import Path
import sys
import time


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from routes.gdsc_routes import _get_drug_data, _get_expression_df  # noqa: E402


def main():
    started = time.time()
    expr = _get_expression_df()
    drug_data, drug_details, _ = _get_drug_data()
    elapsed = time.time() - started
    print(
        f"gdsc_cache_ready expression={expr.shape[0]}x{expr.shape[1]} "
        f"cosmic={len(drug_data)} drugs={len(drug_details)} elapsed={elapsed:.1f}s",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
