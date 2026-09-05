#!/usr/bin/env python3
from __future__ import annotations

import csv
import importlib.util
import json
import tempfile
from argparse import Namespace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("pipeline", ROOT / "src" / "pipeline.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


def load(path):
    with Path(path).open("r", encoding="utf-8") as f:
        return json.load(f)


def assert_eq(actual, expected, name):
    if actual != expected:
        raise AssertionError(f"{name}: expected {expected!r}, got {actual!r}")


def assert_raises(exc_type, fn, name):
    try:
        fn()
    except exc_type:
        return
    except Exception as e:
        raise AssertionError(f"{name}: expected {exc_type.__name__}, got {type(e).__name__}: {e}") from e
    raise AssertionError(f"{name}: expected {exc_type.__name__}, but no exception was raised")


def test_three_class_regressions():
    reactive = load(ROOT / "config" / "reactive_terms.json")
    cues = load(ROOT / "config" / "review_cues.json")
    cases = load(ROOT / "tests" / "three_class_regression_cases.json")
    for c in cases:
        clean, audit = mod.classify_three(c["record"], reactive, cues, None, None)
        assert_eq(audit["label_provisional"], c["expected_provisional"], f'{c["name"]}.label_provisional')
        assert_eq(audit["review_required"], c["expected_review_required"], f'{c["name"]}.review_required')
        if "expected_priority" in c:
            assert_eq(audit["review_priority"], c["expected_priority"], f'{c["name"]}.review_priority')
        assert_eq(set(clean), set(mod.FIELDS) | {"label"}, f'{c["name"]}.clean_fields')
    return len(cases)


def test_raw_contract_is_strict_and_duplicate_preserving():
    valid = [{f: "same" for f in mod.FIELDS}, {f: "same" for f in mod.FIELDS}]
    assert_eq(len(mod.validate_raw_records(valid)), 2, "duplicate raw rows are preserved")
    for field in mod.FIELDS:
        invalid = {f: "value" for f in mod.FIELDS}
        invalid[field] = None
        assert_raises(ValueError, lambda invalid=invalid: mod.validate_raw_records([invalid]), f"raw null rejection: {field}")
        invalid[field] = 1
        assert_raises(ValueError, lambda invalid=invalid: mod.validate_raw_records([invalid]), f"raw number rejection: {field}")
        invalid[field] = {}
        assert_raises(ValueError, lambda invalid=invalid: mod.validate_raw_records([invalid]), f"raw object rejection: {field}")
        invalid[field] = []
        assert_raises(ValueError, lambda invalid=invalid: mod.validate_raw_records([invalid]), f"raw array rejection: {field}")
    return 1


def test_operational_registry_promotion_contract():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        audit_path = td / "audit.json"
        golden_key = "a" * 24
        p2_key = "b" * 24
        mod.dump_json(audit_path, [
            {"record_key": golden_key, "stage13_label": "normal", "review_required": True, "review_priority": 1, "review_reasons": ["possible_reactive_without_primary_term"]},
            {"record_key": p2_key, "stage13_label": "normal", "review_required": True, "review_priority": 2, "review_reasons": ["source_normal_direct_cue"]},
        ])
        golden_review = td / "golden.csv"
        with golden_review.open("w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows([
                ["record_key", "label", "reason_code", "note"],
                [golden_key, "reactive", "quoted_attack", "human note is private"],
            ])
        p2_review = td / "p2.csv"
        with p2_review.open("w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows([
                ["record_key", "label", "reason_code", "note"],
                [p2_key, "normal", "confirm_normal", "another private note"],
            ])
        golden_out, p2_out = td / "golden.json", td / "p2.json"
        result = mod.promote_three_class_decisions(
            audit_path, golden_review, p2_review, td / "missing-golden.json", td / "missing-p2.json", golden_out, p2_out
        )
        assert_eq(result["golden_count"], 1, "promoted golden count")
        assert_eq(result["p2_count"], 1, "promoted p2 count")
        golden = load(golden_out)
        assert_eq(golden["decisions"][0]["record_key"], golden_key, "record key ordering")
        assert_eq(golden["decisions"][0]["rationale"], "Reviewed exact case as a quoted or referenced attack context.", "safe rationale")
        assert_eq("human note is private" in json.dumps(golden), False, "review note is not published")
    return 3


