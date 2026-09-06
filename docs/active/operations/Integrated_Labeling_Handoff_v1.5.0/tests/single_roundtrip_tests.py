#!/usr/bin/env python3
from __future__ import annotations

import json
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pipeline
import single_roundtrip


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def content_sha(value) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def record(number: int, comment: str) -> dict:
    return {
        "username": f"user-{number}",
        "handle": f"handle-{number}",
        "comment": comment,
        "postedAt": f"2026-09-06T00:00:{number:02d}Z",
        "postedDate": "2026-09-06",
    }


def empty_registry() -> dict:
    return {"schema_version": 1, "registry_version": "operational", "decision_count": 0, "decisions": []}


def make_state(root: Path, golden: list[dict] | None = None, p2: list[dict] | None = None) -> Path:
    state = root / "state"
    state.mkdir()
    golden_payload = empty_registry()
    golden_payload["decisions"] = golden or []
    golden_payload["decision_count"] = len(golden_payload["decisions"])
    p2_payload = empty_registry()
    p2_payload["decisions"] = p2 or []
    p2_payload["decision_count"] = len(p2_payload["decisions"])
    write_json(state / "three_class_golden_adjudications.json", golden_payload)
    write_json(state / "three_class_p2_adjudications.json", p2_payload)
    return state


def prepare(root: Path, current: list[dict], reference: list[dict], state: Path | None = None, name: str = "workspace") -> tuple[Path, dict]:
    input_path = root / f"{name}-input.json"
    reference_path = root / f"{name}-reference.json"
    workspace = root / name
    write_json(input_path, current)
    write_json(reference_path, reference)
    args = type("Args", (), {
        "input_json": input_path,
        "reference": reference_path,
        "workspace": workspace,
        "state_dir": state,
    })()
    result = single_roundtrip.prepare_single_roundtrip(args)
    return workspace, result


def finalize(workspace: Path, state: Path, response: dict, name: str = "response.json") -> dict:
    response_path = workspace.parent / name
    write_json(response_path, response)
    args = type("Args", (), {"workspace": workspace, "response": response_path, "state_dir": state})()
    return single_roundtrip.finalize_single_roundtrip(args)


def test_prepare_dedupes_only_exact_five_fields(root: Path) -> None:
    first = record(1, "same comment")
    second = dict(first)
    third = record(2, "same comment")
    state = make_state(root)
    workspace, result = prepare(root, [first, second, third], [], state)
    assert result["stage13_tasks"] == 2
    tasks = [json.loads(path.read_text()) for path in sorted((workspace / "request" / "stage13").glob("S*.json"))]
    assert tasks[0]["source_rows"][0]["source_index_1_based"] == 1
    assert [row["source_index_1_based"] for row in tasks[0]["source_rows"]] == [1, 2]
    assert tasks[1]["source_rows"][0]["source_index_1_based"] == 3


def test_prepare_existing_workspace_is_fail_closed(root: Path) -> None:
    state = make_state(root)
    workspace, _ = prepare(root, [record(1, "x")], [], state)
    try:
        prepare(root, [record(1, "x")], [], state)
    except ValueError as error:
        assert "workspace already exists" in str(error)
    else:
        raise AssertionError("existing workspace was overwritten")
    assert (workspace / "prepare_receipt.json").is_file()


