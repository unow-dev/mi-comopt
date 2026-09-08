#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import csv
import io
import json
import os
import shutil
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = "single-roundtrip-v1"
PIPELINE_VERSION = "1.5.0"
SCHEMA_VERSION = 1
STAGE13_LABELS = {"normal", "nuisance"}
MANDATORY_PRIORITIES = {0, 1}
GOLDEN_REASON_CODES = {
    "direct_target",
    "mixed_target",
    "spam",
    "anti_target",
    "support_reaction",
    "meta_reaction",
    "quoted_attack",
    "normal_context",
}

REVIEW_INSTRUCTIONS = """# Single-roundtrip review instructions

1. Review every Stage13 task and return one `normal` or `nuisance` decision with a non-empty note.
2. Recompute the active Three-Class tasks after Stage13 decisions are complete.
3. Return one JSON response containing every S-task and every T-task. Use `null` for inactive T-tasks.
4. Use only the existing Stage13 and Three-Class prompts supplied in this request package.
5. Do not add task IDs, record keys, labels, or reason codes that are absent from the request package.
"""


def _legacy():
    import pipeline

    return pipeline


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / ".git").exists():
            return parent
    return current.parents[5]


def _default_state_dir() -> Path:
    return _repo_root() / "docs" / "active" / "operations" / "integrated-labeling-state"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def _strict_json_bytes(data: bytes, description: str) -> Any:
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid JSON in {description}: {error}") from error


def _strict_json_path(path: Path) -> Any:
    return _strict_json_bytes(path.read_bytes(), str(path))


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _file_entry(root: Path, path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": _sha256(data),
        "bytes": len(data),
    }


def _assert_file_entry(root: Path, entry: dict[str, Any]) -> None:
    path = root / entry["path"]
    if not path.is_file():
        raise ValueError(f"bound file is missing: {entry['path']}")
    data = path.read_bytes()
    if _sha256(data) != entry.get("sha256") or len(data) != entry.get("bytes"):
        raise ValueError(f"bound file has changed: {entry['path']}")


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _empty_registry() -> dict[str, Any]:
    return {"schema_version": 1, "registry_version": "operational", "decision_count": 0, "decisions": []}


def _resolved_state_dir(value: Path | None) -> Path:
    return (value or _default_state_dir()).resolve()


def _workspace_exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _make_temp_workspace(target: Path) -> Path:
    if _workspace_exists(target):
        raise ValueError(f"workspace already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=f".{target.name}.", dir=str(target.parent)))


def _clean_temp(path: Path | None) -> None:
    if path is not None and path.exists():
        shutil.rmtree(path)


def _copy_snapshot(source: Path, destination: Path) -> dict[str, Any]:
    if not source.is_file():
        raise ValueError(f"snapshot source is unavailable: {source}")
    data = source.read_bytes()
    _write_bytes(destination, data)
    return {"path": destination.relative_to(destination.parents[1]).as_posix(), "sha256": _sha256(data), "bytes": len(data)}


def _snapshot_file(source: Path, snapshot_root: Path, relative: str, *, fallback: bytes | None = None) -> dict[str, Any]:
    destination = snapshot_root / relative
    if source.is_file():
        data = source.read_bytes()
    elif fallback is not None:
        data = fallback
    else:
        raise ValueError(f"operational state file is unavailable: {source}")
    _write_bytes(destination, data)
    return {"path": relative, "sha256": _sha256(data), "bytes": len(data), "source": str(source.resolve())}


def _load_registry_snapshot(source: Path, snapshot_root: Path, relative: str, loader) -> tuple[dict[str, dict], dict[str, Any], dict[str, Any]]:
    fallback = (_canonical_json(_empty_registry()) + b"\n") if not source.exists() else None
    entry = _snapshot_file(source, snapshot_root, relative, fallback=fallback)
    snapshot_path = snapshot_root / relative
    registry, raw = loader(snapshot_path)
    return registry, raw, entry


def _source_rows(items: list[dict], legacy) -> list[dict[str, Any]]:
    return [
        {
            "source_index_1_based": int(item["source_index_1_based"]),
            "source_record_sha256": legacy.raw_record_sha256(item["record"]),
        }
        for item in items
    ]


def _audit_signature(audit: dict[str, Any]) -> dict[str, Any]:
    excluded = {"source_index_1_based"}
    return {key: value for key, value in audit.items() if key not in excluded}


def _validate_task_id(value: Any, prefix: str) -> bool:
    return isinstance(value, str) and value.startswith(prefix) and value[1:].isdigit() and len(value) == 7


def _semantic_files(request_root: Path) -> list[dict[str, Any]]:
    files = []
    for path in sorted(request_root.rglob("*")):
        if not path.is_file() or path.name in {"manifest.json", "response.schema.json", "response_template.json"}:
            continue
        files.append(_file_entry(request_root, path))
    return files


def _derived_files(request_root: Path) -> list[dict[str, Any]]:
    return [
        _file_entry(request_root, request_root / "response.schema.json"),
        _file_entry(request_root, request_root / "response_template.json"),
    ]


def _response_schema(request_id: str, stage_ids: list[str], three_ids: list[str]) -> dict[str, Any]:
    stage_properties = {
        task_id: {
            "type": "object",
            "additionalProperties": False,
            "required": ["label", "note"],
            "properties": {
                "label": {"enum": ["normal", "nuisance"]},
                "note": {"type": "string", "minLength": 1},
            },
        }
        for task_id in stage_ids
    }
    three_properties = {
        task_id: {
            "oneOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["reason_code", "note"],
                    "properties": {
                        "reason_code": {"enum": sorted(GOLDEN_REASON_CODES)},
                        "note": {"type": "string", "minLength": 1},
                    },
                },
            ]
        }
        for task_id in three_ids
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["schema_version", "request_id", "stage13_decisions", "three_class_decisions"],
        "properties": {
            "schema_version": {"const": SCHEMA_VERSION},
            "request_id": {"const": request_id},
            "stage13_decisions": {
                "type": "object",
                "additionalProperties": False,
                "required": stage_ids,
                "properties": stage_properties,
            },
            "three_class_decisions": {
                "type": "object",
                "additionalProperties": False,
                "required": three_ids,
                "properties": three_properties,
            },
        },
    }


