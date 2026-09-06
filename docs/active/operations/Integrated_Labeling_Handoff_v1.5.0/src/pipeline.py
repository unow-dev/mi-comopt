#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from single_roundtrip import finalize_single_roundtrip, prepare_single_roundtrip

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = next(
    (parent for parent in Path(__file__).resolve().parents if (parent / ".git").exists()),
    ROOT.parents[4],
)
FIELDS = ("username", "handle", "comment", "postedAt", "postedDate")
STAGE13_LABELS = {"normal", "nuisance"}
THREE_LABELS = {"direct_nuisance", "reactive", "normal"}
MANDATORY_REVIEW_PRIORITIES = {0, 1}
GOLDEN_REASON_CODES = {"direct_target", "anti_target", "support_reaction", "meta_reaction", "quoted_attack", "mixed_target", "spam", "normal_context"}
P2_REASON_CODES = {"confirm_normal", "reactive_context", "direct_target", "spam_or_inappropriate_request"}
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def dump_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _stable_field_payload(record: dict, include_label: bool) -> str:
    values = [str(record.get(f, "")) for f in FIELDS]
    if include_label:
        values.append(str(record.get("label", "")))
    return "\x1f".join(values)


def raw_record_sha256(record: dict) -> str:
    return hashlib.sha256(_stable_field_payload(record, False).encode("utf-8")).hexdigest()


def record_key(record: dict) -> str:
    return hashlib.sha256(_stable_field_payload(record, True).encode("utf-8")).hexdigest()[:24]


def five_key(r: dict) -> tuple:
    return tuple(r.get(f) for f in FIELDS)


def validate_raw_records(data: Any, *, exact_fields: bool = True) -> list[dict]:
    if not isinstance(data, list):
        raise ValueError("top-level JSON must be an array")
    expected = set(FIELDS)
    for i, r in enumerate(data, 1):
        if not isinstance(r, dict):
            raise ValueError(f"record {i}: must be an object")
        missing = expected - set(r)
        if missing:
            raise ValueError(f"record {i}: missing fields {sorted(missing)}")
        if exact_fields and set(r) != expected:
            raise ValueError(
                f"record {i}: raw Stage 13 input must contain exactly {list(FIELDS)}; "
                f"extra={sorted(set(r)-expected)}"
            )
        for field in FIELDS:
            if not isinstance(r[field], str):
                raise ValueError(f"record {i}: raw field {field!r} must be a JSON string")
    return data


def validate_stage13_records(data: Any) -> list[dict]:
    if not isinstance(data, list):
        raise ValueError("top-level JSON must be an array")
    expected = set(FIELDS) | {"label"}
    for i, r in enumerate(data, 1):
        if not isinstance(r, dict):
            raise ValueError(f"record {i}: must be an object")
        if set(r) != expected:
            raise ValueError(
                f"record {i}: Stage 13 record fields must be exactly {sorted(expected)}"
            )
        for field in FIELDS:
            if not isinstance(r[field], str):
                raise ValueError(f"record {i}: Stage 13 field {field!r} must be a JSON string")
        if r.get("label") not in STAGE13_LABELS:
            raise ValueError(f"record {i}: invalid Stage 13 label {r.get('label')!r}")
    return data


def default_reference() -> Path:
    return ROOT / "reference" / "stage13_labeled_REFERENCE.json"


def default_private_reference() -> Path:
    return REPOSITORY_ROOT / "var" / "integrated-labeling" / "stage13_reference.json"


def default_operational_state() -> Path:
    return REPOSITORY_ROOT / "docs" / "active" / "operations" / "integrated-labeling-state"


def default_golden_registry() -> Path:
    return default_operational_state() / "three_class_golden_adjudications.json"


def default_p2_registry() -> Path:
    return default_operational_state() / "three_class_p2_adjudications.json"


def default_baseline_golden_registry() -> Path:
    return ROOT / "reference" / "three_class_golden_adjudications.json"


def default_baseline_p2_registry() -> Path:
    return ROOT / "reference" / "three_class_p2_adjudications.json"


def _workspace_state_path(workspace: Path) -> Path:
    return workspace / "stage13_workspace_state.json"