def test_baseline_three_class():
    baseline = mod.validate_stage13_records(load(ROOT / "reference" / "stage13_labeled_REFERENCE.json"))
    reactive = load(ROOT / "config" / "reactive_terms.json")
    cues = load(ROOT / "config" / "review_cues.json")
    final = []
    audits = []
    for r in baseline:
        clean, audit = mod.classify_three(r, reactive, cues, None, None)
        final.append(clean)
        audits.append(audit)
    counts = {}
    for r in final:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    expected = load(ROOT / "reference" / "three_class_INTEGRATION_CHECK.json")
    assert_eq(counts, expected["final_label_counts"], "baseline final counts")
    review_items = sum(a["review_required"] for a in audits)
    assert_eq(review_items, expected["review_items"], "baseline review_items")
    priorities = {}
    for a in audits:
        if a["review_required"]:
            k = str(a["review_priority"])
            priorities[k] = priorities.get(k, 0) + 1
    assert_eq(priorities, expected["review_priority_counts"], "baseline review priorities")
    mandatory = sum(a["review_required"] and a["review_priority"] in {0, 1} for a in audits)
    assert_eq(mandatory, expected["unresolved_mandatory_reviews"], "baseline mandatory reviews")
    return len(baseline)


def test_stage13_exact_reuse_roundtrip():
    reference_path = ROOT / "reference" / "stage13_labeled_REFERENCE.json"
    reference = load(reference_path)
    raw = [{f: r[f] for f in mod.FIELDS} for r in reference]
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        raw_path = td / "raw.json"
        mod.dump_json(raw_path, raw)
        work = td / "work"
        rc = mod.cmd_prepare_stage13(Namespace(
            input_json=raw_path, reference=reference_path, outdir=work, batch_size=500
        ))
        assert_eq(rc, 0, "prepare rc")
        prep = load(work / "stage13_prepare_report.json")
        assert_eq(prep["exact_reuse_records"], len(reference), "exact reuse count")
        assert_eq(prep["pending_records"], 0, "pending count")
        assert_eq(load(work / "stage13_workspace_state.json")["workspace_schema_version"], 2, "workspace schema")
        output = td / "stage13.json"
        rc = mod.cmd_finalize_stage13(Namespace(
            input_json=raw_path,
            workspace=work,
            adjudications=work / "stage13_adjudications.csv",
            reference=None,
            output=output,
            audit=None,
        ))
        assert_eq(rc, 0, "finalize rc")
        assert_eq(load(output), reference, "Stage13 exact reuse roundtrip")
        assert_eq(mod.sha256_file(output), mod.sha256_file(reference_path), "Stage13 output sha")
    return len(reference)


def _synthetic_stage13_fixture(td: Path):
    ref = [
        {"username":"u","handle":"h1","comment":"old negative","postedAt":"1-1","postedDate":"2026-01-01","label":"nuisance"},
        {"username":"v","handle":"h2","comment":"hello","postedAt":"1-1","postedDate":"2026-01-01","label":"normal"},
    ]
    raw = [
        {"username":"u","handle":"h1","comment":"old negative","postedAt":"1-1","postedDate":"2026-01-01"},
        {"username":"u","handle":"h1","comment":"new ambiguous","postedAt":"1-2","postedDate":"2026-01-02"},
    ]
    rp, ip = td / "ref.json", td / "input.json"
    mod.dump_json(rp, ref)
    mod.dump_json(ip, raw)
    return rp, ip, ref, raw


