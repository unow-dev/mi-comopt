# Implementer checklist

Use this as the execution order.

## Phase 1 — protocol primitives

- [ ] Add canonical v1 `PROMPT.md` and `RULES.md` from this handoff.
- [ ] Add protocol constant `three-class-workset-v1`.
- [ ] Add strict JSON reader with duplicate-key rejection.
- [ ] Add HISTORY validator/deduper.
- [ ] Add ITEMS validator.
- [ ] Add UUID v4 validation/generation.
- [ ] Add expected response-schema builder.

## Phase 2 — generator rewrite

- [ ] Remove `pipeline.py` invocation from `three-class-workset.js`.
- [ ] Remove Stage13 reference/workspace/state-dir inputs.
- [ ] Preserve existing snapshot selection and ordered projection.
- [ ] Extract comment only.
- [ ] Exact-dedupe by first occurrence.
- [ ] Assign `I1...` IDs.
- [ ] Build HISTORY/ITEMS/schema.
- [ ] ZIP exactly five root files to explicit `--output`.
- [ ] Refuse overwrite.

## Phase 3 — validator

- [ ] Add `validate-three-class-response` CLI.
- [ ] Validate archive structure safely.
- [ ] Validate canonical prompt/rules.
- [ ] Validate HISTORY/ITEMS locally.
- [ ] Derive expected schema locally.
- [ ] Reject bundled-schema drift/tampering.
- [ ] Strict-parse response.
- [ ] Enforce exact workset ID and decision coverage.

## Phase 4 — CLI

- [ ] Update usage text.
- [ ] Generator options: selectors + `--history` + `--output` + optional `--db`.
- [ ] Validator options: `--workset` + `--response`.
- [ ] Remove legacy generator options.

## Phase 5 — history migration

- [ ] Implement one-shot legacy-to-v1 history migration.
- [ ] Verify anchors: 468 → 457, conflict 0, label counts 251/173/33.
- [ ] Store/output normalized v1 history artifact.
- [ ] Ensure runtime generator reads only the normalized artifact supplied via `--history`.

## Phase 6 — tests

- [ ] Replace old three-class workset tests with `07_ACCEPTANCE_TESTS.md` coverage.
- [ ] Explicitly test with legacy pipeline unavailable.
- [ ] Explicitly test duplicate ZIP and duplicate JSON keys.

## Phase 7 — cleanup review

- [ ] Search new runtime path for `pipeline.py`, `single_roundtrip`, `stage13`, `referencePath`, `request_id`, `provenance`, `workspace`, `P0`, `P1`, `P2`.
- [ ] Any remaining occurrence must be demonstrably unrelated to the new runtime path or removed.
- [ ] Confirm output ZIP contains no accidental source/operational metadata.

## Stop conditions

Do not add new behavior to solve these future concerns in v1:

- history retrieval/sampling;
- automatic batching/sharding;
- DB result application;
- automatic HISTORY promotion;
- finalization/workspace state;
- rationale/confidence output;
- provenance/hash manifests.

Open a separate design issue if any becomes necessary.