def cmd_prepare_stage13(args: argparse.Namespace) -> int:
    if args.batch_size <= 0:
        raise ValueError("--batch-size must be a positive integer")

    input_path = args.input_json
    ref_path = args.reference
    if ref_path is None:
        ref_path = default_reference() if getattr(args, "bootstrap", False) else default_private_reference()
    if not ref_path.exists():
        mode = "bootstrap baseline" if getattr(args, "bootstrap", False) else "private previous successful run"
        raise FileNotFoundError(f"Stage 13 {mode} reference is unavailable: {ref_path}")
    outdir = args.outdir
    outdir.mkdir(parents=True, exist_ok=True)
    batches_dir = outdir / "pending_batches"
    batches_dir.mkdir(exist_ok=True)
    for stale in batches_dir.iterdir():
        if stale.is_file() and re.fullmatch(r"batch_\d{3}(?:_context|_adjudications)?\.(?:json|csv)", stale.name):
            stale.unlink()

    current = validate_raw_records(load_json(input_path), exact_fields=True)
    reference = validate_stage13_records(load_json(ref_path))
    input_sha = sha256_file(input_path)
    reference_sha = sha256_file(ref_path)

    exact: dict[tuple, set[str]] = defaultdict(set)
    same_handle_comment: dict[tuple, list[dict]] = defaultdict(list)
    ref_by_handle: dict[Any, list[dict]] = defaultdict(list)
    current_by_handle: dict[Any, list[dict]] = defaultdict(list)

    for i, r in enumerate(reference, 1):
        exact[five_key(r)].add(r["label"])
        same_handle_comment[(r.get("handle"), r.get("comment"))].append({
            "reference_index_1_based": i,
            "label": r["label"],
            "postedDate": r.get("postedDate"),
        })
        ref_by_handle[r.get("handle")].append({
            "reference_index_1_based": i,
            "comment": r.get("comment"),
            "postedDate": r.get("postedDate"),
            "label": r["label"],
        })

    for i, r in enumerate(current, 1):
        current_by_handle[r.get("handle")].append({
            "source_index_1_based": i,
            "source_record_sha256": raw_record_sha256(r),
            "comment": r.get("comment"),
            "postedDate": r.get("postedDate"),
        })

    reused: list[dict] = []
    pending: list[dict] = []
    conflicts: list[dict] = []
    similar: list[dict] = []

    for i, r in enumerate(current, 1):
        row_sha = raw_record_sha256(r)
        labs = exact.get(five_key(r), set())
        if len(labs) == 1:
            reused.append({
                "source_index_1_based": i,
                "source_record_sha256": row_sha,
                "label": next(iter(labs)),
            })
            continue
        if len(labs) > 1:
            conflicts.append({
                "source_index_1_based": i,
                "source_record_sha256": row_sha,
                "record": r,
                "reference_labels": sorted(labs),
            })
        item = {
            "source_index_1_based": i,
            "source_record_sha256": row_sha,
            "record": r,
        }
        hints = same_handle_comment.get((r.get("handle"), r.get("comment")), [])
        if hints:
            item["same_handle_comment_reference"] = hints
            similar.append(item)
        pending.append(item)

    pending_handles = sorted({p["record"].get("handle") for p in pending}, key=lambda x: str(x))
    handle_context = {}
    for h in pending_handles:
        handle_context[str(h)] = {
            "handle": h,
            "current_input": current_by_handle.get(h, []),
            "prior_reference": ref_by_handle.get(h, []),
        }

    for b, start in enumerate(range(0, len(pending), args.batch_size), 1):
        batch_name = f"batch_{b:03d}"
        batch_items = pending[start:start + args.batch_size]
        dump_json(batches_dir / f"{batch_name}.json", batch_items)
        batch_handles = sorted({item["record"].get("handle") for item in batch_items}, key=lambda x: str(x))
        batch_context = {str(handle): handle_context[str(handle)] for handle in batch_handles}
        dump_json(batches_dir / f"{batch_name}_context.json", batch_context)
        with (batches_dir / f"{batch_name}_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
            for item in batch_items:
                w.writerow([item["source_index_1_based"], item["source_record_sha256"], "", ""])

    dump_json(outdir / "stage13_exact_reuse.json", reused)
    dump_json(outdir / "stage13_review_queue.json", pending)
    dump_json(outdir / "stage13_handle_context.json", handle_context)
    dump_json(outdir / "stage13_similar_reference_hints.json", similar)
    dump_json(outdir / "stage13_reference_conflicts.json", conflicts)

    with (outdir / "stage13_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
        for p in pending:
            w.writerow([p["source_index_1_based"], p["source_record_sha256"], "", ""])

    state = {
        "workspace_schema_version": 2,
        "pipeline_version": VERSION,
        "input_file": str(input_path),
        "input_sha256": input_sha,
        "input_records": len(current),
        "reference_file": str(ref_path.resolve()),
        "reference_sha256": reference_sha,
        "reference_records": len(reference),
        "batch_size": args.batch_size,
    }
    dump_json(_workspace_state_path(outdir), state)

    report = {
        **state,
        "exact_reuse_records": len(reused),
        "pending_records": len(pending),
        "pending_batch_count": (len(pending) + args.batch_size - 1) // args.batch_size,
        "same_handle_comment_reference_hints": len(similar),
        "exact_reference_conflicts": len(conflicts),
        "pending_handles": len(pending_handles),
        "invariant": (
            "Finalization is bound to the prepared input SHA-256 and each row's 5-field SHA-256. "
            "Exact matches are rechecked against the same reference snapshot."
        ),
    }
    dump_json(outdir / "stage13_prepare_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def load_stage13_adjudications(path: Path) -> dict[int, dict]:
    out: dict[int, dict] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"source_index_1_based", "source_record_sha256", "label", "note"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"adjudication CSV requires columns {sorted(required)}")
        for row_no, row in enumerate(reader, 2):
            raw_idx = (row.get("source_index_1_based") or "").strip()
            if not raw_idx:
                continue
            try:
                idx = int(raw_idx)
            except ValueError:
                raise ValueError(f"adjudication row {row_no}: invalid source index {raw_idx!r}")
            row_sha = (row.get("source_record_sha256") or "").strip()
            label = (row.get("label") or "").strip()
            note = (row.get("note") or "").strip()
            if not label:
                continue
            if len(row_sha) != 64 or any(c not in "0123456789abcdef" for c in row_sha.lower()):
                raise ValueError(f"adjudication row {row_no}: invalid source_record_sha256")
            if label not in STAGE13_LABELS:
                raise ValueError(f"adjudication row {row_no}: invalid label {label!r}")
            if idx in out:
                raise ValueError(f"duplicate adjudication for source index {idx}")
            out[idx] = {"source_record_sha256": row_sha.lower(), "label": label, "note": note}
    return out


def load_stage13_adjudications_dir(directory: Path, workspace: Path, pending: list[dict]) -> dict[int, dict]:
    if not directory.is_dir():
        raise FileNotFoundError(f"Stage 13 adjudications directory is unavailable: {directory}")

    expected_by_name: dict[str, set[int]] = {}
    batches_dir = workspace / "pending_batches"
    if batches_dir.is_dir():
        for batch_path in sorted(batches_dir.iterdir()):
            match = re.fullmatch(r"(batch_\d{3})\.json", batch_path.name)
            if not match:
                continue
            batch = load_json(batch_path)
            if not isinstance(batch, list):
                raise ValueError(f"Stage 13 batch must be an array: {batch_path.name}")
            expected_by_name[f"{match.group(1)}_adjudications.csv"] = {
                int(item["source_index_1_based"]) for item in batch
            }

    actual_names = {
        item.name for item in directory.iterdir()
        if item.is_file() and re.fullmatch(r"batch_.*_adjudications\.csv", item.name)
    }
    expected_names = set(expected_by_name)
    unknown = sorted(actual_names - expected_names)
    missing = sorted(expected_names - actual_names)
    if unknown:
        raise ValueError(f"unknown Stage 13 batch adjudication files: {unknown}")
    if missing:
        raise ValueError(f"missing Stage 13 batch adjudication files: {missing}")

    merged: dict[int, dict] = {}
    for name in sorted(expected_by_name):
        decisions = load_stage13_adjudications(directory / name)
        expected_indices = expected_by_name[name]
        actual_indices = set(decisions)
        if actual_indices != expected_indices:
            missing_indices = sorted(expected_indices - actual_indices)
            extra_indices = sorted(actual_indices - expected_indices)
            raise ValueError(
                f"Stage 13 batch adjudication coverage mismatch for {name}; "
                f"missing={missing_indices[:20]}, extra={extra_indices[:20]}"
            )
        for idx, decision in decisions.items():
            if not decision["note"].strip():
                raise ValueError(f"Stage 13 directory adjudication requires a non-empty note at source index {idx}")
            if idx in merged:
                raise ValueError(f"duplicate adjudication for source index {idx} across batch files")
            merged[idx] = decision

    pending_indices = {int(item["source_index_1_based"]) for item in pending}
    if set(merged) != pending_indices:
        raise ValueError(
            "Stage 13 directory adjudications do not cover the prepared pending records; "
            f"missing={sorted(pending_indices - set(merged))[:20]}, extra={sorted(set(merged) - pending_indices)[:20]}"
        )
    return merged


def _load_bound_reference(args: argparse.Namespace, state: dict) -> tuple[Path, list[dict]]:
    ref_path = args.reference
    if ref_path is None:
        recorded = state.get("reference_file")
        if not recorded:
            raise FileNotFoundError("Stage 13 workspace does not contain a bound reference; supply --reference explicitly")
        ref_path = Path(recorded)
    if not ref_path.exists():
        raise FileNotFoundError(
            f"bound Stage 13 reference is unavailable: {ref_path}. Supply --reference explicitly."
        )
    actual_sha = sha256_file(ref_path)
    expected_sha = state.get("reference_sha256")
    if actual_sha != expected_sha:
        raise ValueError(
            "Stage 13 reference SHA-256 differs from the reference used during prepare-stage13; "
            f"expected={expected_sha}, actual={actual_sha}"
        )
    return ref_path, validate_stage13_records(load_json(ref_path))


def cmd_finalize_stage13(args: argparse.Namespace) -> int:
    current = validate_raw_records(load_json(args.input_json), exact_fields=True)
    workspace = args.workspace
    state = load_json(_workspace_state_path(workspace))

    if state.get("workspace_schema_version") != 2:
        raise ValueError("unsupported or legacy Stage 13 workspace; rerun prepare-stage13 with this version")
    actual_input_sha = sha256_file(args.input_json)
    if actual_input_sha != state.get("input_sha256"):
        raise ValueError(
            "Stage 13 input SHA-256 differs from the input used during prepare-stage13; "
            f"expected={state.get('input_sha256')}, actual={actual_input_sha}"
        )
    if len(current) != state.get("input_records"):
        raise ValueError("Stage 13 input record count differs from prepared workspace")

    _, reference = _load_bound_reference(args, state)
    exact_reference: dict[tuple, set[str]] = defaultdict(set)
    for r in reference:
        exact_reference[five_key(r)].add(r["label"])

    reused = load_json(workspace / "stage13_exact_reuse.json")
    pending = load_json(workspace / "stage13_review_queue.json")
    adjudications_file = getattr(args, "adjudications", None)
    adjudications_dir = getattr(args, "adjudications_dir", None)
    if adjudications_file and adjudications_dir:
        raise ValueError("--adjudications and --adjudications-dir are mutually exclusive")
    if adjudications_dir:
        adjudications = load_stage13_adjudications_dir(adjudications_dir, workspace, pending)
    elif adjudications_file:
        adjudications = load_stage13_adjudications(adjudications_file)
    else:
        raise ValueError("one of --adjudications or --adjudications-dir is required")

    reused_map: dict[int, str] = {}
    for item in reused:
        idx = int(item["source_index_1_based"])
        if idx < 1 or idx > len(current):
            raise ValueError(f"stage13_exact_reuse index out of range: {idx}")
        expected_row_sha = raw_record_sha256(current[idx - 1])
        if item.get("source_record_sha256") != expected_row_sha:
            raise ValueError(f"stage13_exact_reuse row fingerprint mismatch at source index {idx}")
        labs = exact_reference.get(five_key(current[idx - 1]), set())
        if len(labs) != 1 or item.get("label") != next(iter(labs)):
            raise ValueError(f"stage13_exact_reuse no longer agrees with bound reference at source index {idx}")
        if idx in reused_map:
            raise ValueError(f"duplicate exact-reuse source index {idx}")
        reused_map[idx] = item["label"]

    pending_map: dict[int, str] = {}
    for item in pending:
        idx = int(item["source_index_1_based"])
        if idx < 1 or idx > len(current):
            raise ValueError(f"stage13_review_queue index out of range: {idx}")
        expected_row_sha = raw_record_sha256(current[idx - 1])
        if item.get("source_record_sha256") != expected_row_sha:
            raise ValueError(f"stage13_review_queue row fingerprint mismatch at source index {idx}")
        if five_key(item.get("record", {})) != five_key(current[idx - 1]):
            raise ValueError(f"stage13_review_queue record mismatch at source index {idx}")
        if idx in pending_map:
            raise ValueError(f"duplicate pending source index {idx}")
        pending_map[idx] = expected_row_sha

    overlap = sorted(set(reused_map) & set(pending_map))
    if overlap:
        raise ValueError(f"workspace has reused/pending overlap; first={overlap[:20]}")
    coverage = set(reused_map) | set(pending_map)
    if coverage != set(range(1, len(current) + 1)):
        missing_coverage = sorted(set(range(1, len(current) + 1)) - coverage)
        extra_coverage = sorted(coverage - set(range(1, len(current) + 1)))
        raise ValueError(
            f"workspace coverage mismatch; missing={missing_coverage[:20]}, extra={extra_coverage[:20]}"
        )

    illegal_overrides = sorted(set(adjudications) & set(reused_map))
    if illegal_overrides:
        raise ValueError(
            "exact-reuse Stage 13 records may not be overridden; indices=" +
            ",".join(map(str, illegal_overrides[:20]))
        )

    pending_indices = set(pending_map)
    missing = sorted(pending_indices - set(adjudications))
    extra = sorted(set(adjudications) - pending_indices)
    if missing:
        print(
            f"ERROR: {len(missing)} pending Stage 13 adjudications unresolved; first={missing[:20]}",
            file=sys.stderr,
        )
        return 2
    if extra:
        raise ValueError(f"adjudications contain non-pending indices: {extra[:20]}")

    for idx, decision in adjudications.items():
        if decision["source_record_sha256"] != pending_map[idx]:
            raise ValueError(
                f"adjudication row fingerprint mismatch at source index {idx}; "
                "the CSV is stale or was edited against another input"
            )

    output = []
    audit = []
    for i, raw in enumerate(current, 1):
        if i in reused_map:
            label = reused_map[i]
            source = "exact_reference_reuse"
            note = ""
        elif i in adjudications:
            label = adjudications[i]["label"]
            source = "explicit_adjudication"
            note = adjudications[i]["note"]
        else:
            raise RuntimeError(f"internal coverage error at source index {i}")
        clean = {f: raw[f] for f in FIELDS}
        clean["label"] = label
        output.append(clean)
        audit.append({
            "source_index_1_based": i,
            "source_record_sha256": raw_record_sha256(raw),
            "label": label,
            "label_source": source,
            "note": note,
        })

    dump_json(args.output, output)
    audit_path = args.audit or args.output.with_name("audit_stage13.json")
    dump_json(audit_path, audit)

    report = {
        "pipeline_version": VERSION,
        "workspace_schema_version": state["workspace_schema_version"],
        "records": len(output),
        "label_counts": dict(Counter(r["label"] for r in output)),
        "exact_reference_reuse": sum(x["label_source"] == "exact_reference_reuse" for x in audit),
        "explicit_adjudications": sum(x["label_source"] == "explicit_adjudication" for x in audit),
        "input_sha256": actual_input_sha,
        "reference_sha256": state["reference_sha256"],
        "output_sha256": sha256_file(args.output),
        "provenance_binding": "input_sha256+per_row_sha256+reference_sha256_recheck",
    }
    report_path = args.output.with_name("stage13_finalize_report.json")
    dump_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def matches(text: str, terms: list[str]) -> list[str]:
    return [t for t in terms if t in text]


def load_golden_registry(path: Path | None) -> tuple[dict[str, dict], dict]:
    if path is None:
        return {}, {"schema_version": None, "registry_version": None, "decisions": []}
    raw = load_json(path)
    if not isinstance(raw, dict):
        raise ValueError("golden registry must be a JSON object")
    if raw.get("schema_version") != 1:
        raise ValueError("golden registry schema_version must be 1")
    if not str(raw.get("registry_version", "")).strip():
        raise ValueError("golden registry registry_version must be non-empty")
    decisions = raw.get("decisions")
    if not isinstance(decisions, list):
        raise ValueError("golden registry decisions must be an array")
    if "decision_count" in raw and raw.get("decision_count") != len(decisions):
        raise ValueError("golden registry decision_count does not match decisions length")
    out: dict[str, dict] = {}
    for i, d in enumerate(decisions, 1):
        if not isinstance(d, dict):
            raise ValueError(f"golden decision {i}: must be an object")
        required = {"record_key", "stage13_label", "label", "reason_code", "rationale"}
        missing = required - set(d)
        if missing:
            raise ValueError(f"golden decision {i}: missing fields {sorted(missing)}")
        key = str(d.get("record_key", "")).strip().lower()
        if len(key) != 24 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError(f"golden decision {i}: invalid record_key")
        if key in out:
            raise ValueError(f"golden decision {i}: duplicate record_key {key}")
        if d.get("stage13_label") not in STAGE13_LABELS:
            raise ValueError(f"golden decision {i}: invalid stage13_label {d.get('stage13_label')!r}")
        if d.get("label") not in THREE_LABELS:
            raise ValueError(f"golden decision {i}: invalid label {d.get('label')!r}")
        if d.get("reason_code") not in GOLDEN_REASON_CODES:
            raise ValueError(f"golden decision {i}: invalid reason_code {d.get('reason_code')!r}")
        if not str(d.get("rationale", "")).strip():
            raise ValueError(f"golden decision {i}: rationale must be non-empty")
        out[key] = d
    return out, raw



def load_p2_registry(path: Path | None) -> tuple[dict[str, dict], dict]:
    if path is None:
        return {}, {"schema_version": None, "registry_version": None, "decisions": []}
    raw = load_json(path)
    if not isinstance(raw, dict):
        raise ValueError("P2 registry must be a JSON object")
    if raw.get("schema_version") != 1:
        raise ValueError("P2 registry schema_version must be 1")
    if not str(raw.get("registry_version", "")).strip():
        raise ValueError("P2 registry registry_version must be non-empty")
    decisions = raw.get("decisions")
    if not isinstance(decisions, list):
        raise ValueError("P2 registry decisions must be an array")
    if "decision_count" in raw and raw.get("decision_count") != len(decisions):
        raise ValueError("P2 registry decision_count does not match decisions length")
    out: dict[str, dict] = {}
    for i, d in enumerate(decisions, 1):
        if not isinstance(d, dict):
            raise ValueError(f"P2 decision {i}: must be an object")
        required = {"record_key", "stage13_label", "label", "reason_code", "rationale"}
        missing = required - set(d)
        if missing:
            raise ValueError(f"P2 decision {i}: missing fields {sorted(missing)}")
        key = str(d.get("record_key", "")).strip().lower()
        if len(key) != 24 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError(f"P2 decision {i}: invalid record_key")
        if key in out:
            raise ValueError(f"P2 decision {i}: duplicate record_key {key}")
        if d.get("stage13_label") != "normal":
            raise ValueError(f"P2 decision {i}: stage13_label must be 'normal'")
        if d.get("label") not in THREE_LABELS:
            raise ValueError(f"P2 decision {i}: invalid label {d.get('label')!r}")
        if d.get("reason_code") not in P2_REASON_CODES:
            raise ValueError(f"P2 decision {i}: invalid reason_code {d.get('reason_code')!r}")
        expected_label_by_reason = {
            "confirm_normal": "normal",
            "reactive_context": "reactive",
            "direct_target": "direct_nuisance",
            "spam_or_inappropriate_request": "direct_nuisance",
        }
        if d.get("label") != expected_label_by_reason[d.get("reason_code")]:
            raise ValueError(
                f"P2 decision {i}: label {d.get('label')!r} is inconsistent with reason_code {d.get('reason_code')!r}"
            )
        if not str(d.get("rationale", "")).strip():
            raise ValueError(f"P2 decision {i}: rationale must be non-empty")
        out[key] = d
    return out, raw

def load_three_overrides(path: Path | None) -> dict[str, dict]:
    if path is None:
        return {}
    out: dict[str, dict] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"record_key", "label", "note"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"override CSV requires columns {sorted(required)}")
        for row_no, row in enumerate(reader, 2):
            key = (row.get("record_key") or "").strip()
            label = (row.get("label") or "").strip()
            note = (row.get("note") or "").strip()
            if not key and not label and not note:
                continue
            if not key or not label:
                raise ValueError(f"override row {row_no}: record_key and label must both be present")
            if label not in THREE_LABELS:
                raise ValueError(f"override row {row_no}: invalid label {label!r}")
            if key in out:
                raise ValueError(f"override row {row_no}: duplicate record_key {key}")
            out[key] = {"label": label, "note": note, "row_no": row_no}
    return out


EXPECTED_LABEL_BY_GOLDEN_REASON = {
    "direct_target": "direct_nuisance",
    "mixed_target": "direct_nuisance",
    "spam": "direct_nuisance",
    "anti_target": "reactive",
    "support_reaction": "reactive",
    "meta_reaction": "reactive",
    "quoted_attack": "reactive",
    "normal_context": "normal",
}
EXPECTED_LABEL_BY_P2_REASON = {
    "confirm_normal": "normal",
    "reactive_context": "reactive",
    "direct_target": "direct_nuisance",
    "spam_or_inappropriate_request": "direct_nuisance",
}
OPERATIONAL_RATIONALE = {
    "direct_target": "Reviewed exact case as a direct nuisance target.",
    "mixed_target": "Reviewed exact case as a mixed target requiring direct nuisance classification.",
    "spam": "Reviewed exact case as spam or an inappropriate nuisance message.",
    "anti_target": "Reviewed exact case as a reaction targeting an anti or critic.",
    "support_reaction": "Reviewed exact case as a supportive reaction to criticism.",
    "meta_reaction": "Reviewed exact case as a meta-level reaction to comment discourse.",
    "quoted_attack": "Reviewed exact case as a quoted or referenced attack context.",
    "normal_context": "Reviewed exact case and retained the normal classification.",
    "confirm_normal": "Reviewed exact P2 case and retained the normal classification.",
    "reactive_context": "Reviewed exact P2 case as a reaction context.",
    "spam_or_inappropriate_request": "Reviewed exact P2 case as spam or an inappropriate request.",
}


def _operational_decision(decision: dict) -> dict:
    reason_code = decision.get("reason_code")
    if reason_code not in OPERATIONAL_RATIONALE:
        raise ValueError(f"unsupported reason_code for operational registry: {reason_code!r}")
    return {
        "record_key": str(decision["record_key"]).lower(),
        "stage13_label": decision["stage13_label"],
        "label": decision["label"],
        "reason_code": reason_code,
        "rationale": OPERATIONAL_RATIONALE[reason_code],
    }


def _operational_registry(decisions: list[dict]) -> dict:
    normalized = [_operational_decision(decision) for decision in decisions]
    normalized.sort(key=lambda decision: decision["record_key"])
    keys = [decision["record_key"] for decision in normalized]
    if len(keys) != len(set(keys)):
        raise ValueError("operational registry contains duplicate record_key values")
    return {
        "schema_version": 1,
        "registry_version": "operational",
        "decision_count": len(normalized),
        "decisions": normalized,
    }


def _read_review_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"record_key", "label", "reason_code", "note"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"promotion CSV requires columns {sorted(required)}")
        rows = []
        for row_no, row in enumerate(reader, 2):
            values = {key: (row.get(key) or "").strip() for key in required}
            if not any(values.values()):
                continue
            if not all(values.values()):
                raise ValueError(f"promotion CSV row {row_no}: record_key, label, reason_code, note are required")
            rows.append({**values, "row_no": row_no})
    return rows


