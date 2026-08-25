#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "label_comments", ROOT / "src" / "label_comments.py"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

reactive_terms = mod.load_json(ROOT / "config" / "reactive_terms.json")
review_cues = mod.load_json(ROOT / "config" / "review_cues.json")
cases = mod.load_json(ROOT / "tests" / "regression_cases.json")

failed = []
for c in cases:
    result = mod.classify(
        c["record"], reactive_terms, review_cues, override=None
    )
    checks = [
        ("label_provisional", c["expected_provisional"]),
        ("review_required", c["expected_review_required"]),
    ]
    if "expected_priority" in c:
        checks.append(("review_priority", c["expected_priority"]))
    for field, expected in checks:
        if result[field] != expected:
            failed.append(
                f'{c["name"]}: {field} expected {expected!r}, got {result[field]!r}'
            )

if failed:
    print("FAILED")
    for x in failed:
        print("-", x)
    raise SystemExit(1)

print(f"OK: {len(cases)} regression cases")
