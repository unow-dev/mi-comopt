# Final decision log

This file exists to prevent withdrawn ideas from re-entering implementation.

## Adopted

- v1.5 sibling copy; v1.4 frozen until cutover.
- Stage13 -> Three-Class semantic serial order retained.
- One external human handoff/response; internal multi-pass allowed.
- Stage13 exact reference reuse stays automatic.
- Stage13 human dedupe only for exact 5-field duplicate pending records.
- Pending Stage13 records get hypothetical normal/nuisance Three-Class precomputation.
- Three-Class human review task identity remains exact `record_key`; only duplicate exact keys dedupe.
- Existing golden/P2 exact decisions applied before deciding human work.
- Unresolved P2 not included as mandatory single-roundtrip work.
- Response uses request-scoped S/T IDs.
- Stage13 response requires label + non-empty note.
- Three-Class response requires existing reason_code + non-empty note; label auto-derived.
- Potential inactive T-task represented as `null`.
- Existing canonical operational rationale derived from reason_code.
- One per-run request manifest; canonical request is workspace directory, ZIP is transport only.
- request_id binds semantic files + input/reference/config/registry/implementation hashes.
- stdlib runtime validator + generated JSON Schema; no new external dependency.
- accepted boundary only after full snapshot deterministic finalization/validation succeeds.
- accepted response immutable; machine retry cannot force re-review.
- P0/P1 golden only is writable; P2 snapshot is read-only in transaction.
- concurrency auto-merge only when current-run semantics cannot change; exact decision equality for idempotence.
- public CLI only `prepare-single-roundtrip` / `finalize-single-roundtrip`.
- new CLI exit codes 0/3; stdout one JSON object on success.
- atomic workspace/final/registry handling and immutable receipts.
- accepted response can export v1.4-compatible fallback artifacts without re-review.
- keyword candidate accepts explicit pipeline versions 1.4.0 and 1.5.0, still rejects mixed evidence.
- five-PR implementation/cutover sequence.

## Explicitly rejected / deferred

- single giant combined classifier that changes Stage13/Three-Class semantics
- all pending records receiving manual final Three-Class labels regardless of need
- mandatory P2 review
- `(stage13_label, comment)` semantic bulk adjudication across distinct record_keys
- reuse of a golden decision to another exact record merely because comment is same/similar
- normalization/casefold/trim based dedupe
- Stage13 dedupe wider than exact 5 fields
- handle alias / handle-affinity shard changes in MVP
- Web UI / bundled review driver in MVP
- new reason codes
- free-form note removal
- public validate/resume/commit subcommands
- single model invocation requirement
- semver-range acceptance of future labeling versions
- large shared-core refactor
- single-roundtrip bootstrap
- modifying v1.4 runbook before cutover gate