def _build_stage13_tasks(current: list[dict], reference: list[dict], legacy) -> tuple[list[dict], dict[int, str], dict[int, str]]:
    exact: dict[tuple, set[str]] = defaultdict(set)
    for item in reference:
        exact[legacy.five_key(item)].add(item["label"])

    current_by_handle: dict[str, list[dict[str, Any]]] = defaultdict(list)
    reference_by_handle: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for index, record in enumerate(current, 1):
        current_by_handle[str(record["handle"])].append({
            "source_index_1_based": index,
            "source_record_sha256": legacy.raw_record_sha256(record),
            "comment": record["comment"],
            "postedDate": record["postedDate"],
        })
    for index, record in enumerate(reference, 1):
        reference_by_handle[str(record["handle"])].append({
            "reference_index_1_based": index,
            "comment": record["comment"],
            "postedDate": record["postedDate"],
            "label": record["label"],
        })

    reused: dict[int, str] = {}
    pending_groups: dict[tuple, dict[str, Any]] = {}
    for index, record in enumerate(current, 1):
        key = legacy.five_key(record)
        labels = exact.get(key, set())
        if len(labels) == 1:
            reused[index] = next(iter(labels))
            continue
        if key not in pending_groups:
            pending_groups[key] = {
                "record": record,
                "source_items": [],
                "reference_labels": sorted(labels),
            }
        pending_groups[key]["source_items"].append({
            "source_index_1_based": index,
            "record": record,
        })

    stage_tasks = []
    source_to_task: dict[int, str] = {}
    for task_number, group in enumerate(sorted(pending_groups.values(), key=lambda item: item["source_items"][0]["source_index_1_based"]), 1):
        task_id = f"S{task_number:06d}"
        rows = _source_rows(group["source_items"], legacy)
        task = {
            "task_id": task_id,
            "record": group["record"],
            "source_rows": rows,
            "reference_labels": group["reference_labels"],
            "context": {
                "handle": group["record"]["handle"],
                "current_input": current_by_handle[str(group["record"]["handle"])],
                "prior_reference": reference_by_handle[str(group["record"]["handle"])],
            },
        }
        stage_tasks.append(task)
        for row in rows:
            source_to_task[row["source_index_1_based"]] = task_id
    return stage_tasks, reused, source_to_task


def _build_potential_tasks(current: list[dict], stage_tasks: list[dict], reused: dict[int, str], source_to_task: dict[int, str], golden: dict[str, dict], p2: dict[str, dict], reactive_terms: list[str], review_cues: dict, legacy) -> list[dict]:
    stage_task_by_id = {task["task_id"]: task for task in stage_tasks}
    candidates: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(current, 1):
        branch_labels = [reused[index]] if index in reused else ["normal", "nuisance"]
        for stage_label in branch_labels:
            stage13_record = {field: raw[field] for field in legacy.FIELDS}
            stage13_record["label"] = stage_label
            key = legacy.record_key(stage13_record)
            clean, audit = legacy.classify_three(
                stage13_record,
                reactive_terms,
                review_cues,
                golden.get(key),
                None,
                p2.get(key),
            )
            mandatory = bool(
                audit.get("review_required")
                and audit.get("review_priority") in MANDATORY_PRIORITIES
                and not audit.get("review_resolved")
            )
            if not mandatory:
                continue
            activation = {"kind": "unconditional"}
            if index not in reused:
                activation = {
                    "kind": "stage13_branch",
                    "stage13_task_id": source_to_task[index],
                    "stage13_label": stage_label,
                }
            existing = candidates.get(key)
            candidate = {
                "record_key": key,
                "record": stage13_record,
                "clean": clean,
                "audit": audit,
                "activation": activation,
                "source_indices": [index],
            }
            if existing is not None:
                if _audit_signature(existing["audit"]) != _audit_signature(audit):
                    raise ValueError(f"same record_key has inconsistent potential task state: {key}")
                if existing["activation"] != activation:
                    raise ValueError(f"same record_key has inconsistent activation: {key}")
                existing["source_indices"].append(index)
            else:
                candidates[key] = candidate

    ordered = sorted(candidates.values(), key=lambda item: (min(item["source_indices"]), item["record_key"]))
    for number, task in enumerate(ordered, 1):
        task["task_id"] = f"T{number:06d}"
        task["source_rows"] = [{"source_index_1_based": index} for index in task["source_indices"]]
        task.pop("source_indices")
    return ordered


