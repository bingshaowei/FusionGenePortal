#!/usr/bin/env python3
"""Small HTTP probe for server-side endpoint timings."""

import json
import time
import urllib.parse
import urllib.request


BASE = "http://127.0.0.1:18080"


def request_json(path, payload=None, token=None, timeout=180):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    started = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
    elapsed = time.time() - started
    return response.status, elapsed, len(body), body


def print_probe(name, path, payload=None, token=None, timeout=180):
    status, elapsed, size, _ = request_json(path, payload=payload, token=token, timeout=timeout)
    print(f"{name} {status} {elapsed:.3f}s {size}B", flush=True)


def main():
    status, elapsed, size, body = request_json("/api/auth/login", payload={})
    token = json.loads(body.decode("utf-8"))["access_token"]
    print(f"login {status} {elapsed:.3f}s {size}B", flush=True)

    print_probe(
        "top20_disease_1",
        "/api/cellfusion/top20?" + urllib.parse.urlencode({"diseases": "carcinoma"}),
        token=token,
    )
    print_probe(
        "top20_disease_2",
        "/api/cellfusion/top20?" + urllib.parse.urlencode({"diseases": "carcinoma"}),
        token=token,
    )
    print_probe(
        "top20_cellline_1",
        "/api/cellfusion/top20?" + urllib.parse.urlencode({"cell_line": "HCC.56"}),
        token=token,
    )
    print_probe(
        "top20_cellline_2",
        "/api/cellfusion/top20?" + urllib.parse.urlencode({"cell_line": "HCC.56"}),
        token=token,
    )
    print_probe(
        "cooccurrence_1",
        "/api/fusion/co-occurrence",
        payload={
            "samples": "TARGET.20.PAEERJ.04A,TARGET.20.PANLLX.09A",
            "current_fusion": "RUNX1--RUNX1T1",
        },
    )
    print_probe(
        "cooccurrence_2",
        "/api/fusion/co-occurrence",
        payload={
            "samples": "TARGET.20.PAEERJ.04A,TARGET.20.PANLLX.09A",
            "current_fusion": "RUNX1--RUNX1T1",
        },
    )


if __name__ == "__main__":
    main()
