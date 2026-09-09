# Closed Design Decisions

These decisions were explicitly compared during discussion and are closed for implementation.

| Topic | Adopted | Rejected / reason |
|---|---|---|
| Candidate source of truth | Existing immutable filesystem publication | DB as independent candidate state machine: duplicates domain logic |
| DB role | Verified durable mirror of explicitly applied publications | Complete candidate-history authority: makes skipped DB apply unrecoverable without backfill |
| Scope | All 3 ranges: DB→handoff, publication→DB, DB→UI | Narrowing to only handoff generation |
| Candidate persistence shape | One row per applied publication, selected JSON artifacts stored | Candidate-per-row normalized registry: unnecessary second model |
| DB current marker | `is_current` with partial unique index | Separate current table: extra state; timestamp inference: ambiguous |
| DB parent enforcement | No requirement against DB-current; `base_run_id` provenance only | `incoming.base_run_id == DB current`: breaks recovery after skipped DB import |
| Filesystem parent verification | Verify request against immutable filesystem parent | Trust DB parent chain: wrong authority |
| DB history gaps | Allowed | Reject gaps: creates backfill requirement and second lineage authority |
| Candidate source identity | exact `snapshot_ref` + dataset byte SHA + existing request fingerprint | Mandatory three-class `workset_id`: couples ranges unnecessarily |
| Source observation identity in artifact | `snapshot_ref + source_index` | DB `observation_id`: internal surrogate key leakage; synthetic record ID unnecessary |
| Dataset serialization | Existing `prettyJson()` exact bytes | New serializer/schema system: unnecessary |
| Candidate handoff generation | Reuse `prepareHandoffBundle()` | Reimplement candidate request/fingerprint/handoff rules |
| Proposal DB application | Import only after existing `full-update` publishes | Apply proposal directly in DB: needs duplicate add/update/retire/reactivate semantics |
| Request verification | Re-derive via existing `makeGenerationRequest()` | Trust request file without re-binding inputs |
| UI export | Exact stored current candidate JSON text, atomic replace | Rebuild candidates from DB rows; new UI schema |
| UI changes | None expected | Modify adapter/components despite unchanged output contract |
| Handoff generation DB write | None (read-only) | Register handoff immediately: adds unused/pending state lifecycle |
| Policy/taxonomy CLI options | Use repository-standard files | Expose extra operator choices without issue requirement |
| Arbitrary publication import | Filesystem `current` only | `--publication <dir>`: makes accidental stale import easy |
| Historical DB re-promotion | Not supported | Rollback/re-promote feature: outside issue/MVP |
