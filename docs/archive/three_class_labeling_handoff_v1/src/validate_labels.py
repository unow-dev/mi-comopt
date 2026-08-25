#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ALLOWED = {"direct_nuisance", "reactive", "normal"}
ORIGINAL = {"normal", "nuisance"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("labeled_json", type=Path)
    ap.add_argument("--require-resolved", action="store_true")
    args = ap.parse_args()

    with args.labeled_json.open("r", encoding="utf-8") as f:
        data = json.load(f)

    errors = []
    counts = Counter()
    original_counts = Counter()
    unresolved = Counter()

    if not isinstance(data, list):
        print("ERROR: input must be a JSON array", file=sys.stderr)
        return 3

    for i, r in enumerate(data):
        lab = r.get("label")
        old = r.get("label_original")
        counts[lab] += 1
        original_counts[old] += 1

        if lab not in ALLOWED:
            errors.append(f"{i}: invalid final label {lab!r}")
        if old not in ORIGINAL:
            errors.append(f"{i}: invalid original label {old!r}")

        if r.get("review_required") and not r.get("review_resolved"):
            unresolved[str(r.get("review_priority"))] += 1

        # Compatibility invariant:
        if old == "normal" and lab == "direct_nuisance":
            # This can be valid only through an explicit override.
            if not r.get("review_note"):
                errors.append(
                    f"{i}: normal->direct_nuisance without documented override note"
                )

    print("final labels:", dict(counts))
    print("original labels:", dict(original_counts))
    print("unresolved reviews:", dict(unresolved))

    if errors:
        for e in errors[:50]:
            print("ERROR:", e, file=sys.stderr)
        if len(errors) > 50:
            print(f"... and {len(errors)-50} more", file=sys.stderr)
        return 3

    if args.require_resolved:
        mandatory = unresolved.get("0", 0) + unresolved.get("1", 0)
        if mandatory:
            print(
                f"ERROR: {mandatory} unresolved mandatory P0/P1 reviews",
                file=sys.stderr,
            )
            return 2

    print("validation: OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