def test_stage13_pending_and_context():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        rp, ip, _, raw = _synthetic_stage13_fixture(td)
        work = td / "work"
        rc = mod.cmd_prepare_stage13(Namespace(input_json=ip, reference=rp, outdir=work, batch_size=500))
        assert_eq(rc, 0, "synthetic prepare rc")
        prep = load(work / "stage13_prepare_report.json")
        assert_eq(prep["exact_reuse_records"], 1, "synthetic reuse")
        assert_eq(prep["pending_records"], 1, "synthetic pending")
        ctx = load(work / "stage13_handle_context.json")["h1"]
        assert_eq(len(ctx["current_input"]), 2, "current handle context")
        assert_eq(len(ctx["prior_reference"]), 1, "prior handle context")
        row_sha = mod.raw_record_sha256(raw[1])
        with (work / "stage13_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
            w.writerow([2, row_sha, "normal", "reviewed"])
        out = td / "stage13.json"
        rc = mod.cmd_finalize_stage13(Namespace(
            input_json=ip,
            workspace=work,
            adjudications=work / "stage13_adjudications.csv",
            reference=rp,
            output=out,
            audit=None,
        ))
        assert_eq(rc, 0, "synthetic finalize rc")
        got = load(out)
        assert_eq([x["label"] for x in got], ["nuisance", "normal"], "synthetic labels")
    return 1


def _multi_batch_stage13_fixture(td: Path):
    ref = [
        {"username":"u","handle":"h1","comment":"known","postedAt":"1-1","postedDate":"2026-01-01","label":"normal"},
    ]
    raw = [
        {"username":"u","handle":"h1","comment":"known","postedAt":"1-1","postedDate":"2026-01-01"},
        {"username":"v","handle":"h2","comment":"pending two","postedAt":"1-2","postedDate":"2026-01-02"},
        {"username":"w","handle":"h3","comment":"pending three","postedAt":"1-3","postedDate":"2026-01-03"},
    ]
    rp, ip = td / "ref.json", td / "input.json"
    mod.dump_json(rp, ref)
    mod.dump_json(ip, raw)
    return rp, ip, raw


def _write_batch_response(directory: Path, name: str, batch: list[dict], *, label="normal", note="reviewed"):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f"{name}_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
        for item in batch:
            w.writerow([item["source_index_1_based"], item["source_record_sha256"], label, note])


def test_stage13_batch_handoff_and_directory_finalize():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        rp, ip, raw = _multi_batch_stage13_fixture(td)
        work = td / "work"
        mod.cmd_prepare_stage13(Namespace(input_json=ip, reference=rp, outdir=work, batch_size=1))
        batches_dir = work / "pending_batches"
        assert_eq(
            sorted(p.name for p in batches_dir.iterdir()),
            [
                "batch_001.json", "batch_001_adjudications.csv", "batch_001_context.json",
                "batch_002.json", "batch_002_adjudications.csv", "batch_002_context.json",
            ],
            "per-batch artifact set",
        )
        for number, handle in [("001", "h2"), ("002", "h3")]:
            batch = load(batches_dir / f"batch_{number}.json")
            context = load(batches_dir / f"batch_{number}_context.json")
            assert_eq(set(context), {handle}, f"batch {number} context handles")
            assert_eq(context, {handle: load(work / "stage13_handle_context.json")[handle]}, f"batch {number} context subset")
            with (batches_dir / f"batch_{number}_adjudications.csv").open("r", encoding="utf-8-sig", newline="") as f:
                rows = list(csv.DictReader(f))
            assert_eq(rows[0]["source_index_1_based"], str(batch[0]["source_index_1_based"]), f"batch {number} source index")
            assert_eq(rows[0]["source_record_sha256"], batch[0]["source_record_sha256"], f"batch {number} source sha")
            assert_eq(rows[0]["label"], "", f"batch {number} label template")
            assert_eq(rows[0]["note"], "", f"batch {number} note template")

        for name in ["batch_999.json", "batch_999_context.json", "batch_999_adjudications.csv"]:
            (batches_dir / name).write_text("stale", encoding="utf-8")
        mod.cmd_prepare_stage13(Namespace(input_json=ip, reference=rp, outdir=work, batch_size=1))
        for name in ["batch_999.json", "batch_999_context.json", "batch_999_adjudications.csv"]:
            assert_eq((batches_dir / name).exists(), False, f"stale artifact removed: {name}")

        responses = td / "chatgpt-stage13"
        _write_batch_response(responses, "batch_001", load(batches_dir / "batch_001.json"), label="normal", note="reviewed two")
        _write_batch_response(responses, "batch_002", load(batches_dir / "batch_002.json"), label="nuisance", note="reviewed three")
        output = td / "stage13.json"
        rc = mod.cmd_finalize_stage13(Namespace(
            input_json=ip, workspace=work, adjudications=None, adjudications_dir=responses,
            reference=rp, output=output, audit=None,
        ))
        assert_eq(rc, 0, "directory finalize rc")
        assert_eq([item["label"] for item in load(output)], ["normal", "normal", "nuisance"], "directory final labels")
    return 2


def test_stage13_directory_rejects_invalid_response_sets():
    cases = ["missing", "unknown", "duplicate", "non_pending", "invalid_label", "sha_mismatch", "coverage", "blank_note"]
    for case in cases:
        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            rp, ip, _ = _multi_batch_stage13_fixture(td)
            work = td / "work"
            mod.cmd_prepare_stage13(Namespace(input_json=ip, reference=rp, outdir=work, batch_size=1))
            batches_dir = work / "pending_batches"
            responses = td / "responses"
            responses.mkdir()
            batch_one = load(batches_dir / "batch_001.json")
            batch_two = load(batches_dir / "batch_002.json")
            if case != "missing":
                _write_batch_response(responses, "batch_001", batch_one)
            if case != "missing":
                _write_batch_response(responses, "batch_002", batch_two)

            if case == "unknown":
                (responses / "batch_999_adjudications.csv").write_text("source_index_1_based,source_record_sha256,label,note\n", encoding="utf-8")
            elif case == "duplicate":
                with (responses / "batch_001_adjudications.csv").open("a", encoding="utf-8", newline="") as f:
                    f.write(f"{batch_one[0]['source_index_1_based']},{batch_one[0]['source_record_sha256']},normal,duplicate\n")
            elif case == "non_pending":
                with (responses / "batch_001_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
                    w.writerow([999, "0" * 64, "normal", "extra"])
            elif case == "invalid_label":
                with (responses / "batch_001_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
                    w.writerow([batch_one[0]["source_index_1_based"], batch_one[0]["source_record_sha256"], "unknown", "invalid"])
            elif case == "sha_mismatch":
                with (responses / "batch_001_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
                    w.writerow([batch_one[0]["source_index_1_based"], "0" * 64, "normal", "stale"])
            elif case == "coverage":
                with (responses / "batch_001_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
                    csv.writer(f).writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
            elif case == "blank_note":
                with (responses / "batch_001_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
                    w.writerow([batch_one[0]["source_index_1_based"], batch_one[0]["source_record_sha256"], "normal", "  "])

            assert_raises(ValueError, lambda: mod.cmd_finalize_stage13(Namespace(
                input_json=ip, workspace=work, adjudications=None, adjudications_dir=responses,
                reference=rp, output=td / "out.json", audit=None,
            )), f"directory rejection: {case}")
    return len(cases)


def test_stage13_rejects_stale_input():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        rp, ip, _, raw = _synthetic_stage13_fixture(td)
        work = td / "work"
        mod.cmd_prepare_stage13(Namespace(input_json=ip, reference=rp, outdir=work, batch_size=500))
        stale = [dict(x) for x in raw]
        stale[0]["comment"] = "changed after prepare"
        stale_path = td / "stale.json"
        mod.dump_json(stale_path, stale)
        assert_raises(ValueError, lambda: mod.cmd_finalize_stage13(Namespace(
            input_json=stale_path,
            workspace=work,
            adjudications=work / "stage13_adjudications.csv",
            reference=rp,
            output=td / "out.json",
            audit=None,
        )), "stale input rejection")
    return 1


def test_stage13_rejects_stale_adjudication_fingerprint():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        rp, ip, _, _ = _synthetic_stage13_fixture(td)
        work = td / "work"
        mod.cmd_prepare_stage13(Namespace(input_json=ip, reference=rp, outdir=work, batch_size=500))
        with (work / "stage13_adjudications.csv").open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["source_index_1_based", "source_record_sha256", "label", "note"])
            w.writerow([2, "0" * 64, "normal", "reviewed"])
        assert_raises(ValueError, lambda: mod.cmd_finalize_stage13(Namespace(
            input_json=ip,
            workspace=work,
            adjudications=work / "stage13_adjudications.csv",
            reference=rp,
            output=td / "out.json",
            audit=None,
        )), "stale adjudication fingerprint rejection")
    return 1


def test_three_class_fail_closed_publication():
    baseline_path = ROOT / "reference" / "stage13_labeled_REFERENCE.json"
    expected = load(ROOT / "reference" / "three_class_INTEGRATION_CHECK.json")
    with tempfile.TemporaryDirectory() as td_raw:
        outdir = Path(td_raw) / "three"
        rc = mod.cmd_three_class(Namespace(
            stage13_json=baseline_path,
            outdir=outdir,
            overrides=None,
            no_golden=True,
            strict_final=False,
        ))
        assert_eq(rc, 0, "non-strict candidate rc")
        assert_eq((outdir / "three_class_candidate.json").exists(), True, "candidate exists")
        assert_eq((outdir / "three_class_labeled.json").exists(), False, "final withheld")
        summary = load(outdir / "summary.json")
        assert_eq(summary["unresolved_mandatory_reviews"], expected["unresolved_mandatory_reviews"], "mandatory baseline")
        assert_eq(summary["final_published"], False, "final publication status")
        rc = mod.cmd_three_class(Namespace(
            stage13_json=baseline_path,
            outdir=outdir,
            overrides=None,
            no_golden=True,
            strict_final=True,
        ))
        assert_eq(rc, 2, "strict final rejection rc")
        assert_eq((outdir / "three_class_labeled.json").exists(), False, "strict final withheld")
    return expected["unresolved_mandatory_reviews"]


def test_three_class_override_hygiene_and_resolution():
    record = {
        "username": "u", "handle": "h", "comment": "そんなこと言う人はやめてほしい",
        "postedAt": "1-1", "postedDate": "2026-01-01", "label": "normal",
    }
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        stage = td / "stage.json"
        mod.dump_json(stage, [record])
        first = td / "first"
        mod.cmd_three_class(Namespace(stage13_json=stage, outdir=first, overrides=None, strict_final=False))
        audit = load(first / "audit_three_class.json")[0]
        assert_eq(audit["review_priority"], 1, "synthetic P1")
        key = audit["record_key"]

        blank = td / "blank.csv"
        with blank.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f); w.writerow(["record_key", "label", "note"]); w.writerow([key, audit["label_provisional"], ""])
        assert_raises(ValueError, lambda: mod.cmd_three_class(Namespace(
            stage13_json=stage, outdir=td / "blank_out", overrides=blank, strict_final=True
        )), "P1 blank note rejection")

        unknown = td / "unknown.csv"
        with unknown.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f); w.writerow(["record_key", "label", "note"]); w.writerow(["deadbeefdeadbeefdeadbeef", "normal", "reviewed"])
        assert_raises(ValueError, lambda: mod.cmd_three_class(Namespace(
            stage13_json=stage, outdir=td / "unknown_out", overrides=unknown, strict_final=True
        )), "unknown override rejection")

        duplicate = td / "duplicate.csv"
        with duplicate.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f); w.writerow(["record_key", "label", "note"]); w.writerow([key, "normal", "a"]); w.writerow([key, "normal", "b"])
        assert_raises(ValueError, lambda: mod.load_three_overrides(duplicate), "duplicate override rejection")

        good = td / "good.csv"
        with good.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f); w.writerow(["record_key", "label", "note"]); w.writerow([key, audit["label_provisional"], "P1 reviewed; provisional retained"])
        final_dir = td / "final"
        rc = mod.cmd_three_class(Namespace(stage13_json=stage, outdir=final_dir, overrides=good, strict_final=True))
        assert_eq(rc, 0, "resolved P1 strict rc")
        assert_eq((final_dir / "three_class_labeled.json").exists(), True, "resolved final published")
        assert_eq(load(final_dir / "summary.json")["unresolved_mandatory_reviews"], 0, "resolved mandatory count")
    return 4


def test_three_class_removes_stale_final():
    safe = [{
        "username":"u","handle":"h","comment":"hello","postedAt":"1","postedDate":"2026-01-01","label":"normal"
    }]
    risky = [{
        "username":"u","handle":"h","comment":"そんなこと言う人はやめてほしい","postedAt":"1","postedDate":"2026-01-01","label":"normal"
    }]
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        safe_path, risky_path = td / "safe.json", td / "risky.json"
        mod.dump_json(safe_path, safe); mod.dump_json(risky_path, risky)
        outdir = td / "out"
        rc = mod.cmd_three_class(Namespace(stage13_json=safe_path, outdir=outdir, overrides=None, strict_final=False))
        assert_eq(rc, 0, "safe run rc")
        assert_eq((outdir / "three_class_labeled.json").exists(), True, "safe final exists")
        rc = mod.cmd_three_class(Namespace(stage13_json=risky_path, outdir=outdir, overrides=None, strict_final=False))
        assert_eq(rc, 0, "risky run rc")
        assert_eq((outdir / "three_class_labeled.json").exists(), False, "stale final removed")
    return 1



def test_three_class_golden_baseline_resolution():
    baseline_path = ROOT / "reference" / "stage13_labeled_REFERENCE.json"
    with tempfile.TemporaryDirectory() as td_raw:
        outdir = Path(td_raw) / "golden"
        rc = mod.cmd_three_class(Namespace(
            stage13_json=baseline_path,
            outdir=outdir,
            overrides=None,
            strict_final=True,
        ))
        assert_eq(rc, 0, "golden strict rc")
        summary = load(outdir / "summary.json")
        assert_eq(summary["unresolved_mandatory_reviews"], 0, "golden unresolved")
        assert_eq(summary["final_published"], True, "golden final publication")
        assert_eq(summary["golden_adjudications_applied"], 124, "golden applied rows")
        assert_eq(summary["golden_registry_entries"], 123, "golden unique entries")
        assert_eq(summary["unresolved_optional_p2_reviews"], 1, "optional P2 count")
        with (outdir / "manual_overrides.csv").open("r", encoding="utf-8-sig", newline="") as f:
            assert_eq(len(list(csv.DictReader(f))), 0, "mandatory override template rows")
        with (outdir / "optional_p2_overrides.csv").open("r", encoding="utf-8-sig", newline="") as f:
            assert_eq(len(list(csv.DictReader(f))), 1, "optional P2 override rows")
        assert_eq(summary["candidate_label_counts"], {
            "reactive": 1225, "normal": 19659, "direct_nuisance": 549
        }, "v1.4 adjudicated final counts")
        assert_eq(summary["p2_adjudications_applied"], 345, "P2 adjudications applied")
        assert_eq(summary["p2_registry_entries"], 345, "P2 registry entries")
        assert_eq(load(outdir / "three_class_labeled.json"), load(outdir / "three_class_candidate.json"), "golden final=candidate")
    return 124


def test_three_class_golden_exact_key_scope():
    registry, _ = mod.load_golden_registry(ROOT / "reference" / "three_class_golden_adjudications.json")
    first_key, decision = next(iter(registry.items()))
    baseline = load(ROOT / "reference" / "stage13_labeled_REFERENCE.json")
    exact = next(r for r in baseline if mod.record_key(r) == first_key)
    mutated = dict(exact)
    mutated["postedAt"] = str(mutated["postedAt"]) + "-changed"
    reactive = load(ROOT / "config" / "reactive_terms.json")
    cues = load(ROOT / "config" / "review_cues.json")
    _, exact_audit = mod.classify_three(exact, reactive, cues, registry.get(mod.record_key(exact)), None)
    _, mutated_audit = mod.classify_three(mutated, reactive, cues, registry.get(mod.record_key(mutated)), None)
    assert_eq(exact_audit["golden_applied"], True, "exact golden applies")
    assert_eq(exact_audit["label_final"], decision["label"], "exact golden label")
    assert_eq(mutated_audit["golden_applied"], False, "mutated record not golden")
    return 2


def test_three_class_rejects_manual_override_of_golden():
    registry, _ = mod.load_golden_registry(ROOT / "reference" / "three_class_golden_adjudications.json")
    key, decision = next(iter(registry.items()))
    baseline = load(ROOT / "reference" / "stage13_labeled_REFERENCE.json")
    record = next(r for r in baseline if mod.record_key(r) == key)
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        stage = td / "stage.json"
        mod.dump_json(stage, [record])
        ov = td / "override.csv"
        with ov.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["record_key", "label", "note"])
            w.writerow([key, decision["label"], "attempt to override golden"])
        assert_raises(ValueError, lambda: mod.cmd_three_class(Namespace(
            stage13_json=stage, outdir=td / "out", overrides=ov, strict_final=True
        )), "manual override of golden rejection")
    return 1


