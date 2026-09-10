# Implementation handoff: exclude already-labeled exact comments from three-class worksets

## 1. Goal

Change `three-class-workset` so that comments already carrying a three-class label anywhere in Comment DB are treated as existing precedents rather than new classification targets.

For an exact `comment_text` key:

- collect all existing Comment DB labels;
- resolve conflicts by `direct_nuisance > reactive > normal`;
- merge the resolved DB label into generated `HISTORY.json`;
- exclude that exact comment from generated `ITEMS.json`;
- preserve enough DB-side provenance to reproduce the generated `ITEMS.json` later during response application.

The normal operating source of truth after the historical backfill is Comment DB. `three-class-final-sync` remains a one-time/backfill adapter; it is not a continuously invoked synchronization mechanism.

## 2. Non-goals

Do not do any of the following in this issue:

- do not normalize comment strings (no trim, case folding, Unicode normalization, or whitespace rewriting);
- do not reclassify DB-labeled comments;
- do not propagate an existing label automatically to every observation with the same comment;
- do not turn `three-class-final-sync` into a continuous synchronization path;
- do not change `three-class-workset-v1`, ZIP members, response schema, prompt, or rules;
- do not use the input `HISTORY.json` itself as a reason to exclude an item;
- do not use worst-label resolution to silently settle a conflict between a workset response and a label added after generation;
- do not make workset membership depend on the *current* DB label state at apply time.

## 3. Exact-key semantics

The key is the JavaScript/SQLite exact comment string.

Examples that must remain different keys:

- `"A"` and `"A "`
- `"A"` and `"a"`
- `"A"` and `"Ａ"`
- `""` and `" "`

The existing first-occurrence deduplication behavior of `buildThreeClassItems` remains exact-string based.

## 4. Label resolution rule

The permanent domain rule is:

```text
normal < reactive < direct_nuisance
```

Move the priority definition out of the one-shot `scripts/adapters/three-class-final-sync.js` into a permanent three-class domain module, recommended path:

```text
src/three-class/label-resolution.js
```

Both final-sync and workset generation must consume the same explicit priority definition. Do not infer severity from `protocol.js` enum order.

Recommended minimal API shape (names may differ, semantics may not):

```js
export const THREE_CLASS_LABEL_PRIORITY = new Map([
  ["normal", 1],
  ["reactive", 2],
  ["direct_nuisance", 3],
]);

export function worseThreeClassLabel(left, right) { ... }
```

`three-class-final-sync.js` should continue doing its own input-shape validation and conflict counting; only the enduring label-order rule moves to the shared module.

## 5. Effective Comment DB labels

Use `readExistingCommentLabels(db)` as the global input. It already returns one row per `(comment_text, label)` with an example/minimum observation id for that label.

Build an effective map keyed by exact `commentText`. For each comment:

- `label`: highest-priority label among its rows;
- `firstObservationId`: minimum `exampleObservationId` across all rows for that comment, regardless of which label wins.

The second field is used only to make newly appended DB precedents deterministic.

Example:

```text
A: normal at observation 10
A: reactive at observation 21
A: direct_nuisance at observation 30
```

resolves to:

```text
A -> { label: direct_nuisance, firstObservationId: 10 }
```

## 6. Generated HISTORY.json

Input history continues to be validated first with the current contract:

```js
validateHistory(value, { deduplicate: true })
```

Therefore:

- repeated same `(comment,label)` entries collapse;
- conflicting labels for the same exact comment inside the input HISTORY remain `INVALID_HISTORY`.

After validation, merge the effective Comment DB labels as follows:

1. preserve the validated input HISTORY order;
2. when a HISTORY comment also exists in the DB effective map, keep its existing position but replace its label with the DB effective label;
3. append DB-only comments after all input HISTORY comments;
4. order DB-only comments by `firstObservationId ASC`, then `commentText ASC` as a deterministic tie-breaker;
5. each exact comment appears at most once in generated HISTORY.

Important: a comment appearing only in input HISTORY is still merely a precedent. It is **not** excluded from ITEMS unless Comment DB also contains a label for that exact comment.

The generated file keeps the current v1 shape:

```json
{
  "protocol_version": "three-class-workset-v1",
  "items": [
    { "comment": "...", "label": "normal" }
  ]
}
```

## 7. Generated ITEMS.json

Modify the item builder to support an exclusion set. Recommended compatible signature:

```js
function buildThreeClassItems(records, excludedComments = new Set())
```