def _load_registry_for_promotion(path: Path, loader) -> dict[str, dict]:
    if not path.exists():
        return {}
    registry, _ = loader(path)
    return registry


def _merge_operational_decision(target: dict[str, dict], decision: dict) -> None:
    key = decision["record_key"]
    existing = target.get(key)
    normalized = _operational_decision(decision)
    if existing is not None:
        existing_normalized = _operational_decision(existing)
        if existing_normalized != normalized:
            raise ValueError(f"existing decision conflict for record_key {key}")
        return
    target[key] = normalized


def promote_three_class_decisions(
    audit_path: Path,
    golden_review_path: Path,
    p2_review_path: Path | None,
    golden_registry_path: Path,
    p2_registry_path: Path,
    golden_output: Path,
    p2_output: Path,
) -> dict:
    audits = load_json(audit_path)
    if not isinstance(audits, list):
        raise ValueError("three-class audit must be an array")
    audit_by_key = {}
    for audit in audits:
        key = str(audit.get("record_key", "")).lower()
        if len(key) != 24 or key in audit_by_key:
            raise ValueError(f"invalid or duplicate audit record_key: {key!r}")
        audit_by_key[key] = audit

    golden = _load_registry_for_promotion(golden_registry_path, load_golden_registry)
    p2 = _load_registry_for_promotion(p2_registry_path, load_p2_registry)
    promoted = {"golden": 0, "p2": 0}

    def process(rows: list[dict], *, is_p2: bool) -> None:
        for row in rows:
            key = row["record_key"].lower()
            audit = audit_by_key.get(key)
            if audit is None:
                raise ValueError(f"review record_key is not present in current audit: {key}")
            if not audit.get("review_required"):
                raise ValueError(f"record_key is not a review target: {key}")
            priority = audit.get("review_priority")
            reasons = set(audit.get("review_reasons") or [])
            if is_p2:
                if priority != 2 or reasons != {"source_normal_direct_cue"}:
                    raise ValueError(f"record_key is not an eligible P2 review target: {key}")
                expected = EXPECTED_LABEL_BY_P2_REASON.get(row["reason_code"])
                destination = p2
            else:
                if priority not in MANDATORY_REVIEW_PRIORITIES:
                    raise ValueError(f"record_key is not a mandatory P0/P1 review target: {key}")
                expected = EXPECTED_LABEL_BY_GOLDEN_REASON.get(row["reason_code"])
                destination = golden
            if expected is None or expected != row["label"]:
                raise ValueError(f"reason_code/label mismatch for record_key {key}")
            decision = {
                "record_key": key,
                "stage13_label": audit.get("stage13_label"),
                "label": row["label"],
                "reason_code": row["reason_code"],
                "rationale": OPERATIONAL_RATIONALE[row["reason_code"]],
            }
            if decision["stage13_label"] not in STAGE13_LABELS:
                raise ValueError(f"invalid stage13_label in current audit for record_key {key}")
            _merge_operational_decision(destination, decision)
            promoted["p2" if is_p2 else "golden"] += 1

    process(_read_review_csv(golden_review_path), is_p2=False)
    if p2_review_path is not None:
        process(_read_review_csv(p2_review_path), is_p2=True)

    overlap = sorted(set(golden) & set(p2))
    if overlap:
        raise ValueError(f"golden and P2 registries overlap; first={overlap[:20]}")
    golden_payload = _operational_registry(list(golden.values()))
    p2_payload = _operational_registry(list(p2.values()))
    dump_json(golden_output, golden_payload)
    dump_json(p2_output, p2_payload)
    return {
        "golden_promoted": promoted["golden"],
        "p2_promoted": promoted["p2"],
        "golden_count": golden_payload["decision_count"],
        "p2_count": p2_payload["decision_count"],
    }


