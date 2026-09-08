# Implementer checklist

## Schema

- [ ] Add migration 006.
- [ ] Set application schema version to 6.
- [ ] Add `three_class_worksets` parent table.
- [ ] Add workset-to-snapshot junction keyed by `snapshot_id`.
- [ ] Add current observation-label table with only `observation_id` and checked `label`.
- [ ] Do not add `source_workset_id` to labels.
- [ ] Do not add CASCADE delete rules, triggers, audit tables, or backfills.

## Generation

- [ ] Extract exact-string ITEMS builder and reuse it later in apply.
- [ ] Register provenance only after valid ZIP creation and validation.
- [ ] Use selected bundle `snapshot.snapshotId` values.
- [ ] Keep projection/packaging outside writer transaction.
- [ ] Make provenance insert atomic with `BEGIN IMMEDIATE`.
- [ ] Make workset provenance append-only; no rebind/update/delete API.
- [ ] Ensure post-package failure cleanup only removes ZIPs owned by the failing invocation.
- [ ] Fix Python packager's post-link failure cleanup.

## Validation

- [ ] Share validated submission reading between existing validate command and apply.
- [ ] Do not weaken any current v1 archive/template/schema/workset-ID/item-coverage checks.
- [ ] Do not re-read workset/response after successful validation.

## Application

- [ ] Open DB only after file/protocol validation.
- [ ] Start `BEGIN IMMEDIATE` before DB-dependent preflight.
- [ ] Reject unregistered workset.
- [ ] Derive source refs from registry and reuse `readSelectedSnapshots()`.
- [ ] Reuse `buildAnalysisArtifacts()`.
- [ ] Regenerate ITEMS with the shared helper and deep-compare.
- [ ] Build exact comment -> requested label map from validated artifacts.
- [ ] Read existing comment labels across DB and enforce one global current label per exact requested comment.
- [ ] Derive write targets only from registered snapshots.
- [ ] Check source/target observation count equality.
- [ ] Ensure every target comment resolves in the decision map.
- [ ] Preflight all target existing labels before insert.
- [ ] Use plain INSERT only for missing target labels.
- [ ] Never update raw observations.
- [ ] Never write non-selected snapshots.
- [ ] Verify `inserted + unchanged === observations` before commit.
- [ ] Roll back on any failure.

## CLI

- [ ] Add `apply-three-class-response` to help/parser/allowed options/dispatch.
- [ ] Required: `--workset`, `--response`; optional: `--db`.
- [ ] Reject snapshot selectors and correction/force/dry-run options.
- [ ] Print one `APPLIED ...` line on success.
- [ ] Preserve exit-code conventions 0/1/2.

## Tests

- [ ] Existing tests remain green after ITEMS helper refactor.
- [ ] Add all cases in `06_ACCEPTANCE_TESTS.md`.
- [ ] Run full `npm test` before handoff/merge.