Behavior:

1. traverse projected records in the existing source order;
2. validate `record.comment` exactly as today;
3. keep only the first occurrence of each exact comment;
4. if that first-occurrence comment is in `excludedComments`, omit it;
5. assign `I1`, `I2`, ... only to the remaining comments, with no gaps.

Generation constructs `excludedComments` from the keys of the effective Comment DB label map.

Examples:

```text
source: A, B, A, C
DB labels: A -> reactive
ITEMS: I1=B, I2=C
```

```text
source: A
input HISTORY: A -> normal
DB labels: none
ITEMS: I1=A
```

An empty ITEMS array remains valid.

## 8. Workset provenance migration

Current application schema version in the supplied snapshot is 7. Add schema version 8.

Recommended filename:

```text
db/comment-database/008-three-class-workset-labeled-comment-exclusion.sql
```

Normative schema:

```sql
CREATE TABLE three_class_workset_excluded_comments (
    workset_id TEXT NOT NULL,
    comment_text TEXT NOT NULL,

    PRIMARY KEY (workset_id, comment_text),

    FOREIGN KEY (workset_id)
        REFERENCES three_class_worksets(workset_id)
) STRICT;

PRAGMA user_version = 8;
```

Then update `src/database/comment-database.js`:

```text
APPLICATION_SCHEMA_VERSION = 8
```

and append migration 008 after the repository's existing migration 007.

Do not add a workset version column. A legacy workset naturally has zero rows in the exclusion table and therefore reproduces the old behavior.

Only comments that were actually present in the selected workset source and omitted from ITEMS need to be registered in this table. Do not store every globally labeled Comment DB comment for every workset.

Do not store the adopted label in this provenance table. Its purpose is workset membership/source reproduction, not an audit copy of generated HISTORY.

## 9. Repository API changes

Extend `src/database/three-class-label-repository.js` with equivalent behavior to the following.

### registerWorkset

Recommended shape:

```js
registerWorkset(db, {
  worksetId,
  snapshotIds,
  excludedComments = [],
})
```

It must insert:

- `three_class_worksets` row;
- snapshot refs as today;
- one `three_class_workset_excluded_comments` row for each excluded exact comment.

Generation already wraps registration in `BEGIN IMMEDIATE`; keep all provenance inserts inside that same transaction.

### readWorksetExcludedComments

Add:

```js
readWorksetExcludedComments(db, worksetId)
```

returning the registered exact comment strings in deterministic order. The order is not semantically relevant to exclusion but deterministic SQL output simplifies tests. `ORDER BY comment_text` is sufficient.

### readExistingCommentLabels

Its logical result contract can remain unchanged. Adding an explicit deterministic `ORDER BY` is recommended but the effective-map builder must not rely on SQL row order for correctness.

## 10. Generation flow

In `generateThreeClassWorkset` the order should be conceptually:

```text
validate input HISTORY
open DB
resolve/read selected snapshots
build analysis artifacts
read global existing DB labels
build effective DB-label map
merge generated HISTORY
build excludedComments = effective DB map keys
build ITEMS from source using excludedComments
compute actuallyExcluded = unique selected comments intersect excludedComments
write/package/validate ZIP
register workset(snapshotIds, actuallyExcluded) in one transaction
```

`actuallyExcluded` is not the whole global DB label set. It is the exact comments from this workset's selected source that were omitted because a DB effective label existed.

The simplest safe way to derive it is during the same first-occurrence scan used for item construction, or by returning both `items` and `excluded` from a helper. Avoid a second implementation of comment dedup semantics that could drift from `buildThreeClassItems`.

A good internal shape is:

```js
function buildThreeClassItemPlan(records, excludedComments) {
  return { items, excludedComments: actuallyExcluded };
}
```

with `buildThreeClassItems` optionally delegating to it for backward readability. Exact helper naming is non-normative.

Generated summary values keep their current meaning:

- `itemCount`: generated classification items after exclusion;
- `historyCount`: merged generated HISTORY count.

No CLI argument or output-format change is required.

## 11. Apply/source-reproduction flow

Current source verification is:

```text
registered snapshot refs -> rebuild ITEMS -> deepEqual ZIP ITEMS
```

Preserve that boundary, adding the registered exclusion set:

```text
registered snapshot refs
  -> read selected snapshots
  -> build analysis artifacts
  -> read registered excluded comments
  -> reproduce first-occurrence unique comments
  -> verify every registered excluded comment exists in that reproduced unique source set
  -> rebuild ITEMS using the registered exclusion set
  -> deepEqual against ZIP ITEMS
```

Failure is `WORKSET_SOURCE_MISMATCH`.

The explicit existence check for every registered excluded comment is required. It prevents a damaged source from accidentally reproducing the same ITEMS after an excluded source comment disappears.

Do **not** re-query current Comment DB labels to decide whether a registered excluded comment still deserves exclusion. Workset membership is fixed at generation time. A later label change/removal must not mutate what the workset means.

Legacy worksets have an empty registered exclusion set, so this same code path reproduces the old source-verification behavior without a version branch.

## 12. Apply target observations

The current integrity rule requiring every selected observation's comment to exist in the response decision map must be removed/replaced, because selected snapshots may now contain intentionally excluded comments.

Keep the existing DB/source observation-count integrity check:

```text
readTargetObservations(workset).length
==
selected source observation count
```

Then define:

```js
const responseTargets = targetObservations.filter(
  (target) => decisionByComment.has(target.commentText),
);
```

Only `responseTargets` participate in:

- existing target-label lookup/application;
- insertion;
- unchanged counting;
- target-level label conflict checks;
- returned `observations` count.

An excluded selected observation is left untouched.

The returned invariant becomes:

```text
observations === inserted + unchanged
```

where all three counts refer only to response-target observations.

For old worksets every selected unique comment is still an ITEM, so the observable legacy counts remain unchanged.

## 13. Apply conflicts after generation

For a comment that was an ITEM at generation time but receives a DB label before apply:

- if every existing exact-comment label equals the response label, apply remains allowed;
- if any existing exact-comment label differs from the response label, return existing `LABEL_CONFLICT` behavior.

Do not run worst-label-wins between the new response and a newly added existing label. Worst-label resolution is for collapsing already-existing DB precedents during workset generation, not for overriding concurrent changes.

For a comment that was excluded at generation time, later DB label changes/removal do not alter workset membership and do not gate apply. The workset never contains a response decision for that comment.

## 14. One-time historical synchronization boundary

`three-class-final-sync` is a backfill/one-shot operational adapter. It is deliberately re-runnable/idempotent for recovery, but it is not the future source of truth and must not be invoked by workset generation or response application.

Architecture after the backfill:

```text
historical three_class_final
        |
        | one-time/backfill sync
        v
    Comment DB
        |
        | normal ongoing read
        v
three-class-workset generation
```

The only code intentionally shared between final-sync and normal workset operation is the permanent three-class label severity rule.

## 15. Protocol compatibility

Keep all of these unchanged:

```text
protocol_version = three-class-workset-v1
```

ZIP members remain exactly:

```text
PROMPT.md
RULES.md
HISTORY.json
ITEMS.json
response.schema.json
```

Do not modify the schemas solely for this issue.

## 16. Expected files to modify/add

Required or strongly expected:

```text
package/src/three-class/label-resolution.js                    # add
package/scripts/adapters/three-class-final-sync.js             # shared priority import
package/scripts/adapters/three-class-workset.js                 # generation/apply logic
package/src/database/three-class-label-repository.js            # provenance read/write
package/src/database/comment-database.js                        # schema version + migration list
package/db/comment-database/008-three-class-workset-labeled-comment-exclusion.sql  # add
package/tests/three-class-workset.test.js                       # behavior/regression coverage
package/tests/three-class-final-sync.test.js                    # ensure shared resolution behavior remains
package/tests/raw-snapshot-database.test.js                     # migration/schema coverage if this suite owns it
```

The real repository contains migration 007 even though the supplied discussion ZIP omits its SQL file. Leave 007 unchanged.

## 17. Required implementation invariants

The implementation is not complete unless all of these remain true:

- exact comment identity only;
- first-occurrence ordering only;
- response schema still exactly matches generated ITEMS IDs;
- source verification still rejects valid-looking but source-inconsistent ITEMS;
- raw snapshots remain immutable;
- labels remain stored in the label table, not back-written into raw observations;
- workset registration and exclusion provenance are atomic;
- repeated application of the same valid response remains idempotent;
- existing input HISTORY validation does not become more permissive.

## 18. Completion criterion

Implementation is ready to merge when the repository test suite passes and every case in `ACCEPTANCE_TESTS.md` is covered either by a direct test or an existing test whose assertion clearly proves the same behavior.