def bootstrap_operational_registries(
    golden_source: Path,
    p2_source: Path,
    golden_output: Path,
    p2_output: Path,
) -> dict:
    golden, _ = load_golden_registry(golden_source)
    p2, _ = load_p2_registry(p2_source)
    if set(golden) & set(p2):
        raise ValueError("baseline golden and P2 registries overlap")
    golden_payload = _operational_registry(list(golden.values()))
    p2_payload = _operational_registry(list(p2.values()))
    dump_json(golden_output, golden_payload)
    dump_json(p2_output, p2_payload)
    return {"golden_count": golden_payload["decision_count"], "p2_count": p2_payload["decision_count"]}


def classify_three(
    record: dict,
    reactive_terms: list[str],
    review_cues: dict,
    golden: dict | None = None,
    override: dict | None = None,
    p2_adjudication: dict | None = None,
) -> tuple[dict, dict]:
    old = record.get("label")
    if old not in STAGE13_LABELS:
        raise ValueError(f"upstream label must be normal/nuisance, got {old!r}")

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

    reasons: list[str] = []
    priority = None
    if old == "nuisance" and reactive_hits and direct_hits:
        reasons.append("mixed_direct_reactive")
        priority = 0
    if not reactive_hits and latent_hits:
        reasons.append("possible_reactive_without_primary_term")
        priority = 1 if priority is None else min(priority, 1)
    if old == "normal" and direct_hits and not reactive_hits:
        reasons.append("source_normal_direct_cue")
        priority = 2 if priority is None else min(priority, 2)
    if not text.strip():
        reasons.append("empty_comment")
        priority = 2 if priority is None else min(priority, 2)

    key = record_key(record)
    final = provisional
    review_note = ""
    override_applied = False
    golden_applied = False
    golden_reason_code = None
    golden_rationale = ""
    p2_adjudication_applied = False
    p2_reason_code = None
    p2_rationale = ""
    decision_source = "provisional_rule"

    if golden:
        if golden.get("stage13_label") != old:
            raise ValueError(f"golden decision stage13_label mismatch for record_key {key}")
        final = golden["label"]
        golden_applied = True
        golden_reason_code = golden.get("reason_code")
        golden_rationale = str(golden.get("rationale", "")).strip()
        review_note = golden_rationale
        decision_source = "golden_adjudication"

    if p2_adjudication:
        if golden_applied:
            raise ValueError(f"record_key {key} is present in both golden and P2 registries")
        if p2_adjudication.get("stage13_label") != old:
            raise ValueError(f"P2 decision stage13_label mismatch for record_key {key}")
        if priority != 2 or set(reasons) != {"source_normal_direct_cue"}:
            raise ValueError(
                f"P2 decision {key} no longer maps to an isolated source_normal_direct_cue; "
                f"priority={priority}, reasons={reasons}. Re-adjudicate under current policy."
            )
        final = p2_adjudication["label"]
        p2_adjudication_applied = True
        p2_reason_code = p2_adjudication.get("reason_code")
        p2_rationale = str(p2_adjudication.get("rationale", "")).strip()
        review_note = p2_rationale
        decision_source = "p2_adjudication"

    if override:
        if golden_applied or p2_adjudication_applied:
            registry_name = "golden" if golden_applied else "P2"
            raise ValueError(
                f"manual override for {registry_name} record_key {key} is not allowed; "
                "update the versioned registry under change control instead"
            )
        final = override["label"]
        review_note = override.get("note", "")
        override_applied = True
        decision_source = "manual_override"
        if old == "normal" and final == "direct_nuisance" and not review_note.strip():
            raise ValueError(
                "normal->direct_nuisance requires an explicit override note in compatibility mode"
            )
        if final != provisional and not review_note.strip():
            raise ValueError("an override that changes the provisional label requires a non-empty note")
        if priority in MANDATORY_REVIEW_PRIORITIES and not review_note.strip():
            raise ValueError("P0/P1 review resolution requires a non-empty note")

    review_resolved = (not reasons) or golden_applied or p2_adjudication_applied or (
        override_applied and (priority not in MANDATORY_REVIEW_PRIORITIES or bool(review_note.strip()))
    )

    clean = {f: record[f] for f in FIELDS}
    clean["label"] = final
    audit = {
        "record_key": key,
        "stage13_label": old,
        "label_provisional": provisional,
        "label_final": final,
        "labeling_version": VERSION,
        "matched_reactive_terms": reactive_hits,
        "matched_direct_cues": direct_hits,
        "matched_latent_reactive_cues": latent_hits,
        "matched_spam_cues": spam_hits,
        "review_required": bool(reasons),
        "review_priority": priority,
        "review_reasons": reasons,
        "review_resolved": review_resolved,
        "review_note": review_note,
        "decision_source": decision_source,
        "golden_applied": golden_applied,
        "golden_reason_code": golden_reason_code,
        "golden_rationale": golden_rationale,
        "p2_adjudication_applied": p2_adjudication_applied,
        "p2_reason_code": p2_reason_code,
        "p2_rationale": p2_rationale,
        "override_applied": override_applied,
    }
    return clean, audit