def _write_request_files(workspace: Path, stage_tasks: list[dict], three_tasks: list[dict], pipeline_root: Path) -> tuple[dict, dict]:
    request_root = workspace / "request"
    _write_bytes(request_root / "REVIEW_INSTRUCTIONS.md", REVIEW_INSTRUCTIONS.encode("utf-8"))
    for source_name in ("STAGE13_REVIEW_PROMPT.md", "THREE_CLASS_REVIEW_PROMPT.md"):
        source = pipeline_root / "prompts" / source_name
        _write_bytes(request_root / "prompts" / source_name, source.read_bytes())
    for task in stage_tasks:
        _write_json(request_root / "stage13" / f"{task['task_id']}.json", task)
    for task in three_tasks:
        _write_json(request_root / "three_class" / f"{task['task_id']}.json", task)

    semantic = _semantic_files(request_root)
    return request_root, {"semantic": {"files": semantic}}


def _create_handoff_zip(workspace: Path, request_id: str) -> Path:
    target = workspace / f"classification_handoff_{request_id}.zip"
    request_root = workspace / "request"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        paths = sorted(path for path in request_root.rglob("*") if path.is_file())
        for path in paths:
            relative = path.relative_to(workspace).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    return target


def _prepare_workspace(args, workspace: Path) -> dict[str, Any]:
    legacy = _legacy()
    pipeline_root = Path(__file__).resolve().parents[1]
    input_path = Path(args.input_json).resolve()
    reference_path = Path(args.reference).resolve()
    state_dir = _resolved_state_dir(getattr(args, "state_dir", None))
    current = legacy.validate_raw_records(_strict_json_path(input_path), exact_fields=True)
    reference = legacy.validate_stage13_records(_strict_json_path(reference_path))

    snapshot_root = workspace / "snapshot"
    input_entry = _snapshot_file(input_path, snapshot_root, "input.json")
    reference_entry = _snapshot_file(reference_path, snapshot_root, "stage13_reference.json")
    implementation_entry = _snapshot_file(pipeline_root / "manifest.json", snapshot_root, "implementation_manifest.json")

    golden_path = state_dir / "three_class_golden_adjudications.json"
    p2_path = state_dir / "three_class_p2_adjudications.json"
    golden, golden_raw, golden_entry = _load_registry_snapshot(golden_path, snapshot_root, "golden_registry.json", legacy.load_golden_registry)
    p2, p2_raw, p2_entry = _load_registry_snapshot(p2_path, snapshot_root, "p2_registry.json", legacy.load_p2_registry)
    if set(golden) & set(p2):
        raise ValueError("golden and P2 registries overlap")

    config_entries = []
    config_values = {}
    for name in ("reactive_terms.json", "review_cues.json", "three_class_policy.json", "integrated_policy.json"):
        source = pipeline_root / "config" / name
        relative = f"config/{name}"
        config_entries.append(_snapshot_file(source, snapshot_root, relative))
        config_values[name] = _strict_json_path(snapshot_root / relative)

    stage_tasks, reused, source_to_task = _build_stage13_tasks(current, reference, legacy)
    three_tasks = _build_potential_tasks(
        current,
        stage_tasks,
        reused,
        source_to_task,
        golden,
        p2,
        config_values["reactive_terms.json"],
        config_values["review_cues.json"],
        legacy,
    )

    request_root, request_parts = _write_request_files(workspace, stage_tasks, three_tasks, pipeline_root)
    bindings = {
        "input_sha256": input_entry["sha256"],
        "stage13_reference_sha256": reference_entry["sha256"],
        "golden_registry_sha256": golden_entry["sha256"],
        "p2_registry_sha256": p2_entry["sha256"],
        "relevant_config_sha256": {entry["path"]: entry["sha256"] for entry in config_entries},
        "implementation_manifest_sha256": implementation_entry["sha256"],
    }
    request_preimage = {
        "schema_version": SCHEMA_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "bindings": bindings,
        "semantic": request_parts["semantic"],
    }
    request_id = _sha256(_canonical_json(request_preimage))
    schema = _response_schema(request_id, [task["task_id"] for task in stage_tasks], [task["task_id"] for task in three_tasks])
    template = {
        "schema_version": SCHEMA_VERSION,
        "request_id": request_id,
        "stage13_decisions": {task["task_id"]: {"label": "", "note": ""} for task in stage_tasks},
        "three_class_decisions": {task["task_id"]: None for task in three_tasks},
    }
    _write_json(request_root / "response.schema.json", schema)
    _write_json(request_root / "response_template.json", template)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "request_id": request_id,
        "bindings": bindings,
        "semantic": {"files": _semantic_files(request_root)},
        "derived": {"files": _derived_files(request_root)},
    }
    _write_json(request_root / "manifest.json", manifest)

    snapshot_entries = [input_entry, reference_entry, implementation_entry, golden_entry, p2_entry, *config_entries]
    _write_json(snapshot_root / "snapshot_manifest.json", {"schema_version": 1, "files": snapshot_entries})
    prepare_receipt = {
        "schema_version": 1,
        "protocol_version": PROTOCOL_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "request_id": request_id,
        "state": "AWAITING_RESPONSE" if stage_tasks or three_tasks else "FINALIZED_NO_HANDOFF",
        "workspace": str(workspace),
        "resolved_state_dir": str(state_dir),
        "bindings": bindings,
        "task_counts": {"stage13": len(stage_tasks), "three_class": len(three_tasks)},
        "snapshot": {"files": snapshot_entries},
        "request_manifest": "request/manifest.json",
        "human_decisions": len(stage_tasks) + len(three_tasks),
    }
    _write_json(workspace / "prepare_receipt.json", prepare_receipt)
    result = {
        "request_id": request_id,
        "state": prepare_receipt["state"],
        "workspace": str(workspace),
        "resolved_state_dir": str(state_dir),
        "stage13_tasks": len(stage_tasks),
        "three_class_tasks": len(three_tasks),
        "human_decisions": prepare_receipt["human_decisions"],
    }
    if stage_tasks or three_tasks:
        result["handoff_zip"] = str(_create_handoff_zip(workspace, request_id))
    return result


