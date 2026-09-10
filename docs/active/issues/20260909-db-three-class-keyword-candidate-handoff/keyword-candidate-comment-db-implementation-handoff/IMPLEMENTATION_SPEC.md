# Implementation Specification

## 1. Core flow

```text
Comment DB
  raw snapshot + observation-level three-class labels
        |
        | generate-keyword-candidate-handoff
        v
candidate-handoff directory
        |
        | ChatGPT returns candidate_proposal.json
        v
existing candidate-workflow full-update
        |
        v
immutable filesystem publication + atomic current
        |
        | apply-keyword-candidate-publication
        v
Comment DB keyword_candidate_publications
        |
        | export-keyword-candidates-ui
        v
src/data/filterKeywordCandidates.json
        |
        v
existing UI
```

The three commands are intentionally independent. Handoff generation is read-only against DB. DB apply does not generate UI output. UI export does not need the handoff or filesystem publication.

---

## 2. Source of truth and lineage

### Adopted

- Filesystem immutable candidate publication is the source of truth for candidate semantics and candidate lineage.
- Comment DB is a verified mirror of selected applied publications.
- `run_id` is the DB publication identity.
- `base_run_id` is stored as provenance only; do **not** make it a foreign key and do **not** require it to equal DB-current `run_id`.

### Why

DB apply may be skipped operationally. Example:

```text
filesystem: A -> B -> C
DB:         A ------> C
```

C must remain importable if filesystem C is valid and its parent B can be verified from filesystem publication history. Requiring `C.base_run_id == DB current.run_id` would incorrectly make DB a stronger lineage authority than the existing publication system.

---

## 3. Migration 007

Add:

`db/comment-database/007-keyword-candidate-publications.sql`

Use this schema:

```sql
CREATE TABLE keyword_candidate_publications (
    run_id TEXT PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,

    request_id TEXT NOT NULL,
    input_fingerprint TEXT NOT NULL,
    source_dataset_artifact_sha256 TEXT NOT NULL,
    base_run_id TEXT NOT NULL,

    published_at TEXT NOT NULL,
    applied_at TEXT NOT NULL,

    is_current INTEGER NOT NULL
        CHECK (is_current IN (0, 1)),

    handoff_manifest_json TEXT NOT NULL,
    candidate_generation_request_json TEXT NOT NULL,
    candidate_proposal_json TEXT NOT NULL,
    run_manifest_json TEXT NOT NULL,
    current_meta_json TEXT NOT NULL,
    filter_keyword_candidates_json TEXT NOT NULL,

    FOREIGN KEY (snapshot_id)
        REFERENCES raw_snapshots(snapshot_id)
) STRICT;

CREATE UNIQUE INDEX idx_keyword_candidate_publications_current
    ON keyword_candidate_publications(is_current)
    WHERE is_current = 1;

CREATE INDEX idx_keyword_candidate_publications_snapshot
    ON keyword_candidate_publications(snapshot_id);

PRAGMA user_version = 7;
```

Do not add uniqueness constraints to `request_id` or `input_fingerprint`. Do not add a foreign key from `base_run_id` to this table.

### Version changes

- `src/database/comment-database.js`: `APPLICATION_SCHEMA_VERSION = 7` and add migration 007 to `migrations`.
- `src/processing/analysis-input/raw-snapshot-projection.js`: `DATABASE_SCHEMA_VERSION = 7`.

No change to `ANALYSIS_PROJECTION_VERSION` is required because the existing 5-field analysis projection itself is not being changed.

---

## 4. New/extended repository functions

### 4.1 Three-class label reader

Extend `src/database/three-class-label-repository.js` with a snapshot-oriented read API. Suggested contract:

```js
export function readSnapshotThreeClassLabels(db, snapshotId)
```

Return:

```js
[
  { sourceIndex: 0, label: "direct_nuisance" },
  { sourceIndex: 1, label: "reactive" },
  // ...
]
```

SQL should join `snapshot_comment_observations` to `snapshot_comment_three_class_labels`, filter by `snapshot_id`, and order by `source_index ASC`.

Do not require or return `workset_id` for this flow.

### 4.2 Keyword-candidate publication repository

Add:

`src/database/keyword-candidate-publication-repository.js`

Keep it SQL/persistence-only. Transaction ownership and workflow decisions belong to the adapter.

Suggested APIs:

```js
readCurrentKeywordCandidatePublication(db)
readKeywordCandidatePublication(db, runId)
insertKeywordCandidatePublication(db, record)
clearCurrentKeywordCandidatePublication(db)
```