def write_three_review_csv(path: Path, stage13: list[dict], audits: list[dict]) -> None:
    fields = [
        "source_index_1_based", "record_key", "review_priority", "review_reasons",
        "review_resolved", "decision_source", "golden_reason_code", "p2_reason_code",
        "stage13_label", "label_provisional", "label_final",
        "matched_reactive_terms", "matched_direct_cues",
        "matched_latent_reactive_cues", "comment",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for i, (r, a) in enumerate(zip(stage13, audits), 1):
            if not a["review_required"]:
                continue
            w.writerow({
                "source_index_1_based": i,
                "record_key": a["record_key"],
                "review_priority": a["review_priority"],
                "review_reasons": "|".join(a["review_reasons"]),
                "review_resolved": a["review_resolved"],
                "decision_source": a["decision_source"],
                "golden_reason_code": a["golden_reason_code"] or "",
                "p2_reason_code": a["p2_reason_code"] or "",
                "stage13_label": a["stage13_label"],
                "label_provisional": a["label_provisional"],
                "label_final": a["label_final"],
                "matched_reactive_terms": "|".join(a["matched_reactive_terms"]),
                "matched_direct_cues": "|".join(a["matched_direct_cues"]),
                "matched_latent_reactive_cues": "|".join(a["matched_latent_reactive_cues"]),
                "comment": r.get("comment", ""),
            })


def write_three_override_template(
    path: Path, audits: list[dict], *, priorities: set[int] | None = None
) -> None:
    seen = set()
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["record_key", "label", "reason_code", "note"])
        for a in audits:
            if not a["review_required"] or a["review_resolved"]:
                continue
            if priorities is not None and a["review_priority"] not in priorities:
                continue
            if a["record_key"] in seen:
                continue
            w.writerow([a["record_key"], "", "", ""])
            seen.add(a["record_key"])


