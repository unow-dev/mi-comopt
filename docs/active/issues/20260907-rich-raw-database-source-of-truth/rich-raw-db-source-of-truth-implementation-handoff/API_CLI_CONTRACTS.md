# API and CLI Contracts

## 1. Database API changes

### Add: `importRawInput()`

Collector-independent DB write boundary described in `IMPLEMENTATION_SPEC.md`.

Suggested result:

```js
{
  status: "imported" | "already-imported",
  payloadSha256,
  snapshotCount,
  commentObservationCount
}
```

Do not accept `payloadSha256` or snapshot ordinals from callers as authoritative values.

### Keep as adapters: `importRawSnapshotBytes()` / `importRawSnapshotFile()`

They must:

1. read/preserve exact bytes,
2. use existing raw snapshot parser/validator,
3. map to one collector-independent DTO,
4. call `importRawInput()` with `inputFormat: "tiktokRawSnapshot-1.0.0"`.

They must no longer accept/use `rawRoot` for normal import.

### Add: `backfillRawInputs()`

```js
backfillRawInputs({ dbPath, rawRoot })
```

Uses the v3 migration context described in `MIGRATION_SPEC.md`.

### Keep unchanged

```text
importNormalizedPayload()
importNormalizedPayloadFile()
normalized payload validation/hash behavior
```

## 2. Repository APIs

### Add: `readRawInput(db, payloadSha256)`

Returns exact BLOB + metadata. No JSON parsing.

### Change snapshot selection

Canonical snapshot selector value:

```js
{ payloadSha256, snapshotIndex }
```

Repository selection must query/order by:

```sql
ORDER BY payload_sha256 ASC, snapshot_index ASC
```

The returned plain snapshot should expose at least:

```js
{
  snapshotId,
  platform,
  payloadSha256,
  snapshotIndex,
  inputFormat,
  extractedAt,
  sourcePageUrl,
  sourceCanonicalUrl,
  itemSource,
  loadedCount,
  reportedCount,
  coverageNote,
  importedAt
}
```

`inputFormat` and `importedAt` come from JOIN with `raw_inputs`.

Remove `rawRelpath` and `rawSchemaVersion` from the normal repository model.

### Replace: `verifyRawStore()` → `verifyRawInputs()`

No filesystem parameters. See `IMPLEMENTATION_SPEC.md` for required checks.

## 3. CLI commands

### `import`

No change.

```text
npm run comment-db -- import --input normalized.json [--db path.sqlite3]
```

### `import-raw-snapshot`

New usage:

```text
npm run comment-db -- import-raw-snapshot --input rich-raw-snapshot.json [--db path.sqlite3]
```

Remove `--raw-root`.

### `backfill-raw-inputs`

Add:

```text
npm run comment-db -- backfill-raw-inputs --db path.sqlite3 --raw-root legacy/raw/root
```

Both options mandatory.

### `export-analysis-input`

Canonical selector:

```text
--snapshot-ref <64-lowercase-hex-sha>:<non-negative-integer-snapshot-index>
```

Example:

```text
npm run comment-db -- export-analysis-input \
  --snapshot-ref abcdef...0123:0 \
  --output analysis.json \
  --manifest analysis.manifest.json \
  [--db path.sqlite3]
```

Allow repeated `--snapshot-ref`; reject exact duplicate refs.

#### Deprecated compatibility alias: `--snapshot-sha`

Keep only as a legacy one-snapshot selector.

Rules:

- Do not allow `--snapshot-ref` and `--snapshot-sha` in the same invocation.
- A supplied SHA resolves only if the DB has exactly one snapshot for that raw input.
- zero rows -> `SNAPSHOT_NOT_FOUND`.
- more than one row -> `SNAPSHOT_SELECTION_AMBIGUOUS`.
- direct duplicate SHA arguments remain CLI errors.

### `verify-raw-inputs`

Replace `verify-raw-store` with:

```text
npm run comment-db -- verify-raw-inputs [--snapshot-ref ...] [--db path.sqlite3]
```

No selector means verify all rich raw inputs/snapshots.

If keeping the legacy `--snapshot-sha` alias for this command, use the same exact-one-snapshot resolution rule as export. Do not retain `verify-raw-store` as a misleading alias.

## 4. CLI parsing rules

`--snapshot-ref` parser must require:

```text
^[0-9a-f]{64}:[0-9]+$
```

and convert the suffix to a safe non-negative integer.

CLI argument mistakes remain exit code 2 / `CLI_ERROR` consistent with current behavior.

Operational/database errors remain exit code 1.

## 5. Error codes

Keep current generic DB errors where appropriate and introduce these domain errors:

```text
RAW_INPUT_BACKFILL_REQUIRED
LEGACY_RAW_INPUT_MISSING
LEGACY_RAW_INPUT_MISMATCH
MIGRATION_SOURCE_CHANGED
RAW_INPUT_CONFLICT
RAW_INPUT_MATERIALIZATION_CONFLICT
SNAPSHOT_SELECTION_AMBIGUOUS
```

Continue using `DATABASE_INTEGRITY_ERROR` for corruption/invariant violations inside the DB.

Retire normal-operation raw-store errors such as `RAW_STORE_WRITE_FAILED`; legacy backfill failures use the legacy migration errors above.