Exact internal function names may vary, but repository behavior must remain persistence-only.

---

## 5. Deterministic DB candidate source dataset

For exactly one selected snapshot, construct this object in this insertion/key order:

```json
{
  "schema_version": 1,
  "labeling_status": "published",
  "snapshot_ref": {
    "payload_sha256": "<64 lowercase hex>",
    "snapshot_index": 0
  },
  "records": [
    {
      "source_index": 0,
      "username": "...",
      "handle": "...",
      "comment": "...",
      "postedAt": "...",
      "postedDate": "...",
      "label": "direct_nuisance"
    }
  ]
}
```

Rules:

- records are ordered by `source_index ASC`;
- data values come from `readSelectedSnapshots()` observation data plus `readSnapshotThreeClassLabels()`;
- no `observation_id` in the artifact;
- no synthetic `record_id`;
- no `workset_id`;
- labels must be one of `direct_nuisance`, `reactive`, `normal`;
- serialize using existing `prettyJson()` from `candidate-workflow.js`;
- use the exact serialized UTF-8 bytes as `source_dataset.json` bytes.

### Completeness invariant

For the selected snapshot require all of the following:

```text
selectedSnapshots.length == 1
snapshot.observations.length == snapshot.snapshot.loadedCount
labelRows.length == snapshot.snapshot.loadedCount
```

and, for each position `i`:

```text
observation.sourceIndex == i
labelRow.sourceIndex == i
```

Any missing/misaligned label fails before handoff generation with:

`THREE_CLASS_LABELS_INCOMPLETE`

The existing `readSelectedSnapshots()` integrity checks remain authoritative for raw observation integrity.

---

## 6. Source artifact identity

Compute:

```text
source_dataset_artifact_sha256 =
  "sha256:" + SHA256(source_dataset.json exact bytes)
```

Pass this as `explicitSourceSha` to existing `prepareHandoffBundle()`.

Canonical source ref for this flow:

```text
<payload_sha256>:<snapshot_index>
```

Pass it as `explicitSourceRef`. Treat it as informational/provenance. DB apply must locate the snapshot from `source_dataset.json.snapshot_ref`, not by parsing the request’s `artifact_ref`.

DB apply may additionally require the request `artifact_ref` to equal the canonical value regenerated from the selected snapshot, but it must not use that string as the lookup mechanism.

---

## 7. Command 1: generate keyword-candidate handoff

Add to `scripts/comment-database.mjs`:

```bash
npm run comment-db -- generate-keyword-candidate-handoff \
  --snapshot-ref <sha:index> \
  --publication-root <dir> \
  --output <path.zip> \
  [--db <sqlite>]
```

### CLI rules

- exactly one `--snapshot-ref` is required;
- `--snapshot-sha` is not supported for this command;
- `--publication-root` required;
- `--output` required;
- output ZIP file must not already exist;
- use existing comment-db path resolution behavior.

### Inputs reused from repository

Candidate policy:

`contracts/keyword-candidates/evaluation-policy-1.0.0.json`

Taxonomy:

`contracts/keyword-candidates/taxonomy-1.0.0.json`

Runtime handoff contract files:

`contracts/candidate-handoff/v1/`

- `prompt.txt`
- `PROMPT_CONTRACT_v1.md`
- `candidate-proposal.schema.json`
- `common.schema.json`

Do not add `--policy`, `--taxonomy`, or runtime-contract path options to this DB command.

### Algorithm

1. Open DB.
2. Resolve/read exactly the requested snapshot using existing raw snapshot repository behavior.
3. Read snapshot three-class labels by `snapshot_id`.
4. Enforce completeness/source-index invariants.
5. Build deterministic source dataset object and exact bytes.
6. Compute exact byte SHA.
7. Resolve filesystem current publication using existing keyword publication adapter.
8. Read current publication artifacts needed by `prepareHandoffBundle()`:
   - `candidate_registry.json`
   - `candidate_evaluation.json`
   - `filterKeywordCandidates.json`
   - `filterKeywordCandidates.meta.json`
   - `run_manifest.json`
9. Read policy/taxonomy with exact bytes.
10. Read runtime contract bytes.
11. Call existing `prepareHandoffBundle()` with:
    - current publication artifacts;
    - DB source dataset `{ value, bytes }`;
    - policy/taxonomy `{ value, bytes }`;
    - `explicitSourceSha` from exact dataset bytes;
    - canonical `explicitSourceRef`;
    - runtime contract bytes.