def cmd_three_class(args: argparse.Namespace) -> int:
    stage13 = validate_stage13_records(load_json(args.stage13_json))
    reactive_path = ROOT / "config" / "reactive_terms.json"
    cues_path = ROOT / "config" / "review_cues.json"
    policy_path = ROOT / "config" / "three_class_policy.json"
    reactive_terms = load_json(reactive_path)
    review_cues = load_json(cues_path)
    policy = load_json(policy_path)
    term_only = getattr(args, "term_only", False)
    golden_path = None if term_only or getattr(args, "no_golden", False) else (getattr(args, "golden_registry", None) or default_golden_registry())
    p2_path = None if term_only or getattr(args, "no_p2_adjudications", False) else (getattr(args, "p2_registry", None) or default_p2_registry())
    golden, golden_meta = load_golden_registry(golden_path)
    p2_registry, p2_meta = load_p2_registry(p2_path)
    overlap_registry_keys = sorted(set(golden) & set(p2_registry))
    if overlap_registry_keys:
        raise ValueError(f"golden and P2 registries overlap; first={overlap_registry_keys[:20]}")
    overrides = load_three_overrides(args.overrides)

    known_keys = {record_key(r) for r in stage13}
    unknown_override_keys = sorted(set(overrides) - known_keys)
    if unknown_override_keys:
        raise ValueError(
            "override CSV contains record_key values not present in this Stage 13 input; "
            f"first={unknown_override_keys[:20]}"
        )

    args.outdir.mkdir(parents=True, exist_ok=True)
    final_path = args.outdir / "three_class_labeled.json"
    if final_path.exists():
        final_path.unlink()

    candidate_rows = []
    audits = []
    for i, record in enumerate(stage13, 1):
        key = record_key(record)
        clean, audit = classify_three(record, reactive_terms, review_cues, golden.get(key), overrides.get(key), p2_registry.get(key))
        audit["source_index_1_based"] = i
        candidate_rows.append(clean)
        audits.append(audit)

    unresolved_mandatory = [
        a for a in audits
        if a["review_required"] and a["review_priority"] in MANDATORY_REVIEW_PRIORITIES and not a["review_resolved"]
    ]
    review_rows = [a for a in audits if a["review_required"]]

    candidate_path = args.outdir / "three_class_candidate.json"
    audit_path = args.outdir / "audit_three_class.json"
    dump_json(candidate_path, candidate_rows)
    dump_json(audit_path, audits)
    write_three_review_csv(args.outdir / "review_queue.csv", stage13, audits)
    dump_json(args.outdir / "review_queue.json", [
        {**a, "comment": stage13[a["source_index_1_based"] - 1].get("comment", "")}
        for a in review_rows
    ])
    write_three_override_template(
        args.outdir / "manual_overrides.csv", audits, priorities=MANDATORY_REVIEW_PRIORITIES
    )
    write_three_override_template(
        args.outdir / "optional_p2_overrides.csv", audits, priorities={2}
    )

    final_published = not unresolved_mandatory
    if final_published:
        dump_json(final_path, candidate_rows)

    config_hashes = {
        "reactive_terms_sha256": sha256_file(reactive_path),
        "review_cues_sha256": sha256_file(cues_path),
        "three_class_policy_sha256": sha256_file(policy_path),
        "golden_registry_sha256": sha256_file(golden_path) if golden_path else None,
        "p2_registry_sha256": sha256_file(p2_path) if p2_path else None,
    }
    summary = {
        "pipeline_version": VERSION,
        "three_class_policy_version": policy["policy_version"],
        "input_file": str(args.stage13_json),
        "input_sha256": sha256_file(args.stage13_json),
        "config_sha256": config_hashes,
        "records": len(candidate_rows),
        "candidate_label_counts": dict(Counter(r["label"] for r in candidate_rows)),
        "provisional_label_counts": dict(Counter(a["label_provisional"] for a in audits)),
        "transition_counts": dict(Counter(f'{a["stage13_label"]}->{a["label_final"]}' for a in audits)),
        "review_items": len(review_rows),
        "review_priority_counts": dict(Counter(str(a["review_priority"]) for a in review_rows)),
        "unresolved_mandatory_reviews": len(unresolved_mandatory),
        "unresolved_optional_p2_reviews": sum(
            a["review_required"] and a["review_priority"] == 2 and not a["review_resolved"] for a in audits
        ),
        "golden_registry_file": str(golden_path) if golden_path else None,
        "golden_registry_version": golden_meta.get("registry_version"),
        "golden_registry_entries": len(golden),
        "golden_adjudications_applied": sum(a["golden_applied"] for a in audits),
        "p2_registry_file": str(p2_path) if p2_path else None,
        "p2_registry_version": p2_meta.get("registry_version"),
        "p2_registry_entries": len(p2_registry),
        "p2_adjudications_applied": sum(a["p2_adjudication_applied"] for a in audits),
        "manual_overrides_applied": sum(a["override_applied"] for a in audits),
        "overrides_applied": sum(a["override_applied"] for a in audits),
        "candidate_output_sha256": sha256_file(candidate_path),
        "final_published": final_published,
        "final_output_sha256": sha256_file(final_path) if final_published else None,
        "publication_rule": "three_class_labeled.json is published only when all P0/P1 reviews are resolved",
    }
    dump_json(args.outdir / "summary.json", summary)
    dump_json(args.outdir / "publication_status.json", {
        "pipeline_version": VERSION,
        "final_published": final_published,
        "unresolved_mandatory_reviews": len(unresolved_mandatory),
        "unresolved_optional_p2_reviews": sum(
            a["review_required"] and a["review_priority"] == 2 and not a["review_resolved"] for a in audits
        ),
        "candidate_file": candidate_path.name,
        "final_file": final_path.name if final_published else None,
    })
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if args.strict_final and unresolved_mandatory:
        print(
            f"STRICT FINAL FAILED: {len(unresolved_mandatory)} unresolved P0/P1 items. "
            "No three_class_labeled.json was published.",
            file=sys.stderr,
        )
        return 2
    return 0


