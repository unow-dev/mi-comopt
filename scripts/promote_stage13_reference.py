#!/usr/bin/env python3
"""Promote a successfully published Stage 13 output into private continuity state."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def read_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as source:
        return json.load(source)


def promote(stage13: Path, release: Path, destination: Path, reference: Path | None = None) -> dict[str, str]:
    release_data = read_json(release)
    if not isinstance(release_data, dict) or not isinstance(release_data.get("stage13"), dict):
        raise ValueError("data-release.json does not contain a stage13 record")
    expected_stage13 = release_data["stage13"].get("sha256")
    if expected_stage13 != sha256_file(stage13):
        raise ValueError("Stage 13 output SHA does not match data-release.json")
    if reference is not None:
        expected_reference = release_data["stage13"].get("reference_sha256")
        if expected_reference != sha256_file(reference):
            raise ValueError("Stage 13 reference SHA does not match data-release.json")
    try:
        data = read_json(stage13)
    except json.JSONDecodeError as caught:
        raise ValueError(f"Stage 13 output is not valid JSON: {caught}") from caught
    if not isinstance(data, list):
        raise ValueError("Stage 13 output must be a JSON array")
    expected_fields = {"username", "handle", "comment", "postedAt", "postedDate", "label"}
    for index, row in enumerate(data, 1):
        if not isinstance(row, dict) or set(row) != expected_fields:
            raise ValueError(f"Stage 13 record {index} fields do not match the contract")
        if any(not isinstance(row[field], str) for field in expected_fields - {"label"}):
            raise ValueError(f"Stage 13 record {index} contains a non-string raw field")
        if row["label"] not in {"normal", "nuisance"}:
            raise ValueError(f"Stage 13 record {index} has an invalid label")
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as target, stage13.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary_name, destination)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return {"destination": str(destination), "stage13_sha256": expected_stage13}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage13", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    print(json.dumps(promote(args.stage13, args.release, args.destination, args.reference), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