12. Write returned handoff files to a private temporary directory, then package exactly those files and `handoff_manifest.json` into a newly-created exclusive ZIP output. The ZIP must contain only regular, flat members, preserve the handoff file bytes, and never overwrite an existing output file. Remove the temporary directory after packaging.
13. Do not write any DB keyword-candidate publication row in this command.

This command intentionally does not use `labelingEvidence`: the DB’s immutable applied three-class labels + exact dataset regeneration are the provenance boundary for this issue.

---

## 8. Command 2: apply validated filesystem publication to DB

Add:

```bash
npm run comment-db -- apply-keyword-candidate-publication \
  --handoff-manifest <extracted-handoff-dir>/handoff_manifest.json \
  --publication-root <dir> \
  [--db <sqlite>]
```

The incoming candidate publication is always `<publication-root>/current`; do not accept an arbitrary publication directory argument.

### Important state rule

This command imports **only an already-published existing candidate `full-update` result**. It does not apply `candidate_proposal.json` itself and does not reproduce candidate state transitions in DB.

### Validation sequence

Perform the following before DB mutation:

1. Read `handoff_manifest.json` and all `HANDOFF_FILES` from its directory.
2. Parse `candidate_generation_request.json` from the handoff.
3. Call existing `verifyHandoffBundle()` to verify:
   - manifest structure;
   - request ID/fingerprint binding;
   - complete expected file set;
   - byte SHA of every handoff file.
4. Parse `source_dataset.json` and validate this DB-source shape at minimum:
   - schema version 1;
   - labeling status `published`;
   - one valid `snapshot_ref`;
   - records array.
5. Use `snapshot_ref` to read that exact DB snapshot and its labels.
6. Regenerate the deterministic DB source dataset.
7. Require regenerated source dataset bytes to equal handoff `source_dataset.json` bytes byte-for-byte.
8. Require exact byte SHA to equal `request.source_dataset.artifact_sha256`.
9. Require request source `artifact_ref` to equal canonical `<sha>:<index>` generated from the dataset snapshot reference.
10. Parse handoff `evaluation_policy.json`, `taxonomy.json`, `candidate_view.json`, and `pre_evaluation.json`.
11. Rebuild `candidate_generation_request` with existing `makeGenerationRequest()` using:
    - handoff request ID;
    - handoff base publication fields;
    - regenerated source SHA/ref;
    - handoff candidate view/pre-evaluation;
    - policy/taxonomy version + `contentSha256()` derived from handoff files.
12. Require the rebuilt request to be semantically identical to handoff `candidate_generation_request.json` (using `contentSha256()` equality is sufficient).
13. Resolve `<publication-root>/current` and read all current `full-update` artifacts required for validation:
    - `candidate_registry.json`
    - `filterKeywordCandidates.json`
    - `filterKeywordCandidates.meta.json`
    - `run_manifest.json`
    - `candidate_evaluation.json`
    - `candidate_view.json`
    - `pre_evaluation.json`
    - `candidate_generation_request.json`
    - `candidate_proposal.json`
    - `candidate_change_set.json`
14. Require current publication request/candidate view/pre-evaluation to match the handoff artifacts semantically.
15. Require current `run_manifest.run_type == "full_update"`.
16. Verify the current run’s parent against filesystem history:
    - derive `base_run_id` from request;
    - read `<publication-root>/publications/<base_run_id>/run_manifest.json`;
    - call existing `validateParentManifest({ parentManifest, request })`;
    - require current `run_manifest.parent_manifest_content_sha256 == contentSha256(parentManifest)`.
17. Read parent `candidate_registry.json` and use it for proposal validation:
    - `validateProposal(currentProposal, { request, registry: parentRegistry, taxonomy })`.
18. Call existing `validateGeneratedArtifacts()` for the current publication using current registry/evaluation/published candidates/current meta/run manifest and handoff taxonomy.
19. Verify run-manifest artifact refs/content hashes for at least:
    - candidate view;
    - pre-evaluation;
    - candidate generation request;
    - candidate proposal;
    - candidate change set;
    - candidate evaluation.
    Each `artifact_ref` must name the corresponding file and each `content_sha256` must equal existing `contentSha256(parsedFile)`.
20. Verify cross-bindings:
    - current meta `run_id` == run manifest `run_id`;
    - current meta run-manifest hash == `contentSha256(run_manifest)`;
    - current meta candidate hash == `contentSha256(filterKeywordCandidates)`;
    - request source dataset descriptor == run manifest source dataset descriptor;
    - evaluation dataset SHA == request source dataset SHA;
    - current meta dataset SHA == request source dataset SHA;
    - policy version/hash agree across handoff policy, request, run manifest, evaluation/current meta wherever fields exist;
    - taxonomy version/hash agree across handoff taxonomy, request, run manifest/current meta wherever fields exist.