def _check_clean_alignment(
    raw: list[dict],
    labeled: list[dict],
    allowed: set[str],
    stage: str,
) -> tuple[dict, list[str]]:
    checks = {}
    errors = []
    expected = set(FIELDS) | {"label"}
    checks[f"{stage}_count_matches_input"] = len(raw) == len(labeled)
    checks[f"{stage}_fields_exact"] = all(isinstance(r, dict) and set(r) == expected for r in labeled)
    checks[f"{stage}_labels_valid"] = all(isinstance(r, dict) and r.get("label") in allowed for r in labeled)
    aligned = len(raw) == len(labeled) and all(
        all(raw[i].get(f) == labeled[i].get(f) for f in FIELDS)
        for i in range(len(raw))
    )
    checks[f"{stage}_five_fields_and_order_preserved"] = aligned
    if not all(checks.values()):
        errors.append(f"{stage}: one or more clean-output invariants failed")
    return checks, errors


def cmd_validate(args: argparse.Namespace) -> int:
    raw = validate_raw_records(load_json(args.input_json), exact_fields=True)
    stage13 = validate_stage13_records(load_json(args.stage13_json))
    three = load_json(args.three_class_json)

    checks = {}
    errors = []
    c, e = _check_clean_alignment(raw, stage13, STAGE13_LABELS, "stage13")
    checks.update(c)
    errors.extend(e)
    c, e = _check_clean_alignment(raw, three, THREE_LABELS, "three_class")
    checks.update(c)
    errors.extend(e)

    if args.reference is not None:
        reference_path = args.reference
    elif getattr(args, "bootstrap", False):
        reference_path = default_reference()
    else:
        reference_path = default_private_reference()
    if not reference_path.exists():
        raise FileNotFoundError(
            f"Stage 13 validation reference is unavailable: {reference_path}. "
            "Supply --reference explicitly or use --bootstrap only for bootstrap."
        )
    reference = validate_stage13_records(load_json(reference_path))
    prior: dict[tuple, set[str]] = defaultdict(set)
    for r in reference:
        prior[five_key(r)].add(r["label"])
    mismatches = []
    exact_matches = 0
    conflicting_prior_keys = sum(1 for labs in prior.values() if len(labs) > 1)
    for i, r in enumerate(stage13, 1):
        labs = prior.get(five_key(r), set())
        if len(labs) == 1:
            exact_matches += 1
            expected = next(iter(labs))
            if r["label"] != expected:
                mismatches.append({"source_index_1_based": i, "expected": expected, "actual": r["label"]})
    checks["stage13_exact_reference_labels_preserved"] = not mismatches

    audit_info = None
    if args.three_class_audit:
        audits = load_json(args.three_class_audit)
        audit_info = {
            "records": len(audits) if isinstance(audits, list) else None,
            "unresolved_mandatory": None,
        }
        checks["three_class_audit_array"] = isinstance(audits, list)
        if isinstance(audits, list):
            checks["three_class_audit_count_matches"] = len(audits) == len(three)
            aligned = len(audits) == len(three)
            if aligned:
                for i, (s, t, a) in enumerate(zip(stage13, three, audits), 1):
                    if a.get("source_index_1_based") != i:
                        aligned = False
                        break
                    if a.get("record_key") != record_key(s):
                        aligned = False
                        break
                    if a.get("stage13_label") != s.get("label"):
                        aligned = False
                        break
                    if a.get("label_final") != t.get("label"):
                        aligned = False
                        break
            checks["three_class_audit_alignment"] = aligned
            mandatory = sum(
                1 for a in audits
                if a.get("review_required")
                and a.get("review_priority") in MANDATORY_REVIEW_PRIORITIES
                and not a.get("review_resolved")
            )
            audit_info["unresolved_mandatory"] = mandatory
            if args.require_resolved:
                checks["three_class_mandatory_reviews_resolved"] = mandatory == 0

    all_pass = all(checks.values())
    report = {
        "pipeline_version": VERSION,
        "checks": checks,
        "all_checks_passed": all_pass,
        "input_records": len(raw),
        "stage13_label_counts": dict(Counter(r["label"] for r in stage13)),
        "three_class_label_counts": dict(Counter(r.get("label") for r in three if isinstance(r, dict))),
        "reference_exact_matches": exact_matches,
        "reference_label_mismatches": mismatches[:100],
        "reference_conflicting_exact_keys": conflicting_prior_keys,
        "three_class_audit": audit_info,
        "sha256": {
            "input": sha256_file(args.input_json),
            "stage13": sha256_file(args.stage13_json),
            "three_class": sha256_file(args.three_class_json),
            "reference": sha256_file(reference_path),
        },
    }
    if args.report:
        dump_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all_pass else 1