def prepare_single_roundtrip(args) -> dict[str, Any]:
    target = Path(args.workspace).resolve()
    temp_workspace = _make_temp_workspace(target)
    try:
        result = _prepare_workspace(args, temp_workspace)
        if result["human_decisions"] == 0:
            _finalize_workspace(temp_workspace, None, None, state_dir=Path(result["resolved_state_dir"]))
            prepare_receipt = _strict_json_path(temp_workspace / "prepare_receipt.json")
            prepare_receipt["state"] = "FINALIZED_NO_HANDOFF"
            _write_json(temp_workspace / "prepare_receipt.json", prepare_receipt)
            result["state"] = "FINALIZED_NO_HANDOFF"
        temp_workspace.rename(target)
        result["workspace"] = str(target)
        if "handoff_zip" in result:
            result["handoff_zip"] = str(target / Path(result["handoff_zip"]).name)
        return result
    except Exception:
        _clean_temp(temp_workspace)
        raise


def _verify_request_workspace(workspace: Path, requested_state_dir: Path | None) -> tuple[dict, dict, list[dict], list[dict], Path]:
    receipt = _strict_json_path(workspace / "prepare_receipt.json")
    manifest = _strict_json_path(workspace / "request" / "manifest.json")
    if receipt.get("request_id") != manifest.get("request_id"):
        raise ValueError("prepare receipt and request manifest request_id differ")
    resolved_state = Path(receipt.get("resolved_state_dir", "")).resolve()
    if requested_state_dir is not None and requested_state_dir.resolve() != resolved_state:
        raise ValueError("--state-dir differs from the state directory bound during prepare")
    if manifest.get("schema_version") != SCHEMA_VERSION or manifest.get("protocol_version") != PROTOCOL_VERSION or manifest.get("pipeline_version") != PIPELINE_VERSION:
        raise ValueError("unsupported request manifest version")
    preimage = {
        "schema_version": manifest["schema_version"],
        "protocol_version": manifest["protocol_version"],
        "pipeline_version": manifest["pipeline_version"],
        "bindings": manifest["bindings"],
        "semantic": manifest["semantic"],
    }
    expected_request_id = _sha256(_canonical_json(preimage))
    if manifest.get("request_id") != expected_request_id:
        raise ValueError("request manifest request_id does not match its canonical preimage")
    for entry in manifest.get("semantic", {}).get("files", []):
        _assert_file_entry(workspace / "request", entry)
    for entry in manifest.get("derived", {}).get("files", []):
        _assert_file_entry(workspace / "request", entry)
    snapshot_manifest = _strict_json_path(workspace / "snapshot" / "snapshot_manifest.json")
    for entry in snapshot_manifest.get("files", []):
        _assert_file_entry(workspace / "snapshot", entry)
    bindings = manifest["bindings"]
    if _sha256((workspace / "snapshot" / "implementation_manifest.json").read_bytes()) != bindings.get("implementation_manifest_sha256"):
        raise ValueError("implementation manifest snapshot binding mismatch")
    if receipt.get("bindings") != bindings:
        raise ValueError("prepare receipt bindings differ from request manifest")
    stage_tasks = []
    for path in sorted((workspace / "request" / "stage13").glob("S*.json")):
        task = _strict_json_path(path)
        stage_tasks.append(task)
    three_tasks = []
    for path in sorted((workspace / "request" / "three_class").glob("T*.json")):
        task = _strict_json_path(path)
        three_tasks.append(task)
    return receipt, manifest, stage_tasks, three_tasks, resolved_state