def test_three_class_golden_registry_hygiene():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        bad = td / "bad.json"
        obj = {
            "schema_version": 1,
            "registry_version": "x",
            "decisions": [
                {"record_key": "a" * 24, "stage13_label": "normal", "label": "normal", "reason_code": "normal_context", "rationale": "ok"},
                {"record_key": "a" * 24, "stage13_label": "normal", "label": "normal", "reason_code": "normal_context", "rationale": "duplicate"},
            ],
        }
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_golden_registry(bad), "duplicate golden key rejection")
        obj["decisions"] = [{"record_key": "b" * 24, "stage13_label": "normal", "label": "normal", "reason_code": "normal_context", "rationale": ""}]
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_golden_registry(bad), "blank golden rationale rejection")
        obj["decisions"][0]["rationale"] = "ok"
        obj["decision_count"] = 2
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_golden_registry(bad), "golden decision_count mismatch rejection")
    return 3


def test_three_class_term_only_reproduction():
    baseline_path = ROOT / "reference" / "stage13_labeled_REFERENCE.json"
    with tempfile.TemporaryDirectory() as td_raw:
        outdir = Path(td_raw) / "term"
        rc = mod.cmd_three_class(Namespace(
            stage13_json=baseline_path, outdir=outdir, overrides=None,
            strict_final=False, term_only=True,
        ))
        assert_eq(rc, 0, "term-only rc")
        summary = load(outdir / "summary.json")
        assert_eq(summary["candidate_label_counts"], {
            "reactive": 1096, "normal": 19817, "direct_nuisance": 520
        }, "term-only counts")
        assert_eq(summary["unresolved_mandatory_reviews"], 124, "term-only mandatory")
        assert_eq(summary["unresolved_optional_p2_reviews"], 346, "term-only P2")
        assert_eq(summary["golden_adjudications_applied"], 0, "term-only golden")
        assert_eq(summary["p2_adjudications_applied"], 0, "term-only P2 adjudication")
    return 1


