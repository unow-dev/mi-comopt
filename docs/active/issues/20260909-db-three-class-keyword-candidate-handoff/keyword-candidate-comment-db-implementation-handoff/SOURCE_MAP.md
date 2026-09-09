# Source Map and Reuse Guide

This handoff was checked against the supplied discussion-set source tree. Use these existing boundaries rather than recreating them.

## Comment DB

### `src/database/comment-database.js`

Current supplied state:

- `APPLICATION_SCHEMA_VERSION = 6`.
- migrations array contains versions 1–6.
- `CommentDatabaseError` is the DB error class.
- `openCommentDatabase()` applies migrations and enables foreign keys.

Required change: add migration 007 and bump application schema to 7.

### `db/comment-database/006-three-class-label-application.sql`

Existing tables:

```text
three_class_worksets
three_class_workset_snapshots
snapshot_comment_three_class_labels
```

`snapshot_comment_three_class_labels.observation_id` is the primary key and labels are constrained to the three accepted values. Existing response application rejects conflicting relabeling, so persisted observation labels are stable inputs for deterministic candidate dataset generation.

### `src/database/three-class-label-repository.js`

Existing APIs are workset-oriented. Add a snapshot-oriented read function only; do not alter existing application semantics.

### `src/database/raw-snapshot-repository.js`

Reuse `readSelectedSnapshots(db, snapshotRefs)`.

It already:

- resolves exact snapshot rows;
- verifies raw input/snapshot integrity;
- verifies observation count equals `loaded_count`;
- verifies `source_index` sequence;
- returns observations containing:
  - `sourceIndex`
  - `username`
  - `handle`
  - `commentText`
  - `postedAt`
  - `postedDate`

This is exactly the raw side needed for the new candidate dataset.

## Existing analysis projection

### `src/processing/analysis-input/raw-snapshot-projection.js`

Current supplied state:

```text
ANALYSIS_PROJECTION_VERSION = "1.0.0"
ANALYSIS_MANIFEST_SCHEMA_VERSION = 3
DATABASE_SCHEMA_VERSION = 6
```

Only `DATABASE_SCHEMA_VERSION` changes to 7.

`serializeAnalysisJson()` has the same human-readable JSON shape (`JSON.stringify(..., null, 2) + "\n"`) as candidate `prettyJson()`, but use candidate `prettyJson()` for the new candidate dataset to keep this flow under the candidate artifact serialization utility.

## Candidate workflow

### `src/processing/keyword-candidates/candidate-workflow.js`

Reuse:

```text
prettyJson
contentSha256
makeGenerationRequest
validateProposal
```

`prettyJson()` emits two-space-indented JSON with a trailing newline.

`contentSha256()` hashes canonical JSON semantics and returns `sha256:<64 lowercase hex>`.

`makeGenerationRequest()` derives `input_fingerprint` from:

- base publication;
- source dataset artifact descriptor;
- candidate view hash;
- pre-evaluation hash;
- evaluation policy metadata;
- taxonomy metadata;
- output schema version.

### `src/processing/keyword-candidates/handoff-workflow.js`

Reuse:

```text
HANDOFF_FILES
prepareHandoffBundle
verifyHandoffBundle
```

`prepareHandoffBundle()` already validates the base current publication, policy, taxonomy and generated handoff bindings. For the DB source dataset path, provide `explicitSourceSha` and `explicitSourceRef`; do not use legacy labeling summary/validation evidence.

`verifyHandoffBundle()` validates handoff manifest structure and exact byte SHA of all expected handoff files.

### `src/processing/keyword-candidates/update-flow.js`

Reuse:

```text
validateParentManifest
```

The existing `prepareFullUpdate()` remains the state transition/evaluation authority. The DB importer must not implement an alternative full-update.

### `src/processing/keyword-candidates/artifact-validation.js`

Reuse:

```text
validateGeneratedArtifacts
```

It verifies candidate registry, evaluation candidate set, derived `filterKeywordCandidates`, run manifest hashes, and current-meta hashes.

## Candidate publication filesystem

### `scripts/adapters/keyword-publication.js`

Reuse:

```text
resolveCurrentPublicationDir(rootDir)
```

Existing publication model:

```text
<root>/publications/<run_id>/...immutable JSON files...
<root>/current -> publications/<run_id>
```

Promotion is atomic through symlink rename.

The DB importer should always take the incoming run from filesystem `current`; parent lookup may read `publications/<base_run_id>`.

## Existing candidate CLI

### `scripts/candidate-workflow.mjs`

Useful reference implementations:

- `readJsonWithBytes()` for retaining exact input bytes.
- `readRuntimeContractBytes()` and contract root resolution.
- `writeExclusiveHandoff()` semantics.
- `readHandoffBundle()` semantics.
- `prepareHandoff()` shows exact `prepareHandoffBundle()` inputs.
- `fullUpdate()` shows existing handoff verification before candidate publication.

Do not broadly refactor this CLI just to share tiny I/O helpers unless implementation genuinely becomes simpler.

## UI

### `src/ui/candidate-data-adapter.js`

Existing keyword candidate adapter expects the current `filterKeywordCandidates.json` item schema. DB UI export must preserve that existing JSON contract, so this file should not require behavior changes.

## CLI host

### `scripts/comment-database.mjs`

Existing conventions to follow:

- strict command allow-list;
- per-command allowed-option allow-list;
- repeated option protection through `setOnce()`;
- `--snapshot-ref` parser already produces `{ payloadSha256, snapshotIndex }`;
- `resolveInvocationPath()` style for file paths;
- `CliArgumentError` → exit code 2;
- other errors → exit code 1.

Add new commands/options into these existing structures rather than introducing a second CLI parser.