def test_response_validation_and_retry(root: Path) -> None:
    current = [record(1, "言ってる人はきつ")]
    state = make_state(root)
    workspace, result = prepare(root, current, [], state)
    manifest = json.loads((workspace / "request" / "manifest.json").read_text())
    stage_tasks = [json.loads(path.read_text()) for path in sorted((workspace / "request" / "stage13").glob("S*.json"))]
    three_tasks = [json.loads(path.read_text()) for path in sorted((workspace / "request" / "three_class").glob("T*.json"))]
    response = {
        "schema_version": 1,
        "request_id": manifest["request_id"],
        "stage13_decisions": {stage_tasks[0]["task_id"]: {"label": "normal", "note": "reviewed"}},
        "three_class_decisions": {
            task["task_id"]: ({"reason_code": "quoted_attack", "note": "reviewed"} if task["activation"]["stage13_label"] == "normal" else None)
            for task in three_tasks
        },
    }
    result = finalize(workspace, state, response)
    assert result["state"] == "FINALIZED"
    fallback_csv = workspace / "final" / "fallback" / "stage13_adjudications.csv"
    fallback_golden = workspace / "final" / "fallback" / "three_class_golden_adjudications.json"
    fallback_p2 = workspace / "final" / "fallback" / "three_class_p2_adjudications.json"
    rows = fallback_csv.read_text(encoding="utf-8-sig").splitlines()
    assert rows[0] == "source_index_1_based,source_record_sha256,label,note"
    assert len(rows) == 2
    assert json.loads(fallback_golden.read_text())["decision_count"] >= 1

    legacy_root = ROOT.parents[3] / "docs" / "active" / "operations" / "Integrated_Labeling_Handoff_v1.4 (2).0"
    legacy_workspace = root / "legacy-workspace"
    legacy_stage13 = root / "legacy-stage13.json"
    legacy_three = root / "legacy-three"
    reference_path = root / "response-reference.json"
    input_path = root / "response-input.json"
    input_path.write_text(json.dumps(current, ensure_ascii=False) + "\n", encoding="utf-8")
    reference_path.write_text("[]\n", encoding="utf-8")
    prepare_legacy = subprocess.run(
        [sys.executable, str(legacy_root / "src" / "pipeline.py"), "prepare-stage13", str(input_path), "--reference", str(reference_path), "--outdir", str(legacy_workspace)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert prepare_legacy.returncode == 0, prepare_legacy.stderr
    finalize_legacy = subprocess.run(
        [sys.executable, str(legacy_root / "src" / "pipeline.py"), "finalize-stage13", str(input_path), "--workspace", str(legacy_workspace), "--reference", str(reference_path), "--adjudications", str(fallback_csv), "--output", str(legacy_stage13)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert finalize_legacy.returncode == 0, finalize_legacy.stderr
    three_legacy = subprocess.run(
        [sys.executable, str(legacy_root / "src" / "pipeline.py"), "three-class", str(legacy_stage13), "--outdir", str(legacy_three), "--golden-registry", str(fallback_golden), "--p2-registry", str(fallback_p2), "--strict-final"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert three_legacy.returncode == 0, three_legacy.stderr
    assert json.loads(legacy_stage13.read_text()) == json.loads((workspace / "final" / "stage13_labeled.json").read_text())
    assert json.loads((legacy_three / "three_class_labeled.json").read_text()) == json.loads((workspace / "final" / "three_class_labeled.json").read_text())
    repo_root = ROOT.parents[3]
    release_path = root / "data-release.json"
    release_data_dir = root / "release-data"
    release_data_dir.mkdir()
    public_artifacts = [
        "candidate_registry.json",
        "candidate_evaluation.json",
        "filterKeywordCandidates.json",
        "filterKeywordCandidates.meta.json",
        "run_manifest.json",
        "accountBlockCandidates.json",
        "accountBlockCandidates.meta.json",
        "accountBlockCandidateRunManifest.json",
    ]
    for artifact in public_artifacts:
        shutil.copyfile(repo_root / "package" / "src" / "data" / artifact, release_data_dir / artifact)
    run_manifest_path = release_data_dir / "run_manifest.json"
    run_manifest = json.loads(run_manifest_path.read_text(encoding="utf-8"))
    run_manifest["run_type"] = "full_snapshot"
    write_json(run_manifest_path, run_manifest)
    dataset_sha = f"sha256:{hashlib.sha256((workspace / 'final' / 'three_class_labeled.json').read_bytes()).hexdigest()}"
    run_manifest["source_dataset"]["artifact_sha256"] = dataset_sha
    write_json(run_manifest_path, run_manifest)
    evaluation_path = release_data_dir / "candidate_evaluation.json"
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    evaluation["dataset"]["artifact_sha256"] = dataset_sha
    write_json(evaluation_path, evaluation)
    keyword_meta_path = release_data_dir / "filterKeywordCandidates.meta.json"
    keyword_meta = json.loads(keyword_meta_path.read_text(encoding="utf-8"))
    keyword_meta["dataset_artifact_sha256"] = dataset_sha
    keyword_meta["run_manifest_content_sha256"] = content_sha(run_manifest)
    write_json(keyword_meta_path, keyword_meta)
    account_manifest_path = release_data_dir / "accountBlockCandidateRunManifest.json"
    account_manifest = json.loads(account_manifest_path.read_text(encoding="utf-8"))
    account_manifest["source_dataset"]["artifact_sha256"] = dataset_sha
    write_json(account_manifest_path, account_manifest)
    account_meta_path = release_data_dir / "accountBlockCandidates.meta.json"
    account_meta = json.loads(account_meta_path.read_text(encoding="utf-8"))
    account_meta["dataset_artifact_sha256"] = dataset_sha
    account_meta["run_manifest_content_sha256"] = f"sha256:{hashlib.sha256(account_manifest_path.read_bytes()).hexdigest()}"
    write_json(account_meta_path, account_meta)
    release_command = [
        "node",
        str(repo_root / "package" / "scripts" / "create-data-release.mjs"),
        "--raw", str(input_path),
        "--stage13", str(workspace / "final" / "stage13_labeled.json"),
        "--stage13-reference", str(workspace / "final" / "stage13_labeled.json"),
        "--three-class", str(workspace / "final" / "three_class_labeled.json"),
        "--scope-id", "single-roundtrip-test",
        "--source-ref", "fixture://single-roundtrip",
        "--data-dir", str(release_data_dir),
        "--out", str(release_path),
        "--updated-at", "2026-09-06T00:00:00Z",
    ]
    release_result = subprocess.run(release_command, capture_output=True, text=True, check=False)
    assert release_result.returncode == 0, release_result.stderr
    assert json.loads(release_result.stdout)["valid"] is True
    verify_result = subprocess.run(
        [
            "node",
            str(repo_root / "package" / "scripts" / "verify-release.mjs"),
            "--release", str(release_path),
            "--data-dir", str(release_data_dir),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert verify_result.returncode == 0, verify_result.stderr
    assert json.loads(verify_result.stdout)["valid"] is True
    mismatched_state = workspace.parent / "mismatched-state"
    try:
        finalize(workspace, mismatched_state, response, "mismatched-root-retry.json")
    except ValueError as error:
        assert "state directory" in str(error)
    else:
        raise AssertionError("root receipt retry ignored the state directory binding")
    retry = finalize(workspace, state, response, "retry.json")
    assert retry["idempotent_retry"] is True
    (workspace / "finalization_receipt.json").unlink()
    try:
        finalize(workspace, mismatched_state, response, "mismatched-promoted-retry.json")
    except ValueError as error:
        assert "state directory" in str(error)
    else:
        raise AssertionError("promoted receipt retry ignored the state directory binding")
    promoted_retry = finalize(workspace, state, response, "promoted-retry.json")
    assert promoted_retry["idempotent_retry"] is True

    duplicate = workspace.parent / "duplicate.json"
    duplicate.write_text(json.dumps(response)[:-1] + ',"request_id":"duplicate"}\n', encoding="utf-8")
    args = type("Args", (), {"workspace": workspace, "response": duplicate, "state_dir": state})()
    try:
        single_roundtrip.finalize_single_roundtrip(args)
    except ValueError as error:
        assert "already finalized" in str(error)
    else:
        raise AssertionError("different response was accepted after finalize")


def test_duplicate_response_keys_and_state_binding(root: Path) -> None:
    state = make_state(root)
    workspace, _ = prepare(root, [record(1, "x")], [], state)
    manifest = json.loads((workspace / "request" / "manifest.json").read_text())
    response = workspace.parent / "duplicate-key.json"
    response.write_text(
        "{"
        f'"schema_version":1,"request_id":"{manifest["request_id"]}",'
        '"stage13_decisions":{},"stage13_decisions":{},"three_class_decisions":{}'
        "}\n",
        encoding="utf-8",
    )
    args = type("Args", (), {"workspace": workspace, "response": response, "state_dir": root / "other-state"})()
    try:
        single_roundtrip.finalize_single_roundtrip(args)
    except ValueError as error:
        assert "state directory" in str(error) or "duplicate JSON" in str(error)
    else:
        raise AssertionError("invalid response was accepted")


def test_zero_human_path(root: Path) -> None:
    item = record(1, "ordinary")
    reference = [dict(item, label="normal")]
    state = make_state(root)
    workspace, result = prepare(root, [item], reference, state)
    assert result["state"] == "FINALIZED_NO_HANDOFF"
    receipt = json.loads((workspace / "prepare_receipt.json").read_text())
    assert receipt["state"] == "FINALIZED_NO_HANDOFF"
    assert (workspace / "final" / "three_class_labeled.json").is_file()
    assert not list(workspace.glob("classification_handoff_*.zip"))


def test_cli_contract(root: Path) -> None:
    state = make_state(root)
    input_path = root / "cli-input.json"
    reference_path = root / "cli-reference.json"
    workspace = root / "cli-workspace"
    write_json(input_path, [record(1, "ordinary")])
    write_json(reference_path, [dict(record(1, "ordinary"), label="normal")])
    command = [sys.executable, str(ROOT / "src" / "pipeline.py"), "prepare-single-roundtrip", str(input_path), "--reference", str(reference_path), "--workspace", str(workspace), "--state-dir", str(state)]
    success = subprocess.run(command, capture_output=True, text=True, check=False)
    assert success.returncode == 0, success.stderr
    assert json.loads(success.stdout)["state"] == "FINALIZED_NO_HANDOFF"
    failure = subprocess.run(command, capture_output=True, text=True, check=False)
    assert failure.returncode == 3
    assert failure.stdout == ""
    assert failure.stderr.startswith("ERROR: ")


def main() -> int:
    tests = [
        test_prepare_dedupes_only_exact_five_fields,
        test_prepare_existing_workspace_is_fail_closed,
        test_response_validation_and_retry,
        test_duplicate_response_keys_and_state_binding,
        test_zero_human_path,
        test_cli_contract,
    ]
    with tempfile.TemporaryDirectory(prefix="single-roundtrip-tests-") as path:
        root = Path(path)
        for test in tests:
            test_root = root / test.__name__
            test_root.mkdir()
            test(test_root)
            print(f"OK: {test.__name__}")
    print(f"ALL OK: {len(tests)} single-roundtrip tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())