def test_three_class_p2_exact_key_scope():
    registry, _ = mod.load_p2_registry(ROOT / "reference" / "three_class_p2_adjudications.json")
    key, decision = next(iter(registry.items()))
    baseline = load(ROOT / "reference" / "stage13_labeled_REFERENCE.json")
    exact = next(r for r in baseline if mod.record_key(r) == key)
    mutated = dict(exact)
    mutated["postedAt"] = str(mutated["postedAt"]) + "-changed"
    reactive = load(ROOT / "config" / "reactive_terms.json")
    cues = load(ROOT / "config" / "review_cues.json")
    _, exact_audit = mod.classify_three(exact, reactive, cues, None, None, registry.get(mod.record_key(exact)))
    _, mutated_audit = mod.classify_three(mutated, reactive, cues, None, None, registry.get(mod.record_key(mutated)))
    assert_eq(exact_audit["p2_adjudication_applied"], True, "exact P2 applies")
    assert_eq(exact_audit["label_final"], decision["label"], "exact P2 label")
    assert_eq(mutated_audit["p2_adjudication_applied"], False, "mutated record not P2 adjudicated")
    return 2



def test_three_class_v140_boundary_decisions():
    registry, _ = mod.load_p2_registry(ROOT / "reference" / "three_class_p2_adjudications.json")
    expected = {
        "e62b2a8b7cd2b95965916c16": "normal",
        "555cab324953ecddf8bb39a5": "reactive",
        "e4261c4ce8349c605a939769": "direct_nuisance",
        "b87754f57c8235d871b605f6": "direct_nuisance",
        "5f634c87c0c85a53d43a20a6": "normal",
        "32518a9bedd4da595321df2a": "normal",
        "c6e413b50e21af51740cbd06": "direct_nuisance",
    }
    for key, label in expected.items():
        assert_eq(registry[key]["label"], label, f"v1.4 boundary label {key}")
    unresolved_key = "f1fb38be87e3dc7a27a598ae"
    assert_eq(unresolved_key in registry, False, "ambiguous physical/cringe pain case stays unresolved")
    remaining = load(ROOT / "reference" / "three_class_P2_REMAINING_REVIEW.json")
    assert_eq(remaining["unresolved_p2_count"], 1, "one P2 remains unresolved")
    assert_eq(remaining["items"][0]["record_key"], unresolved_key, "remaining P2 identity")
    return 8

