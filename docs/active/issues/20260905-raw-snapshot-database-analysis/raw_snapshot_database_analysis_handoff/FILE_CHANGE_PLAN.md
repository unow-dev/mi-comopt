# File change plan

## PR1 — write boundary

### modify

- `.gitignore`
  - add `/var/raw-snapshots/`
- `package/package.json`
  - add runtime `ajv` and `ajv-formats`
- root `package-lock.json`
  - npm-generated update
- `package/src/database/comment-database.js`
  - `APPLICATION_SCHEMA_VERSION = 2`
  - add migration descriptor for `002-raw-snapshots.sql`
  - keep all v1 validation/hash/import behavior unchanged
  - expose/reuse shared DB open/error facilities as needed
- `package/scripts/comment-database.mjs`
  - subcommand parser supporting old and new commands
  - preserve old `import` usage
- `package/tests/comment-database.test.js`
  - update structural table/index expectations for v2
  - newer schema test uses `APPLICATION_SCHEMA_VERSION + 1`
  - assert `002-raw-snapshots.sql` exists
- `package/docs/comment-database.md`
  - document v2 raw store, privacy boundary, new CLI, no DB direct dependency in processing

### add

- `package/contracts/raw-snapshots/tiktokRawSnapshot-1.0.0.schema.json`
- `package/db/comment-database/002-raw-snapshots.sql`
- `package/src/raw-snapshot/raw-snapshot-contract.js`
- `package/src/database/raw-snapshot-repository.js`
- `package/tests/raw-snapshot-database.test.js`

### do not refactor in PR1

- moving existing v1 functions to new modules
- candidate workflow/UI modules
- legacy dataset integration

## PR2 — read boundary

### modify

- `package/src/database/raw-snapshot-repository.js`
  - query selected snapshots and plain observations
- `package/scripts/comment-database.mjs`
  - `export-analysis-input`
- docs/operations/issues as necessary to point incoming-data source to DB export

### add

Preferred module:

- `package/src/processing/analysis-input/raw-snapshot-projection.js`
  - pure function, no SQLite imports
- `package/tests/raw-snapshot-analysis-input.test.js`

### unchanged

- Stage13 pipeline implementation
- keyword candidate workflow
- account candidate workflow
- UI candidate adapter

## Dependency versions

Use runtime dependencies compatible with JSON Schema draft 2020-12:

```text
ajv 8.x
ajv-formats 3.x
```

Install through the workspace package and commit the root lockfile. The exact lockfile-resolved patch version is not a domain decision; do not change validator major versions within this work.