def cmd_promote_three_class(args: argparse.Namespace) -> int:
    result = promote_three_class_decisions(
        audit_path=args.audit,
        golden_review_path=args.review_csv,
        p2_review_path=args.p2_review_csv,
        golden_registry_path=args.golden_registry or default_golden_registry(),
        p2_registry_path=args.p2_registry or default_p2_registry(),
        golden_output=args.out_golden or default_golden_registry(),
        p2_output=args.out_p2 or default_p2_registry(),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_bootstrap_three_class_state(args: argparse.Namespace) -> int:
    result = bootstrap_operational_registries(
        golden_source=args.golden_source or default_baseline_golden_registry(),
        p2_source=args.p2_source or default_baseline_p2_registry(),
        golden_output=args.out_golden or default_golden_registry(),
        p2_output=args.out_p2 or default_p2_registry(),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_prepare_single_roundtrip(args: argparse.Namespace) -> int:
    result = prepare_single_roundtrip(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_finalize_single_roundtrip(args: argparse.Namespace) -> int:
    result = finalize_single_roundtrip(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Integrated Stage 13 -> 3-Class labeling pipeline")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prepare-stage13", help="Prepare exact-reuse and pending Stage 13 review workspace")
    p.add_argument("input_json", type=Path)
    p.add_argument("--reference", type=Path)
    p.add_argument("--bootstrap", action="store_true", help="Use immutable baseline only for the initial bootstrap")
    p.add_argument("--outdir", type=Path, required=True)
    p.add_argument("--batch-size", type=int, default=500)
    p.set_defaults(func=cmd_prepare_stage13)

    p = sub.add_parser("finalize-stage13", help="Assemble clean Stage 13 output from bound workspace + adjudications")
    p.add_argument("input_json", type=Path)
    p.add_argument("--workspace", type=Path, required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--adjudications", type=Path)
    g.add_argument("--adjudications-dir", type=Path)
    p.add_argument("--reference", type=Path, help="Reference snapshot used during prepare; SHA-256 must match workspace")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--audit", type=Path)
    p.set_defaults(func=cmd_finalize_stage13)

    p = sub.add_parser("three-class", help="Transform Stage 13 output to 3 classes with fail-closed final publication")
    p.add_argument("stage13_json", type=Path)
    p.add_argument("--outdir", type=Path, required=True)
    p.add_argument("--overrides", type=Path)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--golden-registry", type=Path, help="Versioned exact-case mandatory golden adjudication registry")
    g.add_argument("--no-golden", action="store_true", help="Disable bundled mandatory P0/P1 golden adjudications")
    h = p.add_mutually_exclusive_group()
    h.add_argument("--p2-registry", type=Path, help="Versioned exact-case P2 adjudication registry")
    h.add_argument("--no-p2-adjudications", action="store_true", help="Disable bundled reviewed P2 adjudications")
    p.add_argument("--term-only", action="store_true", help="Disable all bundled adjudication registries for deterministic term-only reproduction")
    p.add_argument("--strict-final", action="store_true")
    p.set_defaults(func=cmd_three_class)

    p = sub.add_parser("validate", help="Validate clean outputs, lineage, exact reuse and review resolution")
    p.add_argument("--input", dest="input_json", type=Path, required=True)
    p.add_argument("--stage13", dest="stage13_json", type=Path, required=True)
    p.add_argument("--three-class", dest="three_class_json", type=Path, required=True)
    p.add_argument("--reference", type=Path)
    p.add_argument("--bootstrap", action="store_true", help="Use immutable baseline only for the initial bootstrap")
    p.add_argument("--three-class-audit", type=Path)
    p.add_argument("--require-resolved", action="store_true")
    p.add_argument("--report", type=Path)
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("promote-three-class", help="Promote reviewed exact decisions into operational registries")
    p.add_argument("--audit", type=Path, required=True)
    p.add_argument("--review-csv", type=Path, required=True)
    p.add_argument("--p2-review-csv", type=Path)
    p.add_argument("--golden-registry", type=Path)
    p.add_argument("--p2-registry", type=Path)
    p.add_argument("--out-golden", type=Path)
    p.add_argument("--out-p2", type=Path)
    p.set_defaults(func=cmd_promote_three_class)

    p = sub.add_parser("bootstrap-three-class-state", help="Create minimal operational registries from immutable baselines")
    p.add_argument("--golden-source", type=Path)
    p.add_argument("--p2-source", type=Path)
    p.add_argument("--out-golden", type=Path)
    p.add_argument("--out-p2", type=Path)
    p.set_defaults(func=cmd_bootstrap_three_class_state)

    p = sub.add_parser("prepare-single-roundtrip", help="Prepare one combined Stage13 and Three-Class handoff")
    p.add_argument("input_json", type=Path)
    p.add_argument("--reference", type=Path, required=True)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--state-dir", type=Path)
    p.add_argument("--batch-size", type=int, default=500)
    p.set_defaults(func=cmd_prepare_single_roundtrip)

    p = sub.add_parser("finalize-single-roundtrip", help="Finalize one combined Stage13 and Three-Class response")
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--response", type=Path, required=True)
    p.add_argument("--state-dir", type=Path)
    p.set_defaults(func=cmd_finalize_single_roundtrip)
    return ap


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except (ValueError, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
