# Implementation specification

## A. Shared ITEMS builder

Extract the current generator's exact-string dedupe into one private helper in `scripts/adapters/three-class-workset.js`.

Conceptual contract:

```js
function buildThreeClassItems(records) {
  const seenComments = new Set();
  const items = [];

  for (const record of records) {
    if (typeof record.comment !== "string") {
      throw worksetError("DATABASE_INTEGRITY_ERROR", "projected record comment must be a string");
    }
    if (seenComments.has(record.comment)) continue;
    seenComments.add(record.comment);
    items.push({ id: `I${items.length + 1}`, comment: record.comment });
  }
  return items;
}
```

Generation and application must both call this exact helper. Do not duplicate the dedupe algorithm.

## B. Repository module

Add `src/database/three-class-label-repository.js` and keep it SQL-only. Workflow/business decisions stay in the adapter.

Recommended minimal responsibilities:

```js
registerWorkset(db, { worksetId, snapshotIds })
readWorksetSnapshotRefs(db, worksetId)
readTargetObservations(db, worksetId)
readExistingCommentLabels(db)
readExistingTargetLabels(db, worksetId)
insertObservationLabel(db, { observationId, label })
```

Exact names are local implementation detail, but these responsibilities must remain separated from workflow decisions.

### `registerWorkset`

Within the caller-owned transaction:

1. plain `INSERT` into `three_class_worksets`
2. plain `INSERT` one row per selected snapshot into `three_class_workset_snapshots`

Do not use replace/upsert/ignore semantics.

### `readWorksetSnapshotRefs`

Return the registered snapshots transformed back to the external reference shape expected by `readSelectedSnapshots()`:

```sql
SELECT rs.payload_sha256, rs.snapshot_index
FROM three_class_workset_snapshots AS tws
JOIN raw_snapshots AS rs
  ON rs.snapshot_id = tws.snapshot_id
WHERE tws.workset_id = ?
ORDER BY rs.payload_sha256, rs.snapshot_index;
```

If the workset parent does not exist, the adapter emits `WORKSET_NOT_REGISTERED`.

A registered workset with zero snapshot rows is an impossible integrity state and should surface as `DATABASE_INTEGRITY_ERROR`.

### `readTargetObservations`

The write target must be derived only from the registry:

```sql
SELECT
    sco.observation_id,
    sco.comment_text
FROM three_class_workset_snapshots AS tws
JOIN snapshot_comment_observations AS sco
  ON sco.snapshot_id = tws.snapshot_id
WHERE tws.workset_id = ?
ORDER BY sco.snapshot_id, sco.source_index;
```

Do not derive the target by querying the DB globally by comment text.

### `readExistingCommentLabels`

For the small current dataset, one grouped read is sufficient and avoids batching/index design in the MVP:

```sql
SELECT
    sco.comment_text,
    labels.label,
    MIN(labels.observation_id) AS example_observation_id
FROM snapshot_comment_three_class_labels AS labels
JOIN snapshot_comment_observations AS sco
  ON sco.observation_id = labels.observation_id
GROUP BY sco.comment_text, labels.label;
```

The adapter only evaluates rows whose `comment_text` exists in the requested decision map.

Do not add a new `comment_text` index solely for this MVP.

### `readExistingTargetLabels`

Read current labels only for registry-scoped target observations. Prefer a registry join rather than an enormous `IN (...)` list.

## C. Shared validated submission reader

Refactor response reading so both validate and apply use the same validated in-memory objects.

Conceptual structure:

```js
async function readValidatedThreeClassSubmission({ worksetPath, responsePath }) {
  const workset = await validateWorksetArchive(worksetPath);
  // existing strict regular-file/read/parse behavior
  const response = ...;
  validateResponseValue(response, workset);
  return { workset, response };
}
```

`validateThreeClassResponse()` calls this helper and preserves its current public output.

`applyThreeClassResponse()` calls the same helper.

After validation, do not re-read either input file. Use the validated in-memory values throughout application.

## D. Generation flow

Update `generateThreeClassWorkset()`:

```text
validate args/templates/history
open DB (auto migration allowed)
resolve snapshot selectors
readSelectedSnapshots()
buildAnalysisArtifacts()
buildThreeClassItems()
generate workset UUID
write staging files
package final ZIP
packager success => this run owns the final ZIP
validateWorksetArchive(final ZIP)
remove staging directory successfully
BEGIN IMMEDIATE
INSERT workset parent
INSERT selected snapshot_id bindings
COMMIT
return success
```

Use `selectedSnapshots.map(({ snapshot }) => snapshot.snapshotId)` for the binding.

Do not re-read/re-project snapshots immediately before registry commit. Unsupported concurrent mutation may make the resulting workset fail closed later with `WORKSET_SOURCE_MISMATCH`; it must not widen the write scope.

### Generation cleanup contract

`generate-three-class-workset` command success means both:

- valid final ZIP exists
- provenance registration committed

If an error occurs after this JS invocation has successfully obtained ownership of the final ZIP but before provenance commit, best-effort delete the final ZIP and leave no partial provenance transaction.

Do not delete an output that this invocation cannot prove it owns.

## E. Python packager ownership cleanup

Modify `scripts/pack-three-class-workset.py` so that if it successfully creates the final hard-link but later fails its own archive read/self-check, it best-effort removes the final output it created before returning failure.

Current relevant sequence is:

```text
os.link(temporary_name, output)
os.unlink(temporary_name)
read_archive(output)
```

Track whether this package invocation linked the final output and whether the package completed successfully. Cleanup the final output only when this invocation created it and the package subsequently failed.

This is necessary because the JS caller cannot safely distinguish "packager created then failed" from a competing process owning the path when the subprocess exits non-zero.

## F. Apply flow

Add:

```js
export async function applyThreeClassResponse({ dbPath, worksetPath, responsePath })
```

Processing order:

```text
1. readValidatedThreeClassSubmission()       // no DB open yet
2. openCommentDatabase()                     // may migrate v5 -> v6
3. BEGIN IMMEDIATE
4. confirm workset parent exists
5. read registered snapshot refs
6. readSelectedSnapshots(db, refs)
7. buildAnalysisArtifacts(selectedSnapshots)
8. buildThreeClassItems(artifacts.records)
9. deepEqual(regeneratedItems, workset.items.items)
10. build decisionByComment from workset.items + response.decisions
11. read existing labeled comment/label groups across DB
12. reject any requested comment with any differing current label
13. read registry-scoped target observations
14. assert target count equals selected snapshot observation count
15. assert every target comment exists in decisionByComment
16. read existing target labels
17. preflight target labels: same => unchanged; different => LABEL_CONFLICT; missing => pending insert
18. after all preflight passes, plain INSERT each pending label
19. assert inserted + unchanged === target observation count
20. COMMIT
21. return counts
```

On any transaction error, rollback and preserve the original error.

## G. Decision map

Construct from validated workset items and response decisions, not from DB rows:

```js
const decisionByComment = new Map();
for (const item of workset.items.items) {
  decisionByComment.set(item.comment, response.decisions[item.id]);
}
```

Since `ITEMS.json` is validated and regenerated before use, duplicate exact comments are impossible in this map.

## H. Source verification

Compare the full regenerated item array with the validated ZIP item array:

```js
deepEqual(regeneratedItems, workset.items.items)
```

The comparison covers item count, item IDs, order, and exact comment strings.

Mismatch => `WORKSET_SOURCE_MISMATCH`.

## I. Observation count invariant

Compute:

```js
const expectedObservationCount = selectedSnapshots.reduce(
  (sum, bundle) => sum + bundle.observations.length,
  0,
);
```

Require:

```text
expectedObservationCount === targetObservations.length
```

Otherwise `DATABASE_INTEGRITY_ERROR`.

Before commit also require:

```text
inserted + unchanged === targetObservations.length
```

## J. Empty-observation worksets

The generator still requires at least one selected snapshot through existing selection behavior. A selected snapshot set may legitimately contain zero comment observations, producing `ITEMS.items = []`.

Such an apply succeeds with:

```text
observations=0 inserted=0 unchanged=0
```