def _validate_response(response: dict[str, Any], manifest: dict[str, Any], stage_tasks: list[dict], three_tasks: list[dict]) -> tuple[dict[str, dict], dict[str, dict | None]]:
    if not isinstance(response, dict):
        raise ValueError("classification response must be an object")
    expected_top = {"schema_version", "request_id", "stage13_decisions", "three_class_decisions"}
    if set(response) != expected_top:
        raise ValueError("classification response has unexpected top-level keys")
    if type(response["schema_version"]) is not int or response["schema_version"] != SCHEMA_VERSION:
        raise ValueError("classification response schema_version is invalid")
    if response["request_id"] != manifest["request_id"]:
        raise ValueError("classification response request_id does not match request")
    stage_map = response["stage13_decisions"]
    three_map = response["three_class_decisions"]
    if not isinstance(stage_map, dict) or not isinstance(three_map, dict):
        raise ValueError("classification decision maps must be objects")
    expected_stage = {task["task_id"] for task in stage_tasks}
    expected_three = {task["task_id"] for task in three_tasks}
    if set(stage_map) != expected_stage:
        raise ValueError("Stage13 decisions do not exactly cover S-tasks")
    if set(three_map) != expected_three:
        raise ValueError("Three-Class decisions do not exactly cover T-tasks")
    for task_id, decision in stage_map.items():
        if not _validate_task_id(task_id, "S") or not isinstance(decision, dict) or set(decision) != {"label", "note"}:
            raise ValueError(f"invalid Stage13 decision shape: {task_id}")
        if decision["label"] not in STAGE13_LABELS:
            raise ValueError(f"invalid Stage13 label for {task_id}")
        if not isinstance(decision["note"], str) or not decision["note"].strip():
            raise ValueError(f"Stage13 note must be non-empty for {task_id}")
    for task_id, decision in three_map.items():
        if not _validate_task_id(task_id, "T"):
            raise ValueError(f"invalid Three-Class task ID: {task_id}")
        if decision is None:
            continue
        if not isinstance(decision, dict) or set(decision) != {"reason_code", "note"}:
            raise ValueError(f"invalid Three-Class decision shape: {task_id}")
        if decision["reason_code"] not in GOLDEN_REASON_CODES:
            raise ValueError(f"invalid Three-Class reason_code for {task_id}")
        if not isinstance(decision["note"], str) or not decision["note"].strip():
            raise ValueError(f"Three-Class note must be non-empty for {task_id}")

    stage_by_id = {task["task_id"]: task for task in stage_tasks}
    for task in three_tasks:
        activation = task["activation"]
        decision = three_map[task["task_id"]]
        active = activation["kind"] == "unconditional"
        if activation["kind"] == "stage13_branch":
            stage_decision = stage_map.get(activation["stage13_task_id"])
            if stage_decision is None or activation["stage13_task_id"] not in stage_by_id:
                raise ValueError(f"Three-Class task has unknown Stage13 activation: {task['task_id']}")
            active = stage_decision["label"] == activation["stage13_label"]
        if active and decision is None:
            raise ValueError(f"active Three-Class task is unresolved: {task['task_id']}")
        if not active and decision is not None:
            raise ValueError(f"inactive Three-Class task must be null: {task['task_id']}")
    return stage_map, three_map


def _stage13_final(current: list[dict], reused: dict[int, str], source_to_task: dict[int, str], stage_decisions: dict[str, dict], stage_tasks: list[dict], legacy) -> tuple[list[dict], list[dict]]:
    task_by_id = {task["task_id"]: task for task in stage_tasks}
    output = []
    audit = []
    for index, raw in enumerate(current, 1):
        if index in reused:
            label = reused[index]
            source = "exact_reference_reuse"
            note = ""
        else:
            task_id = source_to_task[index]
            decision = stage_decisions[task_id]
            label = decision["label"]
            source = "explicit_adjudication"
            note = decision["note"].strip()
            if task_id not in task_by_id:
                raise ValueError(f"unknown Stage13 task binding: {task_id}")
        clean = {field: raw[field] for field in legacy.FIELDS}
        clean["label"] = label
        output.append(clean)
        audit.append({
            "source_index_1_based": index,
            "source_record_sha256": legacy.raw_record_sha256(raw),
            "label": label,
            "label_source": source,
            "note": note,
        })
    return output, audit


def _three_class_final(stage13: list[dict], three_tasks: list[dict], three_decisions: dict[str, dict | None], golden: dict[str, dict], p2: dict[str, dict], reactive_terms: list[str], review_cues: dict, legacy) -> tuple[list[dict], list[dict], list[dict]]:
    task_by_key = {task["record_key"]: task for task in three_tasks}
    output = []
    audits = []
    active_decisions = []
    for index, record in enumerate(stage13, 1):
        key = legacy.record_key(record)
        clean, audit = legacy.classify_three(record, reactive_terms, review_cues, golden.get(key), None, p2.get(key))
        task = task_by_key.get(key)
        if task is not None:
            decision = three_decisions[task["task_id"]]
            active = task["activation"]["kind"] == "unconditional"
            if task["activation"]["kind"] == "stage13_branch":
                active = False
            if task["activation"]["kind"] == "stage13_branch":
                active = record["label"] == task["activation"]["stage13_label"]
            if active:
                if decision is None:
                    raise ValueError(f"active Three-Class task remains unresolved: {task['task_id']}")
                reason = decision["reason_code"]
                expected = legacy.EXPECTED_LABEL_BY_GOLDEN_REASON.get(reason)
                if expected is None:
                    raise ValueError(f"unsupported operational reason code: {reason}")
                clean["label"] = expected
                audit["label_final"] = expected
                audit["review_resolved"] = True
                audit["review_note"] = decision["note"].strip()
                audit["decision_source"] = "golden_adjudication"
                audit["golden_applied"] = True
                audit["golden_reason_code"] = reason
                audit["golden_rationale"] = legacy.OPERATIONAL_RATIONALE[reason]
                active_decisions.append({
                    "record_key": key,
                    "stage13_label": record["label"],
                    "label": expected,
                    "reason_code": reason,
                    "rationale": legacy.OPERATIONAL_RATIONALE[reason],
                    "task_id": task["task_id"],
                    "review_note": decision["note"].strip(),
                })
        audit["source_index_1_based"] = index
        output.append(clean)
        audits.append(audit)
    grouped: dict[str, dict] = {}
    for audit in audits:
        key = audit["record_key"]
        signature = _audit_signature(audit)
        if key in grouped and grouped[key] != signature:
            raise ValueError(f"duplicate audit record_key has inconsistent state: {key}")
        grouped[key] = signature
    unresolved = [
        audit for audit in audits
        if audit.get("review_required") and audit.get("review_priority") in MANDATORY_PRIORITIES and not audit.get("review_resolved")
    ]
    if unresolved:
        raise ValueError(f"unresolved mandatory Three-Class tasks remain: {len(unresolved)}")
    return output, audits, active_decisions


