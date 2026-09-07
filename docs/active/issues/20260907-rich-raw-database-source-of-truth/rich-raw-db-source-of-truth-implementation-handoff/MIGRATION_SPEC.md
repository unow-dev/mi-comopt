# v2 → v3 Migration and Backfill Specification

## 1. Why a normal SQL-only migration is insufficient

Current v2 `raw_snapshots` stores only:

- `payload_sha256`
- `raw_relpath`
- normalized snapshot metadata

The exact bytes live in the external raw filesystem. Therefore a populated v2 DB cannot become a valid v3 DB without reading and verifying those legacy files.

A v3 row with missing/null `payload_bytes` is **not** an allowed completed state.

## 2. Migration runner change

Current `applyMigrations()` is synchronous and executes only SQL inside `BEGIN ... COMMIT`.

Extend the migration descriptor to allow a pre-SQL prepare hook and an in-transaction validation hook. Equivalent shape:

```js
const migrations = [
  { version: 1, filename: "001-init.sql" },
  { version: 2, filename: "002-raw-snapshots.sql" },
  {
    version: 3,
    filename: "003-rich-raw-inputs.sql",
    beginMode: "IMMEDIATE",
    prepare: prepareRichRawInputMigration,
    validate: validateRichRawInputMigration,
  },
];
```

Make `applyMigrations()` async and have `openCommentDatabase()` await it.

Required execution order per migration:

```text
prepare(db, migrationContext)      // outside persistent transaction; may do filesystem I/O
BEGIN [IMMEDIATE when configured]
validate(db, migrationContext)     // DB is now write-locked for v3
execute migration SQL
assert PRAGMA user_version
COMMIT
```

If `prepare()` throws `CommentDatabaseError`, preserve its code; do not wrap `RAW_INPUT_BACKFILL_REQUIRED` as generic `MIGRATION_FAILED`.

## 3. Normal open behavior

`openCommentDatabase(dbPath)` supplies no backfill context.

When v3 `prepare` runs:

- If v2 `raw_snapshots` has zero rows: create an empty TEMP staging table and continue automatically.
- If v2 `raw_snapshots` has one or more rows: throw `RAW_INPUT_BACKFILL_REQUIRED` **before 003 changes persistent schema**.

This allows new/empty DBs to auto-migrate while preventing silent incomplete migration of populated v2 raw data.

## 4. Dedicated backfill API and CLI

Expose a Database-level operation equivalent to:

```js
backfillRawInputs({ dbPath, rawRoot })
```

CLI:

```text
npm run comment-db -- backfill-raw-inputs --db path.sqlite3 --raw-root legacy/raw/root
```

Both `--db` and `--raw-root` are mandatory for this destructive schema-upgrade operation. Do not infer a default legacy root.

The backfill API should call the same internal open/migration path as normal DB opening, but pass an explicit migration context. Do not implement a second copy of migration SQL or a separate schema definition.

## 5. Prepare phase

For every v2 `raw_snapshots` row, read at least:

```text
payload_sha256
raw_relpath
imported_at
```

Validate:

1. `raw_relpath === rawSnapshotRelativePath(payload_sha256)`.
2. `rawRoot/raw_relpath` exists and is readable.
3. `computeRawPayloadSha256(exactBytes) === payload_sha256`.

Only after all legacy files pass validation, populate a connection-local TEMP table such as:

```sql
CREATE TEMP TABLE legacy_raw_input_backfill (
    payload_sha256 TEXT PRIMARY KEY,
    raw_relpath TEXT NOT NULL,
    payload_bytes BLOB NOT NULL,
    byte_length INTEGER NOT NULL
) STRICT;
```

No persistent DB rows/schema are changed during this phase.

Do not parse the legacy raw JSON or regenerate observations as part of backfill. v2's already-materialized rows are migrated as-is.

## 6. Race protection

Filesystem validation may take time, so do not hold a SQLite write lock while reading all files.

Immediately after `BEGIN IMMEDIATE`, `validateRichRawInputMigration()` must compare current v2 source rows with the TEMP staging set.

At minimum verify:

- row count equal,
- `payload_sha256` set equal,
- `raw_relpath` equal for every SHA.

If source rows changed since prepare, throw:

```text
MIGRATION_SOURCE_CHANGED
```

and roll back.

## 7. 003 migration SQL sequence

The SQL must not access filesystem paths. It consumes only v2 DB tables plus `temp.legacy_raw_input_backfill`.

Use a create/copy/drop/rename rebuild, not “rename old table first.”

Required sequence:

```text
1. CREATE raw_inputs.

2. INSERT raw_inputs from old raw_snapshots JOIN temp.legacy_raw_input_backfill:
     payload_sha256 = old.payload_sha256
     payload_bytes  = staged.payload_bytes
     byte_length    = staged.byte_length
     input_format   = 'tiktokRawSnapshot-1.0.0'
     imported_at    = old.imported_at

3. CREATE raw_snapshots_v3 with final schema.

4. CREATE snapshot_video_observations_v3 and
   snapshot_comment_observations_v3 with FKs to raw_snapshots_v3.

5. COPY old raw_snapshots to raw_snapshots_v3:
     preserve snapshot_id and all retained metadata
     payload_sha256 = old.payload_sha256
     snapshot_index = 0

6. COPY old snapshot_video_observations preserving values and IDs.

7. COPY old snapshot_comment_observations preserving observation_id,
   source_index, values, and master links.

8. DROP old snapshot_comment_observations.
9. DROP old snapshot_video_observations.
10. DROP old raw_snapshots.

11. ALTER TABLE raw_snapshots_v3 RENAME TO raw_snapshots.
12. ALTER TABLE snapshot_video_observations_v3 RENAME TO snapshot_video_observations.
13. ALTER TABLE snapshot_comment_observations_v3 RENAME TO snapshot_comment_observations.

14. Recreate idx_snapshot_comment_observations_comment.
15. PRAGMA user_version = 3.
```

Preserve:

- `snapshot_id`
- `observation_id`
- `video_pk`
- `author_pk`
- `comment_pk`
- all existing normalized values

Do not rebuild masters or reparse raw data.

## 8. Failure semantics

The following are hard failures and must leave the persistent DB at its pre-v3 version/state:

```text
RAW_INPUT_BACKFILL_REQUIRED
LEGACY_RAW_INPUT_MISSING
LEGACY_RAW_INPUT_MISMATCH
MIGRATION_SOURCE_CHANGED
MIGRATION_FAILED
```

Suggested meaning:

- `LEGACY_RAW_INPUT_MISSING`: configured legacy file cannot be read / does not exist.
- `LEGACY_RAW_INPUT_MISMATCH`: path or SHA validation fails.
- `MIGRATION_SOURCE_CHANGED`: DB source rows changed between prepare and transaction validation.

No partial v3 backfill is an accepted completion state.

## 9. Re-run behavior

- v3 DB: `backfillRawInputs()` returns an explicit no-op/already-migrated result.
- empty v2 DB: normal open may migrate without backfill files.
- populated v2 DB: normal open always fails closed until backfill is supplied.
