# Acceptance tests

These are required behavior tests, not optional examples.

## Migration/schema

1. A fully migrated DB reaches `PRAGMA user_version = 6`.
2. Migration 006 creates exactly the new provenance/current-label structures required by the spec.
3. Migration 006 performs no label/workset backfill or inference.
4. Existing data remains unchanged.
5. Empty/populated v5 DBs can migrate to v6.
6. Current analysis manifest reports `database_schema_version: 6` while projection version remains `1.0.0` and manifest schema version remains `3`.

## Generation/provenance

7. Successful workset generation registers its `workset_id`.
8. Every generation-time selected snapshot is registered by `snapshot_id`.
9. The workset parent prevents reusing the same `workset_id` for another provenance set.
10. Existing selector requirements remain: zero selected snapshot references is rejected.
11. Existing duplicate snapshot selection is rejected; the registry must not silently dedupe it.
12. A selected snapshot set with zero comment observations may produce an empty valid ITEMS list.
13. Generator does not hold a writer transaction during projection/packaging.
14. Provenance registration is one short atomic transaction after package + archive validation + required staging cleanup.
15. A post-package validation failure leaves no registered workset and deletes the final ZIP owned by this invocation.
16. A provenance insert/commit failure leaves no partial registry and deletes the final ZIP owned by this invocation.
17. A staging cleanup failure before provenance registration leaves no registry and removes the owned ZIP.
18. Packager failure after it has created the final output removes that output if the packager itself created it.
19. A losing concurrent generator must not delete a ZIP owned by another process.

## Validation/source binding

20. Malformed workset/response is rejected before DB open.
21. Applying a valid old/unregistered v1 workset fails with `WORKSET_NOT_REGISTERED`.
22. A registered workset whose source snapshots reconstruct different ITEMS fails with `WORKSET_SOURCE_MISMATCH`.
23. Reconstructed ITEMS comparison covers IDs, order, count, and exact comment strings.
24. Application uses validated in-memory workset/response values and does not re-read them after validation.

## Scope and duplicate application

25. A unique comment in a selected snapshot receives the requested label.
26. The same exact comment repeated multiple times in one selected snapshot labels every matching selected observation.
27. The same exact comment across multiple selected snapshots labels every matching selected observation.
28. The same exact comment in a non-selected snapshot is not inserted/updated merely because it matches.
29. Raw `snapshot_comment_observations` rows remain unchanged.
30. Target observations are derived from `three_class_workset_snapshots`, not a global comment-text search.

## Comment-level global consistency

31. If a requested comment has no existing label anywhere, application may proceed.
32. If all existing labels for a requested exact comment anywhere in DB equal the requested label, application may proceed.
33. If any existing label for a requested exact comment anywhere in DB differs, the whole apply fails with `LABEL_CONFLICT`, including when that conflicting row is in a non-selected snapshot.
34. A non-selected same-valued existing label is read-only context and is not counted in `unchanged`.
35. Application does not mutate non-selected snapshots while performing global conflict checks.
36. A pre-existing internally inconsistent exact comment (multiple labels) causes any new request for that comment to fail unless all existing values equal the requested value—which cannot hold when conflicting values are present.

## Target-current-label behavior

37. Missing target label => inserted.
38. Same target label => unchanged/no-op.
39. Different target label => `LABEL_CONFLICT` and whole transaction rollback.
40. No UPDATE/REPLACE/INSERT-OR-IGNORE conflict masking is used.
41. Conflict is fully preflighted before pending inserts begin.

## Atomicity/invariants

42. Source reconstructed observation count equals registry-scoped target observation count; mismatch => `DATABASE_INTEGRITY_ERROR`.
43. Every target comment is present in the decision map; failure => `DATABASE_INTEGRITY_ERROR`.
44. Before commit, `inserted + unchanged === observations`.
45. Injected failure during label insertion leaves zero partial three-class changes from that apply.
46. `BEGIN IMMEDIATE` starts before DB-dependent source/conflict preflight.
47. Two concurrent conflicting apply attempts cannot both commit incompatible labels.
48. No custom retry/lock-table/busy-timeout behavior is required.

## Idempotency

49. First apply can return `inserted=N, unchanged=0`.
50. Exact replay returns success with `inserted=0, unchanged=N`.
51. A different workset applying the same label to an already-labeled target also succeeds/no-ops.
52. Correction to a different label is not supported and fails.

## Empty target

53. A valid registered workset with zero selected observations applies successfully with `observations=0 inserted=0 unchanged=0`.

## CLI

54. Command syntax is exactly the MVP syntax documented in `07_CLI_AND_ERROR_CONTRACT.md`.
55. Success exit code is 0.
56. Runtime/protocol/DB/application failure exit code is 1.
57. CLI argument failure exit code is 2.
58. Successful apply prints exactly one application summary line containing workset ID and `observations`, `inserted`, `unchanged` counts.
59. No `--snapshot-ref`, `--snapshot-sha`, `--force`, `--replace`, `--allow-correction`, or `--dry-run` option is accepted for apply.

## Auto-migration behavior

60. Invalid file artifacts do not open/migrate the DB.
61. A valid artifact against a v5 DB may migrate it to v6 before a later DB-dependent application failure.
62. Such schema migration is not rolled back by `WORKSET_NOT_REGISTERED`, `WORKSET_SOURCE_MISMATCH`, or `LABEL_CONFLICT`.
63. Nevertheless, no partial three-class business-data application remains after failure.
