# Mandatory Test Plan

All existing normalized-import tests outside the rich raw path must remain green.

## 1. `tests/raw-snapshot-database.test.js`

### Rewrite existing filesystem preservation test

Current intent: exact bytes are preserved in content-addressed filesystem.

New expectation:

- import valid single snapshot,
- `raw_inputs` contains one row,
- `payload_bytes` is byte-for-byte equal to fixture bytes,
- `payload_sha256` equals `computeRawPayloadSha256(fixtureBytes)`,
- `byte_length` equals fixture byte length,
- `input_format === "tiktokRawSnapshot-1.0.0"`,
- one `raw_snapshots` row with `snapshot_index = 0`,
- no normal raw filesystem write is required.

### Keep pre-write validation cases

Continue rejecting before persistent writes:

- invalid schema,
- invalid UTF-8,
- `loadedCount` mismatch,
- conflicting effective video IDs.

After each failure assert no new `raw_inputs`, snapshot, master, or observation state for the attempted input.

### Keep current effective-ID and observation-value semantics

Current tests covering:

- effective video IDs,
- no trimming,
- null counts,
- repeated comment observations,
- empty comment payloads

must remain semantically unchanged through the new DTO adapter.

### Duplicate tests

Required cases:

1. same exact bytes twice -> `already-imported`, no duplicate raw/snapshot/observations.
2. semantically same JSON with different bytes -> two distinct `raw_inputs`.
3. same exact raw bytes with deliberately changed DTO/materialization -> `RAW_INPUT_MATERIALIZATION_CONFLICT`.
4. corrupt stored `payload_bytes` / hash mismatch -> `DATABASE_INTEGRITY_ERROR`.
5. same SHA row with conflicting format/bytes (constructed directly in test DB if needed) -> `RAW_INPUT_CONFLICT`.

### Multi-snapshot test

Call generic `importRawInput()` directly with one byte payload and two valid snapshot DTOs.

Assert:

- one `raw_inputs` row,
- two `raw_snapshots` rows,
- `snapshot_index` = 0, 1,
- both share the same `payload_sha256`,
- each has one video observation,
- each comment list receives `source_index` from array order,
- transaction rollback removes everything when the second snapshot insert is deliberately made invalid/failing.

### Replace raw-store corruption/write tests

Delete expectations around:

- content-addressed target corruption,
- orphan raw file after DB rollback,
- filesystem verify ignoring orphan files.

Replace with:

- DB BLOB corruption detection,
- raw + normalized rows rollback together,
- `verifyRawInputs()` succeeds on healthy DB and fails on SHA/count/video-observation corruption.

## 2. Migration tests

Add explicit v2 fixtures created using the v2 schema.

### Successful populated backfill

- create v2 DB with one or more `raw_snapshots` + observations,
- create matching legacy raw files at expected content-addressed paths,
- call `backfillRawInputs`,
- assert `user_version = 3`,
- assert exact bytes in `raw_inputs`,
- assert all existing IDs and normalized values preserved,
- assert `snapshot_index = 0`,
- delete legacy raw root,
- assert DB analysis/raw-read operations still work.

### Normal open rejects populated v2

- call normal `openCommentDatabase()` on populated v2 without backfill context,
- expect `RAW_INPUT_BACKFILL_REQUIRED`,
- assert DB remains v2 and unchanged.

### Missing legacy file

Expect `LEGACY_RAW_INPUT_MISSING`; persistent DB remains v2 unchanged.

### Wrong path / SHA mismatch

Expect `LEGACY_RAW_INPUT_MISMATCH`; persistent DB remains v2 unchanged.

### Source changed race

After prepare/staging but before validation, mutate the v2 source set in a controlled test hook; expect `MIGRATION_SOURCE_CHANGED` and rollback.

### Empty v2 auto migration

v2 with zero `raw_snapshots` must open/migrate to v3 without requiring raw root.

## 3. `tests/raw-snapshot-analysis-input.test.js`

### Preserve exact 5 fields

Every output record must still have exactly, in this order:

```text
username
handle
comment
postedAt
postedDate
```

### Manifest v2

Assert:

```text
schema_version = 2
projection_version = 1.0.0
database_schema_version = 3
```

Each snapshot manifest entry includes `payload_sha256`, `snapshot_index`, `input_format` and no `raw_schema_version`.

### Canonical ordering

Create/select snapshots such that ordering differs from argument order.

Expected order:

```text
payload_sha256 ASC
snapshot_index ASC
comment source_index ASC
```

### Snapshot-ref selection

Test:

- known `--snapshot-ref` succeeds,
- unknown ref -> `SNAPSHOT_NOT_FOUND`,
- duplicate refs -> CLI error,
- missing selector -> CLI error.

### Legacy `--snapshot-sha`

Test:

- one child snapshot -> succeeds,
- multiple child snapshots under same SHA -> `SNAPSHOT_SELECTION_AMBIGUOUS`,
- mixing `--snapshot-sha` and `--snapshot-ref` -> CLI error.

### DB-only operation

After import/backfill, remove any legacy/raw filesystem directory and confirm export still succeeds.

### Projection core remains SQLite-independent

Keep the current pure projection test. Update fixture snapshot metadata to include `snapshotIndex` and `inputFormat`; confirm no DB/fs imports are added to processing code.

## 4. Raw read acceptance

Add a test containing at least one rich field not represented in normalized tables (for the existing single-snapshot schema, e.g. author signature/music/hashtags).

After import:

1. `readRawInput()` returns exact original bytes,
2. parse those returned bytes through the format-specific adapter/contract,
3. assert the rich-only field equals the original fixture.

This is the direct proof that DB is the rich raw source of truth rather than the five-field projection.

## 5. Architecture guard

No new import from Database/Processing to a `new-comments.json` parser or collector-specific wrapper module.

The single-snapshot adapter may continue importing the existing TikTok raw snapshot contract outside the generic DB write core.
