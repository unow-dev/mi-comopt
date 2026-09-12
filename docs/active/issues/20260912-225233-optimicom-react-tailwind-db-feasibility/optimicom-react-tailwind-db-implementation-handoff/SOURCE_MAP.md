# Source Map

Paths are relative to the discussion-set repository root represented by `sources/`.

## 1. Target UI

### `docs/active/temp/optimicom-react-tailwind/src/App.jsx`

Current 5-screen visual implementation. Reuse layout/component styling as useful, but replace unsupported business semantics.

Known sample/static areas to remove/replace:

- browser `new Date()` as last aggregation time
- fixed Score 82 / GOOD
- fixed six-class overview/trend
- fixed AI Priority A-C
- six-class Comments tabs
- risk filters
- copy = added/blocked behavior
- account fake history

### `docs/active/temp/optimicom-react-tailwind/src/data.js`

Sample business data. Must not be used by production runtime after implementation. Preferred: delete once imports are gone.

### `docs/active/temp/optimicom-react-tailwind/package.json`

Currently only Vite build/dev/preview. Add Vitest + jsdom scripts/deps.

---

## 2. Comment DB opening and migrations

### `package/src/database/comment-database.js`

Important existing behavior:

```text
APPLICATION_SCHEMA_VERSION = 8
openCommentDatabase() auto-applies pending migrations
```

Do **not** use normal `openCommentDatabase()` in UI export path because it may mutate/migrate DB.

Reuse its path conventions/error types where sensible. Add a read-only equivalent or a dedicated small module.

### `package/db/comment-database/008-three-class-workset-labeled-comment-exclusion.sql`

Sets `PRAGMA user_version = 8` and adds `three_class_workset_excluded_comments`.

### `package/scripts/comment-database.mjs`

Existing `comment-db` CLI. Add explicit `migrate` command here unless a repository-consistent alternative is clearly better.

---

## 3. Snapshot reading

### `package/src/database/raw-snapshot-repository.js`

Reuse:

```text
readSelectedSnapshots(db, snapshotRefs)
```

This already checks:

- snapshot existence
- raw parent/integrity
- loaded_count
- source index sequence
- observation shape

Observation public shape includes:

```text
sourceIndex
username
handle
commentText
postedAt
postedDate
```

Do not duplicate these integrity checks in a new SQL implementation unless required for a missing lookup helper.

---

## 4. Three-class labels

### `package/src/database/three-class-label-repository.js`

Reuse:

```text
readSnapshotThreeClassLabels(db, snapshotId)
```

Returns `sourceIndex,label` ordered by source index.

Allowed labels are persisted by DB CHECK constraint:

```text
direct_nuisance
reactive
normal
```

---

## 5. Keyword DB publication

### `package/src/database/keyword-candidate-publication-repository.js`

Reuse:

```text
readCurrentKeywordCandidatePublication(db)
```

Current row contains:

```text
run_id
snapshot_id
request_id
input_fingerprint
source_dataset_artifact_sha256
base_run_id
published_at
applied_at
is_current
handoff_manifest_json
candidate_generation_request_json
candidate_proposal_json
run_manifest_json
current_meta_json
filter_keyword_candidates_json
```

### `package/src/processing/keyword-candidates/candidate-workflow.js`

Reuse:

```text
prettyJson()
contentSha256()
buildPublishedCandidates() contract knowledge
```

Published candidate fields are defined here.

### `package/src/processing/keyword-candidates/artifact-validation.js`

Reuse existing semantic hash/cross-artifact invariants where possible. Do not invent another keyword evaluator.

### `package/contracts/keyword-candidates/evaluation-policy-1.0.0.json`

Canonical policy semantics: normalized substring, D/R/N metrics, recommendation tiers and sorting.

---

## 6. Deterministic source dataset precedent

### `docs/active/issues/20260909-db-three-class-keyword-candidate-handoff/keyword-candidate-comment-db-implementation-handoff/IMPLEMENTATION_SPEC.md`

Section “Deterministic DB candidate source dataset” is the existing contract to reuse exactly:

```text
schema_version
labeling_status
snapshot_ref
records[source_index,username,handle,comment,postedAt,postedDate,label]
prettyJson exact bytes
```

The new UI exporter should share/extract this builder instead of creating a near-copy if practical.

---

## 7. Account candidates

### `package/src/processing/account-block-candidates/account-block-candidate-workflow.js`

Reuse:

```text
validatePolicy()
buildAccountCandidates()
validateCandidateArtifact()
serializeJson()
prefixedSha256()
```

Important exact input fields:

```text
username
handle
comment
postedAt
postedDate
label
```

The function implements:

- behavior event fingerprint = `[handle, comment, postedAt, postedDate]`
- label conflict validation
- direct_nuisance-only candidate grouping
- blank direct handle rejection
- minimum event threshold
- deterministic evidence sample
- deterministic handle fingerprint ordering

Do not reimplement these in the exporter.

### `package/contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json`

```json
{
  "candidate_label": "direct_nuisance",
  "minimum_behavior_events": 2,
  "evidence_sample_size": 2
}
```

---

## 8. Existing release subsystem — compatibility boundary

### `package/scripts/release-utils.mjs`
### `package/scripts/publish-joint-data.mjs`
### `package/scripts/verify-release.mjs`
### `package/scripts/verify-deployed-release.mjs`
### `package/tests/release.test.js`

These implement the existing `data-release.json` schema v1 for the current keyword/account static UI publication.

Do not repurpose or migrate this schema for the new Tailwind UI. New Optimicom UI publication should be a separate module/CLI while reusing generic safe patterns where useful:

- deterministic serialization
- temp staging
- atomic root replacement
- deployed verification

---

## 9. Existing architecture guidance

### `package/ARCHITECTURE.md`

Supports DB / processing / generated-artifact / UI separation. The selected architecture follows this boundary.

---

## 10. Tests to extend

### Package

Existing useful suites:

```text
package/tests/comment-database.test.js
package/tests/publication.test.js
package/tests/account-block-candidate-workflow.test.js
package/tests/release.test.js
package/tests/raw-snapshot-database.test.js
package/tests/three-class-workset.test.js
```

Add a dedicated Optimicom UI release suite instead of overloading the existing `data-release` test meaning.

Suggested new file:

```text
package/tests/optimicom-ui-release.test.js
```

### Target UI

Add tests under target app, e.g.:

```text
docs/active/temp/optimicom-react-tailwind/src/**/*.test.{js,jsx}
```

Exact file organization is implementation discretion.

---

## 11. Suggested new implementation locations

Names are recommendations, not business contracts:

```text
package/src/processing/optimicom-ui-release/
  source-dataset.js
  overview.js
  release.js

package/scripts/export-optimicom-ui-release.mjs
package/scripts/verify-optimicom-ui-release.mjs
package/scripts/verify-deployed-optimicom-ui-release.mjs
```

Prefer extracting reusable source-dataset builder from the existing keyword DB adapter if that avoids duplicate contract code.

---

## 12. Reference documents in this ZIP

`references/ISSUE_BODY_ORIGINAL.md`
: Original issue before final decisions. Contains superseded decisions; not authoritative.

`references/FEASIBILITY_REPORT.md`
: Initial DB/UI feasibility findings and observed counts.

`references/IMPLEMENTATION_POLICY_WORKSET.md`
: Decision workset/history. Contains superseded choices; not authoritative.

`references/DISCUSSION_SET_CONTENTS.md`
: Inventory of the source discussion set.