def test_three_class_rejects_manual_override_of_p2():
    registry, _ = mod.load_p2_registry(ROOT / "reference" / "three_class_p2_adjudications.json")
    key, decision = next(iter(registry.items()))
    baseline = load(ROOT / "reference" / "stage13_labeled_REFERENCE.json")
    record = next(r for r in baseline if mod.record_key(r) == key)
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        stage = td / "stage.json"
        mod.dump_json(stage, [record])
        ov = td / "override.csv"
        with ov.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["record_key", "label", "note"])
            w.writerow([key, decision["label"], "attempt to override P2 registry"])
        assert_raises(ValueError, lambda: mod.cmd_three_class(Namespace(
            stage13_json=stage, outdir=td / "out", overrides=ov, strict_final=True
        )), "manual override of P2 rejection")
    return 1


def test_three_class_p2_registry_hygiene():
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        bad = td / "bad_p2.json"
        obj = {
            "schema_version": 1,
            "registry_version": "x",
            "decisions": [
                {"record_key": "a" * 24, "stage13_label": "normal", "label": "normal", "reason_code": "confirm_normal", "rationale": "ok"},
                {"record_key": "a" * 24, "stage13_label": "normal", "label": "normal", "reason_code": "confirm_normal", "rationale": "duplicate"},
            ],
        }
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_p2_registry(bad), "duplicate P2 key rejection")
        obj["decisions"] = [{"record_key": "b" * 24, "stage13_label": "normal", "label": "normal", "reason_code": "confirm_normal", "rationale": ""}]
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_p2_registry(bad), "blank P2 rationale rejection")
        obj["decisions"][0]["rationale"] = "ok"
        obj["decision_count"] = 2
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_p2_registry(bad), "P2 decision_count mismatch rejection")
        obj["decision_count"] = 1
        obj["decisions"][0]["stage13_label"] = "nuisance"
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_p2_registry(bad), "P2 stage13 normal-only rejection")
        obj["decisions"][0]["stage13_label"] = "normal"
        obj["decisions"][0]["label"] = "reactive"
        obj["decisions"][0]["reason_code"] = "confirm_normal"
        mod.dump_json(bad, obj)
        assert_raises(ValueError, lambda: mod.load_p2_registry(bad), "P2 label/reason mismatch rejection")
    return 5