21. Only after all validation passes, begin an immediate DB transaction.

### DB transaction and idempotency

Use `BEGIN IMMEDIATE`.

Let `incomingRunId = currentMeta.run_id`.

#### Case A: incoming `run_id` does not exist in DB

- set any existing DB-current row `is_current = 0`;
- insert incoming row with `is_current = 1`;
- commit.

Do not require `base_run_id` to equal previous DB-current run. DB history gaps are valid.

#### Case B: incoming `run_id` already exists and is DB-current

Compare immutable stored content, excluding `applied_at`.

If identical:

- no mutation;
- success status `already-applied`.

If different:

- fail `KEYWORD_CANDIDATE_RUN_CONFLICT`.

#### Case C: incoming `run_id` already exists but is not DB-current

Fail `KEYWORD_CANDIDATE_RUN_CONFLICT`.

This command does not re-promote historical DB rows.

#### DB integrity

If the table contains rows but more than one current is observable, the partial unique index should prevent that. If rows exist and no current exists before a new insert, the command may still repair by inserting the verified filesystem current as current after clearing zero rows; however repository/tests should treat absence of current with existing rows as `DATABASE_INTEGRITY_ERROR` if detected. Prefer fail-fast over silently normalizing unexplained corruption.

### Stored JSON bytes

For the following fields, store the exact UTF-8 text read from verified input/publication files, not a reserialized equivalent:

- `handoff_manifest_json`
- `candidate_generation_request_json`
- `candidate_proposal_json`
- `run_manifest_json`
- `current_meta_json` (from `filterKeywordCandidates.meta.json`)
- `filter_keyword_candidates_json`

This lets UI export preserve the exact applied candidate artifact bytes.

Column values:

- `run_id`: current meta/run manifest run ID.
- `snapshot_id`: DB snapshot resolved from handoff source dataset.
- `request_id`: request request ID.
- `input_fingerprint`: request input fingerprint.
- `source_dataset_artifact_sha256`: verified request source SHA.
- `base_run_id`: request base publication run ID.
- `published_at`: current meta published timestamp.
- `applied_at`: application time generated by the adapter, UTC timestamp in repository style.

---

## 9. Command 3: export DB-current candidates to UI JSON

Add:

```bash
npm run comment-db -- export-keyword-candidates-ui \
  --output <path> \
  [--db <sqlite>]
```

Normal target:

```text
src/data/filterKeywordCandidates.json
```

### Algorithm

1. Open DB and read exactly one `is_current = 1` keyword-candidate publication.
2. If none: fail `KEYWORD_CANDIDATE_PUBLICATION_NOT_FOUND`.
3. Parse stored `filter_keyword_candidates_json` and `current_meta_json`.
4. Require:

```text
contentSha256(parsedCandidates) == currentMeta.candidates_content_sha256
```

5. Write the **stored candidate JSON text itself** to a temporary file in the output file’s same directory.
6. Atomically rename the temporary file over the requested output path.
7. Clean up temporary file on failure.

Existing output files are intentionally overwritten atomically. This differs from `export-analysis-input`, whose immutable export semantics are not appropriate for a UI update command.

No UI adapter/component changes should be necessary.

---

## 10. Error contract

Use existing error codes wherever an existing workflow function already provides them. Do not create DB-prefixed aliases for existing handoff/candidate errors.

Add only these issue-specific codes as needed:

```text
THREE_CLASS_LABELS_INCOMPLETE
KEYWORD_CANDIDATE_SOURCE_MISMATCH
KEYWORD_CANDIDATE_PUBLICATION_MISMATCH
KEYWORD_CANDIDATE_RUN_CONFLICT
KEYWORD_CANDIDATE_PUBLICATION_NOT_FOUND
```

Reuse/preserve existing codes such as:

```text
HANDOFF_MANIFEST_MISMATCH
HANDOFF_INPUT_MISMATCH
REQUEST_ARTIFACT_MISMATCH
PARENT_MANIFEST_MISMATCH
STALE_PARENT              # only when raised by existing candidate workflow where applicable
DATABASE_INTEGRITY_ERROR
```

DB-specific failures may use `CommentDatabaseError`; existing candidate/handoff coded errors can be rethrown preserving `.code` and message. The top-level CLI already maps non-CLI errors to exit code 1.

