# Source Map and Expected Diff

All paths below are relative to `sources/package/` in the supplied discussion set / repository package root.

## Current facts

### `db/comment-database/002-raw-snapshots.sql`

Current v2 schema:

- `raw_snapshots.payload_sha256` is UNIQUE.
- `raw_snapshots.raw_relpath` is UNIQUE.
- `raw_snapshots.raw_schema_version = 1`.
- `raw_snapshots.imported_at` is per snapshot.
- comment observation order is already `snapshot_comment_observations.source_index`.

### `src/database/comment-database.js`

Current behavior:

- `APPLICATION_SCHEMA_VERSION = 2`.
- migrations are SQL-only and synchronous.
- `importRawSnapshotBytes()` directly calls `parseAndValidateRawSnapshotBytes()`.
- it calls `ensureRawSnapshotStored()` **before** the DB transaction.
- generic master creation hard-codes platform `"tiktok"`.
- duplicate raw snapshot integrity currently checks relpath, loaded/comment count, and one video observation only.
- normalized-only import path is separate and should remain separate.

### `src/raw-snapshot/raw-snapshot-contract.js`

Current responsibilities mix:

- schema validation,
- exact-byte SHA,
- effective video ID,
- content-addressed filesystem path,
- filesystem publication/corruption handling.

Keep validation/SHA/effective-ID logic. Retain path calculation only for legacy migration validation. Remove normal filesystem publication behavior from the rich import path.

### `src/database/raw-snapshot-repository.js`

Current behavior:

- selects snapshots by SHA only,
- includes `raw_schema_version`, `raw_relpath`, `imported_at` directly from `raw_snapshots`,
- verifies external filesystem files.

It must become DB-only, select by `(payloadSha256, snapshotIndex)`, JOIN raw input metadata, and expose raw BLOB reads.

### `src/processing/analysis-input/raw-snapshot-projection.js`

Current constants:

```text
ANALYSIS_PROJECTION_VERSION = 1.0.0
ANALYSIS_MANIFEST_SCHEMA_VERSION = 1
DATABASE_SCHEMA_VERSION = 2
```

Current snapshot ordering is SHA only. Update manifest/database versions and add snapshot-index ordering. Keep the five output fields unchanged.

### `scripts/comment-database.mjs`

Current commands:

```text
import
import-raw-snapshot --raw-root ...
export-analysis-input --snapshot-sha ...
verify-raw-store --raw-root ...
```

Implement the CLI changes in `API_CLI_CONTRACTS.md`.

### Tests

`tests/raw-snapshot-database.test.js` currently explicitly tests filesystem exact-byte publication, filesystem corruption, orphan raw publication after DB rollback, and filesystem verification. Those expectations must be deliberately replaced, not merely deleted.

`tests/raw-snapshot-analysis-input.test.js` already proves DB-only five-field export after deleting raw filesystem. Preserve this regression while moving provenance to multi-snapshot identity.

## Expected file-level diff

### Add

```text
db/comment-database/003-rich-raw-inputs.sql
```

### Modify

```text
src/database/comment-database.js
src/raw-snapshot/raw-snapshot-contract.js
src/database/raw-snapshot-repository.js
src/processing/analysis-input/raw-snapshot-projection.js
scripts/comment-database.mjs
tests/raw-snapshot-database.test.js
tests/raw-snapshot-analysis-input.test.js
```

### Normally unchanged

```text
contracts/raw-snapshots/tiktokRawSnapshot-1.0.0.schema.json
ARCHITECTURE.md
normalized-only schema/import behavior
```

If `ARCHITECTURE.md` must be changed to make the implementation work, stop and reassess: the intended design fits the current responsibility boundary without such a change.