def test_three_class_p2_reason_drift_fail_closed():
    reactive = load(ROOT / "config" / "reactive_terms.json")
    cues = load(ROOT / "config" / "review_cues.json")
    # Synthetic P1+P2 record must not accept a stale P2-only decision.
    record = {
        "username":"u", "handle":"h", "comment":"そんなこと言う人はきつい",
        "postedAt":"1", "postedDate":"2026-01-01", "label":"normal"
    }
    fake = {
        "record_key": mod.record_key(record), "stage13_label":"normal", "label":"normal",
        "reason_code":"confirm_normal", "rationale":"stale P2-only decision"
    }
    assert_raises(ValueError, lambda: mod.classify_three(record, reactive, cues, None, None, fake), "P2 reason drift rejection")
    return 1


def test_three_class_registry_overlap_rejected():
    baseline = load(ROOT / "reference" / "stage13_labeled_REFERENCE.json")
    p2_registry, p2_meta = mod.load_p2_registry(ROOT / "reference" / "three_class_p2_adjudications.json")
    key, p2_decision = next(iter(p2_registry.items()))
    record = next(r for r in baseline if mod.record_key(r) == key)
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        stage = td / "stage.json"; mod.dump_json(stage, [record])
        fake_golden = td / "golden.json"
        mod.dump_json(fake_golden, {
            "schema_version":1, "registry_version":"x", "decision_count":1,
            "decisions":[{
                "record_key":key, "stage13_label":"normal", "label":p2_decision["label"],
                "reason_code":"normal_context", "rationale":"overlap test"
            }]
        })
        assert_raises(ValueError, lambda: mod.cmd_three_class(Namespace(
            stage13_json=stage, outdir=td / "out", overrides=None, strict_final=False,
            golden_registry=fake_golden
        )), "registry overlap rejection")
    return 1

