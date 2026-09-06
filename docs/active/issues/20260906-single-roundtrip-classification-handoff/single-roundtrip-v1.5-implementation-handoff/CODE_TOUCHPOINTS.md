# Code touchpoints

Paths below are relative to the supplied discussion set.

## v1.4 pipeline source

`docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py`

Relevant symbols in supplied snapshot:

- line ~55: `raw_record_sha256(record)`
- line ~59: `record_key(record)`
- line ~88: `validate_stage13_records(data)`
- line ~139: `cmd_prepare_stage13(args)`
- line ~397: `cmd_finalize_stage13(args)`
- line ~547: `load_golden_registry(path)`
- line ~588: `load_p2_registry(path)`
- line ~662: `EXPECTED_LABEL_BY_GOLDEN_REASON`
- line ~678: `OPERATIONAL_RATIONALE`
- line ~756: `promote_three_class_decisions(...)`
- line ~849: `classify_three(...)`
- line ~1017: `write_three_override_template(...)`
- line ~1035: `cmd_three_class(args)`
- line ~1311: `build_parser()`

Implementation guidance:

- Do not fork/rewrite `classify_three` semantics. Reuse it for hypothetical pending branches.
- Do not invent a new `record_key`; use existing exact definition.
- Reuse reason->label/rationale constants.
- Refactor `cmd_three_class` internals only as needed so single-roundtrip can call a non-printing internal execution path; preserve legacy CLI output/behavior.
- New single-roundtrip promotion should group duplicate audit rows by exact `record_key` and validate equal semantic audit state before producing one logical decision. Do not route through a fake CSV if that loses exact provenance or hits current duplicate audit limitation.

## Stage13 prompt/spec

- `prompts/STAGE13_REVIEW_PROMPT.md`
- `specs/01_STAGE13_LABELING_SPEC.md`
- `specs/02_STAGE13_WORK_RULES.md`
- `policy/01_STAGE13_REPRODUCIBILITY.md`
- `policy/02_STAGE13_DECISION_BOUNDARIES.md`

Use as semantic source. New `REVIEW_INSTRUCTIONS.md` should orchestrate, not duplicate/rewrite these rules.

## Three-Class prompt/spec

- `prompts/THREE_CLASS_REVIEW_PROMPT.md`
- `specs/03_THREE_CLASS_LABELING_SPEC.md`
- `policy/04_THREE_CLASS_CHANGE_CONTROL.md`
- `config/three_class_policy.json`
- `config/reactive_terms.json`
- `config/review_cues.json`

## Downstream gate

`package/src/processing/keyword-candidates/handoff-workflow.js`

Supplied snapshot:

- line 16: `const LABELING_PIPELINE_VERSION = "1.4.0";`
- line ~91: `verifyLabelingEvidence(...)`
- lines ~100-101: summary/validation both compared to one fixed version

Change minimally to explicit supported set `{1.4.0, 1.5.0}` plus equality between summary and validation.

Relevant downstream tests:

- `package/tests/handoff.test.js`
- `package/tests/full-update.test.js`
- `package/tests/account-block-candidate-workflow.test.js`
- `package/tests/release.test.js`

## v1.4 pipeline tests

`tests/run_all_tests.py` and `tests/three_class_regression_cases.json`.

Important: supplied snapshot has a root-manifest mismatch for `tests/run_all_tests.py`; see `BASELINE_INTEGRITY_FINDINGS.md` before using manifest as immutable baseline.