def _prospective_golden(snapshot_golden: dict[str, dict], decisions: list[dict], legacy) -> dict:
    merged = dict(snapshot_golden)
    for decision in decisions:
        normalized = legacy._operational_decision(decision)
        existing = merged.get(normalized["record_key"])
        if existing is not None and legacy._operational_decision(existing) != normalized:
            raise ValueError(f"prospective golden decision conflict: {normalized['record_key']}")
        merged[normalized["record_key"]] = normalized
    return legacy._operational_registry(list(merged.values()))


def _load_live_registry(path: Path, loader) -> dict[str, dict]:
    if not path.exists():
        return {}
    registry, _ = loader(path)
    return registry


def _check_live_conflicts(state_dir: Path, snapshot_golden: dict[str, dict], snapshot_p2: dict[str, dict], prospective: dict, run_keys: set[str], snapshot_p2_sha: str, legacy) -> dict[str, dict]:
    golden_path = state_dir / "three_class_golden_adjudications.json"
    p2_path = state_dir / "three_class_p2_adjudications.json"
    live_golden = _load_live_registry(golden_path, legacy.load_golden_registry)
    live_p2 = _load_live_registry(p2_path, legacy.load_p2_registry)
    if p2_path.exists() and _sha256(p2_path.read_bytes()) != snapshot_p2_sha:
        raise ValueError("live P2 registry changed after prepare")
    if set(live_golden) & set(live_p2):
        raise ValueError("live golden and P2 registries overlap")
    for key, snapshot in snapshot_golden.items():
        current = live_golden.get(key)
        if current is None or legacy._operational_decision(current) != legacy._operational_decision(snapshot):
            raise ValueError(f"live golden snapshot conflict: {key}")
    expected_by_key = {decision["record_key"]: decision for decision in prospective["decisions"]}
    for key in run_keys:
        current = live_golden.get(key)
        if current is not None:
            expected = expected_by_key.get(key)
            if expected is None or legacy._operational_decision(current) != expected:
                raise ValueError(f"live golden decision conflict: {key}")
    return live_golden


def _write_golden_if_needed(state_dir: Path, live_golden: dict[str, dict], prospective: dict, legacy) -> None:
    if live_golden == {decision["record_key"]: decision for decision in prospective["decisions"]}:
        return
    _atomic_json(state_dir / "three_class_golden_adjudications.json", prospective)


def _validate_integrated(raw: list[dict], stage13: list[dict], three: list[dict], reference: list[dict], audits: list[dict], legacy) -> dict[str, Any]:
    checks: dict[str, bool] = {}
    errors: list[str] = []
    check, issue = legacy._check_clean_alignment(raw, stage13, legacy.STAGE13_LABELS, "stage13")
    checks.update(check)
    errors.extend(issue)
    check, issue = legacy._check_clean_alignment(raw, three, legacy.THREE_LABELS, "three_class")
    checks.update(check)
    errors.extend(issue)
    prior: dict[tuple, set[str]] = defaultdict(set)
    for record in reference:
        prior[legacy.five_key(record)].add(record["label"])
    mismatches = []
    for index, record in enumerate(stage13, 1):
        labels = prior.get(legacy.five_key(record), set())
        if len(labels) == 1 and record["label"] != next(iter(labels)):
            mismatches.append(index)
    checks["stage13_exact_reference_labels_preserved"] = not mismatches
    checks["three_class_audit_count_matches"] = len(audits) == len(three)
    checks["three_class_audit_alignment"] = all(
        audit.get("source_index_1_based") == index
        and audit.get("record_key") == legacy.record_key(stage13[index - 1])
        and audit.get("stage13_label") == stage13[index - 1]["label"]
        and audit.get("label_final") == three[index - 1]["label"]
        for index, audit in enumerate(audits, 1)
    )
    if not all(checks.values()):
        errors.append("integrated validation failed")
    return {
        "pipeline_version": PIPELINE_VERSION,
        "checks": checks,
        "all_checks_passed": not errors,
        "errors": errors,
        "input_records": len(raw),
        "reference_label_mismatches": mismatches,
        "sha256": {},
    }