def main():
    results = []
    for name, fn in [
        ("three_class_regressions", test_three_class_regressions),
        ("raw_contract_is_strict_and_duplicate_preserving", test_raw_contract_is_strict_and_duplicate_preserving),
        ("operational_registry_promotion_contract", test_operational_registry_promotion_contract),
        ("baseline_three_class", test_baseline_three_class),
        ("stage13_exact_reuse_roundtrip", test_stage13_exact_reuse_roundtrip),
        ("stage13_pending_and_context", test_stage13_pending_and_context),
        ("stage13_batch_handoff_and_directory_finalize", test_stage13_batch_handoff_and_directory_finalize),
        ("stage13_directory_rejects_invalid_response_sets", test_stage13_directory_rejects_invalid_response_sets),
        ("stage13_rejects_stale_input", test_stage13_rejects_stale_input),
        ("stage13_rejects_stale_adjudication_fingerprint", test_stage13_rejects_stale_adjudication_fingerprint),
        ("three_class_fail_closed_publication", test_three_class_fail_closed_publication),
        ("three_class_override_hygiene_and_resolution", test_three_class_override_hygiene_and_resolution),
        ("three_class_removes_stale_final", test_three_class_removes_stale_final),
        ("three_class_golden_baseline_resolution", test_three_class_golden_baseline_resolution),
        ("three_class_golden_exact_key_scope", test_three_class_golden_exact_key_scope),
        ("three_class_rejects_manual_override_of_golden", test_three_class_rejects_manual_override_of_golden),
        ("three_class_golden_registry_hygiene", test_three_class_golden_registry_hygiene),
        ("three_class_term_only_reproduction", test_three_class_term_only_reproduction),
        ("three_class_p2_exact_key_scope", test_three_class_p2_exact_key_scope),
        ("three_class_v140_boundary_decisions", test_three_class_v140_boundary_decisions),
        ("three_class_rejects_manual_override_of_p2", test_three_class_rejects_manual_override_of_p2),
        ("three_class_p2_registry_hygiene", test_three_class_p2_registry_hygiene),
        ("three_class_p2_reason_drift_fail_closed", test_three_class_p2_reason_drift_fail_closed),
        ("three_class_registry_overlap_rejected", test_three_class_registry_overlap_rejected),
    ]:
        n = fn()
        results.append((name, n))
        print(f"OK: {name} ({n})")
    print(f"ALL OK: {len(results)} test groups")


if __name__ == "__main__":
    main()
