#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def dump_json(path: Path, obj):
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

def record_key(record: dict) -> str:
    # username/handle are NOT classification features.
    # They are included only in the stable audit key.
    payload = "\x1f".join([
        str(record.get("username", "")),
        str(record.get("handle", "")),
        str(record.get("comment", "")),
        str(record.get("postedAt", "")),
        str(record.get("postedDate", "")),
        str(record.get("label", "")),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]

def matches(text: str, terms: list[str]) -> list[str]:
    # Compatibility rule: raw, case-sensitive substring match.
    return [t for t in terms if t in text]

def load_overrides(path: Path | None) -> dict[str, dict]:
    if path is None:
        return {}
    out = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"record_key", "label", "note"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"override CSV requires columns: {sorted(required)}")
        for row in reader:
            key = (row.get("record_key") or "").strip()
            label = (row.get("label") or "").strip()
            note = (row.get("note") or "").strip()
            if not key:
                continue
            if not label:
                # blank label = unresolved template row
                continue
            if label not in {"direct_nuisance", "reactive", "normal"}:
                raise ValueError(f"invalid override label for {key}: {label}")
            out[key] = {"label": label, "note": note}
    return out

def classify(record: dict, reactive_terms: list[str], review_cues: dict, override: dict | None):
    old = record.get("label")
    if old not in {"normal", "nuisance"}:
        raise ValueError(f"original label must be normal/nuisance, got {old!r}")

    text = record.get("comment")
    if text is None:
        text = ""
    if not isinstance(text, str):
        text = str(text)

    reactive_hits = matches(text, reactive_terms)
    direct_hits = matches(text, review_cues["direct_cues"])
    latent_hits = matches(text, review_cues["latent_reactive_cues"])
    spam_hits = matches(text, review_cues.get("spam_cues", []))

    if old == "nuisance":
        provisional = "reactive" if reactive_hits else "direct_nuisance"
    else:
        provisional = "reactive" if reactive_hits else "normal"

    reasons = []
    priority = None

    # P0: direct/reactive mixed target in an upstream nuisance.
    if old == "nuisance" and reactive_hits and direct_hits:
        reasons.append("mixed_direct_reactive")
        priority = 0

    # P1: reaction-like phrase not covered by the primary 42-term list.
    if not reactive_hits and latent_hits:
        reasons.append("possible_reactive_without_primary_term")
        priority = 1 if priority is None else min(priority, 1)

    # P2: possible upstream miss. Compatibility mode never changes it automatically.
    if old == "normal" and direct_hits and not reactive_hits:
        reasons.append("source_normal_direct_cue")
        priority = 2 if priority is None else min(priority, 2)

    # Empty comments are informational review items.
    if not text.strip():
        reasons.append("empty_comment")
        priority = 2 if priority is None else min(priority, 2)

    key = record_key(record)
    final_label = provisional
    review_resolved = False
    review_note = ""

    if override:
        final_label = override["label"]
        review_resolved = True
        review_note = override.get("note", "")

    result = dict(record)
    result["record_key"] = key
    result["label_original"] = old
    result["label_provisional"] = provisional
    result["label"] = final_label
    result["labeling_version"] = "1.0.0"
    result["matched_reactive_terms"] = reactive_hits
    result["matched_direct_cues"] = direct_hits
    result["matched_latent_reactive_cues"] = latent_hits
    result["matched_spam_cues"] = spam_hits
    result["review_required"] = bool(reasons)
    result["review_priority"] = priority
    result["review_reasons"] = reasons
    result["review_resolved"] = review_resolved or not reasons
    result["review_note"] = review_note
    return result

def write_review_csv(path: Path, rows: list[dict]):
    fields = [
        "record_key","review_priority","review_reasons",
        "label_original","label_provisional","label",
        "matched_reactive_terms","matched_direct_cues",
        "matched_latent_reactive_cues","comment"
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({
                "record_key": r["record_key"],
                "review_priority": r["review_priority"],
                "review_reasons": "|".join(r["review_reasons"]),
                "label_original": r["label_original"],
                "label_provisional": r["label_provisional"],
                "label": r["label"],
                "matched_reactive_terms": "|".join(r["matched_reactive_terms"]),
                "matched_direct_cues": "|".join(r["matched_direct_cues"]),
                "matched_latent_reactive_cues": "|".join(r["matched_latent_reactive_cues"]),
                "comment": r.get("comment", ""),
            })

def write_override_template(path: Path, rows: list[dict]):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["record_key","label","note"])
        for r in rows:
            if not r["review_resolved"]:
                w.writerow([r["record_key"], "", ""])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_json", type=Path)
    ap.add_argument("--outdir", type=Path, required=True)
    ap.add_argument("--overrides", type=Path)
    ap.add_argument("--strict-final", action="store_true",
                    help="Fail if unresolved P0/P1 review items remain.")
    args = ap.parse_args()

    policy = load_json(ROOT / "config" / "policy.json")
    reactive_terms = load_json(ROOT / "config" / "reactive_terms.json")
    review_cues = load_json(ROOT / "config" / "review_cues.json")
    overrides = load_overrides(args.overrides)

    data = load_json(args.input_json)
    if not isinstance(data, list):
        raise ValueError("input JSON must be an array of comment records")

    args.outdir.mkdir(parents=True, exist_ok=True)

    results = []
    errors = []
    for i, record in enumerate(data):
        if not isinstance(record, dict):
            errors.append({"index": i, "error": "record is not an object"})
            continue
        try:
            key = record_key(record)
            results.append(classify(
                record,
                reactive_terms,
                review_cues,
                overrides.get(key),
            ))
        except Exception as e:
            errors.append({"index": i, "error": str(e)})

    if errors:
        dump_json(args.outdir / "errors.json", errors)
        print(f"ERROR: {len(errors)} invalid records. See errors.json", file=sys.stderr)
        return 3

    review_rows = [r for r in results if r["review_required"]]
    unresolved_mandatory = [
        r for r in review_rows
        if r["review_priority"] in {0, 1} and not r["review_resolved"]
    ]

    counts = Counter(r["label"] for r in results)
    provisional_counts = Counter(r["label_provisional"] for r in results)
    transition_counts = Counter(
        f'{r["label_original"]}->{r["label"]}' for r in results
    )
    review_counts = Counter(str(r["review_priority"]) for r in review_rows)

    summary = {
        "policy_version": policy["policy_version"],
        "input_file": str(args.input_json),
        "records": len(results),
        "final_label_counts": dict(counts),
        "provisional_label_counts": dict(provisional_counts),
        "transition_counts": dict(transition_counts),
        "review_items": len(review_rows),
        "review_priority_counts": dict(review_counts),
        "unresolved_mandatory_reviews": len(unresolved_mandatory),
        "overrides_applied": sum(1 for r in results if r["review_note"] or (
            r["record_key"] in overrides
        )),
    }

    dump_json(args.outdir / "labeled_provisional.json", results)
    dump_json(args.outdir / "review_queue.json", review_rows)
    dump_json(args.outdir / "summary.json", summary)
    write_review_csv(args.outdir / "review_queue.csv", review_rows)
    write_override_template(args.outdir / "manual_overrides.csv", review_rows)

    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if args.strict_final and unresolved_mandatory:
        print(
            f"STRICT FINAL FAILED: {len(unresolved_mandatory)} unresolved P0/P1 items.",
            file=sys.stderr,
        )
        return 2
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