def _fallback_stage13_csv(stage_tasks: list[dict], stage_decisions: dict[str, dict]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(
        buffer,
        fieldnames=["source_index_1_based", "source_record_sha256", "label", "note"],
        lineterminator="\n",
    )
    writer.writeheader()
    for task in stage_tasks:
        decision = stage_decisions[task["task_id"]]
        for row in task["source_rows"]:
            writer.writerow({
                "source_index_1_based": row["source_index_1_based"],
                "source_record_sha256": row["source_record_sha256"],
                "label": decision["label"],
                "note": decision["note"].strip(),
            })
    return buffer.getvalue().encode("utf-8-sig")


def _promote_final(workspace: Path, artifacts: dict[str, bytes | str]) -> None:
    final_target = workspace / "final"
    if final_target.exists():
        raise ValueError("final artifact directory already exists without a finalization receipt")
    temp = Path(tempfile.mkdtemp(prefix=".final.", dir=str(workspace)))
    try:
        for relative, data in artifacts.items():
            target = temp / relative
            if isinstance(data, bytes):
                _write_bytes(target, data)
            else:
                _write_bytes(target, data.encode("utf-8"))
        temp.rename(final_target)
    finally:
        _clean_temp(temp)


def _finalize_workspace(workspace: Path, response_bytes: bytes | None, response: dict | None, *, state_dir: Path | None = None) -> dict[str, Any]:
    legacy = _legacy()
    receipt, manifest, stage_tasks, three_tasks, resolved_state = _verify_request_workspace(workspace, state_dir)
    if receipt.get("state") == "FINALIZED_NO_HANDOFF" and response_bytes is not None:
        raise ValueError("zero-human workspace cannot accept a response")
    if response_bytes is not None:
        response = _strict_json_bytes(response_bytes, "classification response")
        stage_decisions, three_decisions = _validate_response(response, manifest, stage_tasks, three_tasks)
    else:
        if stage_tasks or three_tasks:
            raise ValueError("response is required when human decisions exist")
        stage_decisions, three_decisions = {}, {}

    response_sha = _sha256(response_bytes) if response_bytes is not None else None

    snapshot_root = workspace / "snapshot"
    current = legacy.validate_raw_records(_strict_json_path(snapshot_root / "input.json"), exact_fields=True)
    reference = legacy.validate_stage13_records(_strict_json_path(snapshot_root / "stage13_reference.json"))
    golden, _ = legacy.load_golden_registry(snapshot_root / "golden_registry.json")
    p2, _ = legacy.load_p2_registry(snapshot_root / "p2_registry.json")
    reactive_terms = _strict_json_path(snapshot_root / "config" / "reactive_terms.json")
    review_cues = _strict_json_path(snapshot_root / "config" / "review_cues.json")
    stage13_tasks_by_source = {}
    for task in stage_tasks:
        for row in task["source_rows"]:
            stage13_tasks_by_source[int(row["source_index_1_based"])] = task["task_id"]
    reused = {}
    exact: dict[tuple, set[str]] = defaultdict(set)
    for record in reference:
        exact[legacy.five_key(record)].add(record["label"])
    for index, record in enumerate(current, 1):
        labels = exact.get(legacy.five_key(record), set())
        if len(labels) == 1:
            reused[index] = next(iter(labels))
    stage13, stage13_audit = _stage13_final(current, reused, stage13_tasks_by_source, stage_decisions, stage_tasks, legacy)
    three_class, three_audit, human_golden = _three_class_final(stage13, three_tasks, three_decisions, golden, p2, reactive_terms, review_cues, legacy)
    prospective = _prospective_golden(golden, human_golden, legacy)
    run_keys = {task["record_key"] for task in three_tasks}
    snapshot_p2_sha = _sha256((snapshot_root / "p2_registry.json").read_bytes())
    live_golden = _check_live_conflicts(resolved_state, golden, p2, prospective, run_keys, snapshot_p2_sha, legacy)
    validation = _validate_integrated(current, stage13, three_class, reference, three_audit, legacy)
    if not validation["all_checks_passed"]:
        raise ValueError("integrated validation failed before acceptance")
    stage13_bytes = (json.dumps(stage13, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    three_class_bytes = (json.dumps(three_class, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    stage13_sha = _sha256(stage13_bytes)
    three_class_sha = _sha256(three_class_bytes)
    validation["checks"]["three_class_mandatory_reviews_resolved"] = True
    validation["three_class_audit"] = {"unresolved_mandatory": 0}
    validation["sha256"] = {
        "input": _sha256((snapshot_root / "input.json").read_bytes()),
        "stage13": stage13_sha,
        "three_class": three_class_sha,
    }
    accepted_dir = workspace / "accepted"
    accepted_response = accepted_dir / "response.json"
    if accepted_response.exists():
        existing_bytes = accepted_response.read_bytes()
        if response_sha != _sha256(existing_bytes):
            raise ValueError("accepted response is immutable and has a different SHA-256")
    elif response_bytes is not None:
        accepted_dir.mkdir(parents=True, exist_ok=True)
        _write_bytes(accepted_response, response_bytes)
    if human_golden:
        resolved_state.mkdir(parents=True, exist_ok=True)
        _write_golden_if_needed(resolved_state, live_golden, prospective, legacy)
    final_summary = {
        "pipeline_version": PIPELINE_VERSION,
        "three_class_policy_version": _strict_json_path(snapshot_root / "config" / "three_class_policy.json")["policy_version"],
        "input_sha256": validation["sha256"]["input"],
        "final_output_sha256": three_class_sha,
        "request_id": manifest["request_id"],
        "response_sha256": response_sha,
        "records": len(three_class),
        "human_stage13_tasks": len(stage_tasks),
        "human_three_class_tasks": len(three_tasks),
        "golden_adjudications_applied": sum(1 for audit in three_audit if audit.get("golden_applied")),
        "p2_adjudications_applied": sum(1 for audit in three_audit if audit.get("p2_adjudication_applied")),
        "unresolved_mandatory_reviews": 0,
        "unresolved_optional_p2_reviews": sum(1 for audit in three_audit if audit.get("review_priority") == 2 and not audit.get("review_resolved")),
        "final_published": True,
    }
    audit_sidecar = {
        "schema_version": 1,
        "protocol_version": PROTOCOL_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "request_id": manifest["request_id"],
        "response_sha256": response_sha,
        "stage13_tasks": {task["task_id"]: task["source_rows"] for task in stage_tasks},
        "three_class_tasks": {
            task["task_id"]: {
                "record_key": task["record_key"],
                "activation": task["activation"],
                "response": three_decisions.get(task["task_id"]),
            }
            for task in three_tasks
        },
    }
    artifacts: dict[str, bytes | str] = {}
    for relative, value in {
        "stage13_labeled.json": stage13,
        "audit_stage13.json": stage13_audit,
        "three_class_labeled.json": three_class,
        "audit_three_class.json": three_audit,
        "summary.json": final_summary,
        "validation_report.json": validation,
        "prospective_golden_registry.json": prospective,
        "single_roundtrip_audit.json": audit_sidecar,
    }.items():
        artifacts[relative] = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    artifacts["stage13_labeled.json"] = stage13_bytes
    artifacts["three_class_labeled.json"] = three_class_bytes
    artifacts["fallback/stage13_adjudications.csv"] = _fallback_stage13_csv(stage_tasks, stage_decisions)
    artifacts["fallback/three_class_golden_adjudications.json"] = (
        json.dumps(prospective, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    artifacts["fallback/three_class_p2_adjudications.json"] = (
        (snapshot_root / "p2_registry.json").read_bytes()
    )
    final_receipt = {
        "schema_version": 1,
        "protocol_version": PROTOCOL_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "request_id": manifest["request_id"],
        "response_sha256": response_sha,
        "state": "FINALIZED_NO_HANDOFF" if response_bytes is None else "FINALIZED",
        "golden_registry_commit": bool(human_golden),
    }
    artifacts["finalization_receipt.json"] = (json.dumps(final_receipt, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    _promote_final(workspace, artifacts)
    _write_json(workspace / "finalization_receipt.json", final_receipt)
    if response_bytes is not None:
        _write_json(workspace / "accepted" / "receipt.json", {
            "schema_version": 1,
            "request_id": manifest["request_id"],
            "response_sha256": response_sha,
            "state": "ACCEPTED_COMMIT_PENDING",
        })
    return {
        "request_id": manifest["request_id"],
        "state": final_receipt["state"],
        "workspace": str(workspace),
        "response_sha256": response_sha,
        "final": str(workspace / "final"),
    }


def finalize_single_roundtrip(args) -> dict[str, Any]:
    workspace = Path(args.workspace).resolve()
    if not workspace.is_dir():
        raise ValueError(f"workspace is unavailable: {workspace}")
    requested_state = getattr(args, "state_dir", None)
    requested_state_dir = Path(requested_state).resolve() if requested_state else None
    response_path = Path(args.response).resolve()
    response_bytes = response_path.read_bytes()
    response_sha = _sha256(response_bytes)
    existing_final_receipt = workspace / "finalization_receipt.json"
    if existing_final_receipt.exists():
        _verify_request_workspace(workspace, requested_state_dir)
        final_receipt = _strict_json_path(existing_final_receipt)
        accepted_response = workspace / "accepted" / "response.json"
        if accepted_response.exists() and _sha256(accepted_response.read_bytes()) == response_sha:
            return {
                "request_id": final_receipt["request_id"],
                "state": final_receipt["state"],
                "workspace": str(workspace),
                "response_sha256": response_sha,
                "final": str(workspace / "final"),
                "idempotent_retry": True,
            }
        raise ValueError("workspace is already finalized with another response")
    promoted_receipt = workspace / "final" / "finalization_receipt.json"
    if promoted_receipt.exists():
        _verify_request_workspace(workspace, requested_state_dir)
        final_receipt = _strict_json_path(promoted_receipt)
        if final_receipt.get("response_sha256") != response_sha:
            raise ValueError("final artifact was promoted for another response")
        accepted_response = workspace / "accepted" / "response.json"
        if not accepted_response.exists():
            accepted_response.parent.mkdir(parents=True, exist_ok=True)
            _write_bytes(accepted_response, response_bytes)
        _write_json(workspace / "finalization_receipt.json", final_receipt)
        return {
            "request_id": final_receipt["request_id"],
            "state": final_receipt["state"],
            "workspace": str(workspace),
            "response_sha256": response_sha,
            "final": str(workspace / "final"),
            "idempotent_retry": True,
        }
    return _finalize_workspace(workspace, response_bytes, None, state_dir=requested_state_dir)