CLI argument errors remain exit code 2 through existing `CliArgumentError` behavior.

---

## 11. CLI wiring changes

Extend `scripts/comment-database.mjs`:

Supported commands:

```text
generate-keyword-candidate-handoff
apply-keyword-candidate-publication
export-keyword-candidates-ui
```

New options to parse:

```text
--publication-root
--handoff-manifest
```

`--output` and `--db` already exist.

For `generate-keyword-candidate-handoff`, enforce exactly one `--snapshot-ref` and reject `--snapshot-sha`.

Update `usageFor()` and general usage text for all three commands.

---

## 12. Suggested adapter module

Add:

`scripts/adapters/keyword-candidate-comment-db.js`

Keep cross-domain orchestration here rather than expanding repositories with workflow logic.

Suggested exported operations:

```js
generateKeywordCandidateHandoff({...})
applyKeywordCandidatePublication({...})
exportKeywordCandidatesUi({...})
```

Suggested private helpers:

```text
buildDbKeywordCandidateDataset
serializeDbKeywordCandidateDataset
readHandoffBundle
readCurrentCandidatePublicationFiles
readParentCandidatePublicationFiles
verifyCandidateRequestBinding
verifyPublicationArtifactBindings
withImmediateTransaction
writeExclusiveHandoffDirectory
atomicReplaceTextFile
```

Names are not contractual; responsibilities are.

---

## 13. Existing code to reuse, not duplicate

Reuse:

- `readSelectedSnapshots()` for snapshot/raw-observation integrity.
- `prettyJson()` for deterministic readable JSON bytes.
- `contentSha256()` for semantic artifact content hashes.
- `prepareHandoffBundle()` for candidate handoff generation.
- `HANDOFF_FILES` and `verifyHandoffBundle()` for handoff integrity.
- `makeGenerationRequest()` for request fingerprint re-derivation.
- `validateProposal()` for proposal/request/base-registry consistency.
- `validateParentManifest()` for filesystem parent/request binding.
- `validateGeneratedArtifacts()` for current publication reconstruction checks.
- `resolveCurrentPublicationDir()` for filesystem current publication resolution.

Do not implement parallel versions of these rules in Comment DB code.

---

## 14. Files expected to change

Required/new:

```text
db/comment-database/
  007-keyword-candidate-publications.sql                   NEW

src/database/
  comment-database.js                                      MODIFY
  three-class-label-repository.js                          MODIFY
  keyword-candidate-publication-repository.js              NEW

src/processing/analysis-input/
  raw-snapshot-projection.js                               MODIFY

scripts/adapters/
  keyword-candidate-comment-db.js                          NEW

scripts/
  comment-database.mjs                                     MODIFY

tests/
  comment-database.test.js                                 MODIFY
  keyword-candidate-comment-db.test.js                     NEW
```

Expected unchanged unless a small extraction is genuinely required:

```text
src/processing/keyword-candidates/candidate-workflow.js
src/processing/keyword-candidates/handoff-workflow.js
src/processing/keyword-candidates/update-flow.js
src/processing/keyword-candidates/artifact-validation.js
src/ui/candidate-data-adapter.js
src/ui/candidate-data.js
```

Avoid refactoring the existing candidate CLI solely to share tiny file-I/O helpers. Small equivalent I/O helpers in the new adapter are preferable to broad unrelated changes.

---

## 15. Implementation order

1. Add migration 007 and bump schema-version constants.
2. Add keyword-candidate publication repository and migration tests.
3. Add snapshot-label reader and completeness tests.
4. Implement deterministic DB candidate dataset builder.
5. Implement `generate-keyword-candidate-handoff` adapter + CLI.
6. Implement filesystem publication verification + DB apply adapter/CLI.
7. Implement DB-current UI export + atomic replace.
8. Add all acceptance tests.
9. Run the full existing test suite, not only new tests.

---

## 16. Definition of done

The issue is complete only when all three commands exist and the acceptance suite proves:

- one exact snapshot and its persisted labels deterministically reproduce the handoff dataset;
- handoff/request/publication/snapshot provenance mismatches are rejected before DB mutation;
- existing full-update remains the only candidate state-transition/evaluation authority;
- a verified filesystem publication can be mirrored even if an intermediate filesystem run was never mirrored to DB;
- repeated identical DB apply is idempotent;
- conflicting reuse of a run ID is rejected;
- DB-current alone can regenerate the existing UI candidate JSON contract atomically;
- the existing UI requires no candidate schema change;
- all existing repository tests still pass.
