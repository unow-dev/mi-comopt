# Acceptance Tests

All cases below are required. Test names are suggestions, not contractual identifiers.

## A. Migration / repository

1. Fresh DB migrates through schema version 7.
2. Existing version-6 DB migrates to version 7 without changing existing raw snapshots, worksets, or labels.
3. `keyword_candidate_publications` rejects more than one `is_current = 1` row via the partial unique index.
4. Publication row can reference an existing `raw_snapshots.snapshot_id`.
5. `base_run_id` is allowed to reference a run absent from DB.
6. `request_id` and `input_fingerprint` are not artificially unique across DB rows.
7. `raw-snapshot-projection` manifests now report `database_schema_version: 7` with otherwise unchanged projection behavior.

## B. Snapshot label projection

8. Fully labeled snapshot returns labels ordered by `source_index`.
9. Candidate source dataset records are ordered by `source_index` and contain exactly the agreed fields.
10. Repeating projection from unchanged DB produces byte-identical source dataset JSON.
11. Source dataset byte SHA is stable across repeated generation.
12. One missing label causes `THREE_CLASS_LABELS_INCOMPLETE`.
13. A source-index gap/misalignment causes failure before handoff generation.
14. Invalid raw snapshot integrity still fails through existing raw snapshot checks.
15. No `workset_id`, `observation_id`, or synthetic `record_id` appears in candidate source dataset.

## C. `generate-keyword-candidate-handoff`

16. Exactly one valid `--snapshot-ref` produces a complete existing candidate handoff file set plus `handoff_manifest.json`.
17. Generated request source SHA equals SHA-256 of exact `source_dataset.json` bytes.
18. Generated request source ref equals `<payload_sha256>:<snapshot_index>`.
19. Handoff manifest hashes every `HANDOFF_FILES` member correctly.
20. Existing current publication policy/taxonomy/source bindings are checked by reused `prepareHandoffBundle()` behavior.
21. `--snapshot-sha` is rejected for this command.
22. Zero or multiple `--snapshot-ref` values are rejected.
23. Existing output directory causes exclusive-output failure and is not modified.
24. Handoff generation does not insert a keyword-candidate publication DB row.

## D. Handoff/source verification during DB apply

25. Valid handoff + corresponding valid filesystem current publication imports successfully.
26. Missing handoff file fails with existing `HANDOFF_MANIFEST_MISMATCH`.
27. Modified handoff file bytes fail manifest verification.
28. Modified `source_dataset.json` fails before DB mutation.
29. Handoff `snapshot_ref` pointing to a different DB snapshot fails `KEYWORD_CANDIDATE_SOURCE_MISMATCH` (or the designated source-mismatch code).
30. DB labels changed/missing relative to handoff source bytes fails before DB mutation.
31. Request source SHA mismatch fails.
32. Request source ref mismatch fails.
33. Request fingerprint cannot be reproduced via `makeGenerationRequest()` → fail.
34. Handoff policy/taxonomy bytes whose semantic hashes do not match request fail.

## E. Filesystem publication verification during DB apply

35. Current publication request differs from handoff request → fail `KEYWORD_CANDIDATE_PUBLICATION_MISMATCH` or reused binding error.
36. Current publication candidate view differs from handoff → fail.
37. Current publication pre-evaluation differs from handoff → fail.
38. Current `run_manifest.run_type != full_update` → fail.
39. Parent publication missing → fail.
40. Parent run manifest does not match request base publication → existing `PARENT_MANIFEST_MISMATCH`.
41. Current run manifest parent-manifest hash differs from actual parent manifest → fail.
42. Candidate proposal request ID/fingerprint/base-registry context invalid → fail through existing proposal validation.
43. Current generated artifacts fail `validateGeneratedArtifacts()` → fail.
44. Any run-manifest artifact `content_sha256` mismatch → fail.
45. Any source/policy/taxonomy cross-binding mismatch → fail.
46. Every failure above leaves DB keyword-candidate publication rows unchanged.

## F. DB apply idempotency / history

47. First valid publication import inserts one row and marks it current.
48. Importing a new verified run marks old DB current false and new row true atomically.
49. Reapplying exact same current run succeeds as `already-applied` with no row mutation.
50. Same run ID with different immutable stored content fails `KEYWORD_CANDIDATE_RUN_CONFLICT`.
51. Attempt to apply a run ID already stored as non-current fails `KEYWORD_CANDIDATE_RUN_CONFLICT`.
52. Failed insert/update rolls back without losing the existing DB-current row.
53. DB may import C when DB currently has A and filesystem lineage is A -> B -> C while B was never imported into DB.
54. Case 53 stores `C.base_run_id = B` even though no B row exists in DB.
55. Case 53 still requires filesystem B parent manifest to exist and bind correctly to C.
56. Existing rows with no DB-current row are detected as database integrity failure rather than silently treated as a clean first import.

## G. Stored provenance

57. Imported DB row points to the exact snapshot ID represented by handoff source dataset.
58. DB row stores verified request ID, input fingerprint, source SHA, base run ID, run ID, and published timestamp.
59. Stored handoff/request/proposal/run-meta/candidate JSON texts are exact UTF-8 texts read from verified artifacts (no semantic-only rewrite requirement).
60. `applied_at` is the only expected apply-specific mutable/time-dependent value and is excluded from same-run idempotency equality.

## H. UI export

61. With one DB-current publication, export writes its stored `filter_keyword_candidates_json` to requested output.
62. Parsed stored candidates must hash to `current_meta.candidates_content_sha256` before write.
63. Corrupt DB candidate JSON or hash mismatch fails before replacing output.
64. No DB-current publication fails `KEYWORD_CANDIDATE_PUBLICATION_NOT_FOUND`.
65. Existing UI output file is replaced successfully.
66. Replacement is atomic: target is never intentionally written in partial form.
67. Temporary file is in the same directory as the target and is cleaned on error.
68. Output bytes equal the stored verified candidate JSON text.
69. Existing UI adapter tests continue to pass without candidate schema changes.

## I. CLI / regression

70. General `comment-db --help` includes all three new commands.
71. Per-command help/usage includes required options.
72. Missing required options return CLI exit code 2 through existing argument-error path.
73. Workflow/data failures return exit code 1.
74. Existing `generate-three-class-workset`, `apply-three-class-response`, analysis export, raw verification, and import commands retain behavior.
75. `npm test` passes in full.

## Critical end-to-end scenario

At least one test should exercise the full issue flow with fixtures:

```text
DB snapshot + complete three-class labels
  -> generate-keyword-candidate-handoff
  -> fixture candidate proposal / existing full-update helper
  -> filesystem current publication
  -> apply-keyword-candidate-publication
  -> export-keyword-candidates-ui
  -> parse through existing UI candidate adapter
```

Verify the snapshot/source SHA/request fingerprint/run ID bindings along the entire path.
