# three-class DB label application — implementation handoff

Status: implementation-ready MVP specification.

This handoff closes the design for the issue in `context/ISSUE_BODY.md`. The implementation goal is to safely materialize a validated `three-class-workset-v1` response into Comment DB observation labels without modifying raw observations and without writing outside the snapshots selected when the workset was generated.

## Read order

1. `01_FINAL_DECISIONS.md`
2. `02_IMPLEMENTATION_SPEC.md`
3. `03_DB_MIGRATION_006.sql`
4. `04_CODE_CHANGE_MAP.md`
5. `05_WORK_TASK_SEQUENCE.md`
6. `06_ACCEPTANCE_TESTS.md`
7. `07_CLI_AND_ERROR_CONTRACT.md`
8. `08_IMPLEMENTER_CHECKLIST.md`
9. `09_DECISION_LOG.md`

## MVP in one paragraph

When a workset is generated, bind its `workset_id` to the selected `raw_snapshots.snapshot_id` values in the same Comment DB. When applying a response, first reuse the existing workset/response validator, then open the DB, start `BEGIN IMMEDIATE`, load the registered snapshots, reconstruct the workset items using the same exact-string first-occurrence dedupe helper as generation, and require those reconstructed items to equal the ZIP `ITEMS.json`. Convert item decisions to exact-comment decisions. Read existing labels across the DB to reject any requested comment whose current label conflicts anywhere. Then write only to observations belonging to the registered snapshots: insert missing labels, treat identical labels as unchanged, and reject any differing existing target label. Raw observations are never updated. Corrections/history are out of scope.

## Non-goals

Do not add correction, overwrite, force, dry-run, application history, reviewer metadata, timestamps, archive/response hashes, HISTORY mutation, legacy-workset rescue/import, workset rebinding/deletion, comment master tables, DB triggers for semantic consistency, or automatic propagation to non-selected snapshots.
