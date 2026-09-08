# Final decisions

## 1. Workset provenance is stored in the generating Comment DB

A generated workset is bound to the Comment DB in which it was generated. Store:

- `workset_id`
- selected `raw_snapshots.snapshot_id` values

Do not add snapshot metadata to the v1 ZIP. Do not accept snapshot selectors at apply time.

Reason: the current v1 ZIP intentionally contains exactly five members and does not preserve source snapshots. Requiring the operator to re-select snapshots cannot prove they are the generation-time snapshots.

## 2. Use `snapshot_id` as the provenance FK

The workset is intentionally DB-bound in this MVP, so the internal surrogate identity is preferable to duplicating `payload_sha256 + snapshot_index` in the provenance table. The apply path can join `snapshot_id` back to the external refs required by the existing `readSelectedSnapshots()` code.

## 3. Keep a parent workset table

Keep `three_class_worksets(workset_id PRIMARY KEY)` plus a junction table. Do not reduce provenance to only `(workset_id, snapshot_id)` rows.

Reason: a parent insert makes a duplicate `workset_id` fail immediately instead of allowing a second generator to append a different snapshot set under the same ID.

## 4. Store only current observation labels

Store:

- `observation_id`
- `label`

Do not store `source_workset_id` on labels. It is not a complete audit history and would misleadingly preserve only the first workset that happened to insert the current value.

## 5. Raw observations remain immutable

Never `UPDATE snapshot_comment_observations` for three-class application. Three-class state is derived state in a separate table.

## 6. Classification identity is the exact comment string

The workset deduplicates by exact comment string and the issue defines classification by comment rather than by observation. Therefore a new application must not create two different current labels for the same exact comment anywhere in the DB.

This gives two distinct scopes:

- **Consistency read scope:** existing labeled comments across the DB may be read to detect conflicting labels.
- **Write scope:** only observations belonging to the workset's registered snapshots may be inserted/changed. Non-selected snapshots are never a write target.

No trimming, Unicode normalization, case folding, or whitespace normalization is allowed.

## 7. Conflict behavior

For a requested exact comment label:

- no existing label anywhere: allowed
- existing labels are all the same as requested: allowed
- any existing label differs from requested: reject the whole apply with `LABEL_CONFLICT`

For target observations specifically:

- missing current label: insert
- same current label: unchanged/no-op
- different current label: reject the whole apply

## 8. No correction in MVP

There is no `--force`, `--replace`, `--allow-correction`, label update, label delete, or event/history model.

A future correction feature must be a separate issue with an explicit history/supersession model.

## 9. Reapplication is idempotent

Reapplying the same effective decision set succeeds. Existing same-valued target rows are counted as `unchanged`; missing rows are inserted.

## 10. Source binding is verified at apply time

After reading the registered snapshots through the existing repository/projection path, regenerate ITEMS with the same helper used by generation and deep-compare the entire `items` array with the ZIP's validated `ITEMS.json.items`.

Mismatch => `WORKSET_SOURCE_MISMATCH`.

Do not add archive hashes or projection hashes in the MVP.

## 11. Legacy unregistered v1 worksets are not applyable

If a workset is not in `three_class_worksets`, reject with `WORKSET_NOT_REGISTERED`, even if its comments appear to match some snapshots.

Do not add a legacy import/rebind command. The old artifact does not contain enough provenance to prove its generation-time snapshot set.

## 12. Transaction boundaries

### Generation

Do not hold a writer transaction while projecting and packaging. Package and validate first, clean staging, then perform only the provenance registration in a short `BEGIN IMMEDIATE` transaction.

### Apply

Validate files before opening the DB. After DB open, start `BEGIN IMMEDIATE` before provenance/source/conflict reads. Keep the entire DB-dependent preflight and label insertion in that transaction.

## 13. Auto-migration is allowed before an application failure

`openCommentDatabase()` may migrate a v5 DB to v6 before an apply later fails with `WORKSET_NOT_REGISTERED`, `WORKSET_SOURCE_MISMATCH`, or `LABEL_CONFLICT`.

Atomicity means there is no partial three-class label application. It does not mean schema migration is rolled back when the business application fails.

## 14. Concurrency

Use SQLite `BEGIN IMMEDIATE` serialization only. Do not add retry loops, application lock tables, or a new `busy_timeout` policy.

## 15. Provenance is append-only through public code

Do not expose update/delete/rebind APIs or CLI commands for workset provenance. Do not add `ON DELETE CASCADE` to provenance FKs.
