# Frozen Implementation Specification

## 1. Scope

This change applies to the **rich raw snapshot ingestion path** represented today by `importRawSnapshotBytes()` / `import-raw-snapshot` and the `raw_snapshots` family of tables.

The normalized-only `import` path (`imports` / `comment_observations`) is a separate contract and must remain unchanged.

## 2. Source-of-truth rule

For a rich raw import, the authoritative rich representation is the **exact input byte sequence** stored inside SQLite.

Rules:

- Store bytes before any parse/serialize transformation as a SQLite BLOB.
- `payload_sha256` is SHA-256 of those exact bytes.
- JSON values that are semantically equal but byte-different are different raw inputs.
- Normalized snapshot and observation rows are materialized/derived data, not the rich source of truth.
- Normal downstream analysis must continue to read normalized DB rows; it must not reparse the BLOB on every export.
- DB raw bytes are immutable through normal APIs. Correcting an adapter/materialization bug is an explicit migration/reprojection operation, not a normal re-import overwrite.

## 3. Final database schema version

Set:

```js
APPLICATION_SCHEMA_VERSION = 3;
```

Add migration:

```text
db/comment-database/003-rich-raw-inputs.sql
```

### 3.1 New `raw_inputs` table

Required logical schema:

```sql
CREATE TABLE raw_inputs (
    payload_sha256 TEXT PRIMARY KEY
        CHECK (
            length(payload_sha256) = 64
            AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
    payload_bytes BLOB NOT NULL,
    byte_length INTEGER NOT NULL
        CHECK (byte_length >= 0 AND byte_length = length(payload_bytes)),
    input_format TEXT NOT NULL CHECK (length(input_format) > 0),
    imported_at TEXT NOT NULL
) STRICT;
```

Meaning:

- `payload_sha256`: identity of exact bytes.
- `payload_bytes`: authoritative rich raw.
- `byte_length`: integrity aid.
- `input_format`: versioned **wire-format contract identifier**, not parser/materializer version.
- `imported_at`: time this raw input was first persisted.

Legacy single-snapshot raw format identifier:

```text
tiktokRawSnapshot-1.0.0
```

Do not introduce `materializer_version`, canonical JSON hashes, compression, or chunking in this issue.

### 3.2 Rebuild `raw_snapshots`

Keep the table name to minimize churn. The row is now a logical/materialized snapshot belonging to a raw input.

Required columns:

```text
snapshot_id INTEGER PRIMARY KEY
platform TEXT NOT NULL
payload_sha256 TEXT NOT NULL FK -> raw_inputs(payload_sha256)
snapshot_index INTEGER NOT NULL CHECK (snapshot_index >= 0)
extracted_at TEXT NOT NULL
source_page_url TEXT NOT NULL
source_canonical_url TEXT NOT NULL
item_source TEXT NOT NULL
loaded_count INTEGER NOT NULL
reported_count INTEGER NOT NULL
coverage_note TEXT NOT NULL
UNIQUE(payload_sha256, snapshot_index)
```

Remove from `raw_snapshots`:

```text
raw_schema_version
raw_relpath
imported_at
```

Rationale:

- `raw_schema_version` currently describes the single `tiktokRawSnapshot-1.0.0` JSON. A logical child snapshot extracted from another wrapper does not necessarily have that schema.
- Wire format/version belongs on `raw_inputs.input_format`.
- `raw_relpath` must not remain as a normal read-path escape hatch back to filesystem authority.
- import time belongs to the parent raw input.

### 3.3 Observation/master tables

Keep the existing `videos`, `authors`, and `comments` semantics.

Rebuild `snapshot_video_observations` and `snapshot_comment_observations` only as required to point their FKs at the rebuilt `raw_snapshots` table. Preserve IDs and stored values during migration.

Do not add rich-only fields such as music, hashtags, signatures, avatars, URLs, etc. to normalized tables solely for preservation. Their lossless preservation is provided by `raw_inputs.payload_bytes`.

## 4. Provenance identities

Use three distinct identities:

```text
raw input:  payload_sha256
snapshot:   (payload_sha256, snapshot_index)
comment observation ordering: (snapshot_id, source_index)
```

Do not name the snapshot ordinal `source_index`; that name already has the established comment-observation meaning.

For legacy v2 raw snapshots:

```text
snapshot_index = 0
```

## 5. Generic rich-raw DB boundary

Introduce a collector-independent import boundary equivalent to:

```js
importRawInput({
  payloadBytes,
  inputFormat,
  snapshots,
}, options)
```

### 5.1 Top-level validation

Database must validate the DTO shape/invariants, without parsing collector-specific raw JSON:

- `payloadBytes` must be byte-like (`Uint8Array`/Buffer accepted; normalize with `Buffer.from`).
- `inputFormat` must be a non-empty string.
- `snapshots` must be an array with **at least one** element.
- Compute SHA inside the Database boundary from `payloadBytes`; caller must not supply authoritative SHA.
- `snapshot_index` is assigned by Database from array order `0..N-1`; caller must not supply it.

### 5.2 Snapshot materialization DTO

Use an explicit collector-independent DTO. Exact JS naming should follow this contract:

```js
{
  platform,
  extractedAt,
  sourcePageUrl,
  sourceCanonicalUrl,
  itemSource,
  loadedCount,
  reportedCount,
  coverageNote,
  video: {
    externalVideoId,       // string | null; master identity
    externalAuthorId,      // string | null; master identity
    videoIdRaw,            // observed raw value, may be ""
    canonicalUrl,
    title,
    description,
    publishedAt,
    publishedDate,
    regionCode,
    duration,
    viewCount,
    likeCount,
    commentCount,
    shareCount,
    favoriteCount
  },
  comments: [
    {
      externalCommentId,   // string | null; master identity when video master exists
      level,
      commentIdRaw,
      videoIdRaw,
      parentCommentIdRaw,
      username,
      handle,
      userIdRaw,
      commentText,
      postedAt,
      createdAt,
      postedDate,
      likeCount,
      replyCount
    }
  ]
}
```

Validation requirements:

- `platform` is non-empty.
- Required text/date/count fields have the same persisted types accepted today.
- `loadedCount === comments.length`.
- `comments` may be empty; the raw input itself may not contain zero snapshots.
- Comment `source_index` is assigned by Database from comment array order.
- One video observation row is created for every snapshot.
- Use `snapshot.platform` when creating/finding video and author masters. Remove current hard-coded `"tiktok"` from the generic DB path.
- Create `video_pk` only when `externalVideoId !== null`.
- Create `author_pk` only when `externalAuthorId !== null`.
- Create `comment_pk` only when both `video_pk !== null` and `externalCommentId !== null`.

Database validates DTO shape/DB invariants. It **does not** validate that a DTO field came from the correct path inside the raw bytes; that semantic mapping is the adapter's responsibility.

## 6. Existing single-snapshot compatibility adapter

Keep `tiktokRawSnapshot-1.0.0.schema.json` and `parseAndValidateRawSnapshotBytes()` as the existing adapter contract.

Change `importRawSnapshotFile()` / `importRawSnapshotBytes()` so that they become adapter/composition functions:

```text
exact bytes
  -> parseAndValidateRawSnapshotBytes()
  -> map validated payload to one snapshot DTO
  -> importRawInput({
       payloadBytes: exact bytes,
       inputFormat: "tiktokRawSnapshot-1.0.0",
       snapshots: [dto]
     })
```

Do not publish a normal-operation filesystem raw copy.

The DTO mapping must preserve the current effective-ID semantics:

- `externalVideoId = parsed.effectiveVideoId` (nullable).
- `externalAuthorId = payload.author.id === "" ? null : payload.author.id`.
- `externalCommentId = comment.commentId === "" ? null : comment.commentId` (Database still links it only when a video master exists).
- `videoIdRaw`, `commentIdRaw`, `userIdRaw`, etc. retain the exact current observed values.

## 7. Import transaction and idempotency

All rich raw state must be atomic:

```text
BEGIN IMMEDIATE
  raw_inputs
  raw_snapshots
  video/author/comment masters as required
  snapshot_video_observations
  snapshot_comment_observations
COMMIT
```

On any failure, none of the new rich-raw DB rows may remain.

### 7.1 First import

- Compute `payload_sha256` from exact bytes.
- Insert one `raw_inputs` row.
- Insert N `raw_snapshots` rows in array order.
- Insert each snapshot's one video observation and all comment observations.
- Verify `loaded_count` equals persisted comment-observation count before commit.

### 7.2 Duplicate exact input

Do not use `ON CONFLICT DO NOTHING` as the entire integrity policy.

When `raw_inputs.payload_sha256` already exists:

1. Recompute SHA of stored `payload_bytes`; if it does not equal the key, throw `DATABASE_INTEGRITY_ERROR`.
2. Stored bytes must be byte-for-byte equal to supplied bytes. Otherwise throw `RAW_INPUT_CONFLICT`.
3. Stored `input_format` must equal supplied `inputFormat`. Otherwise throw `RAW_INPUT_CONFLICT`.
4. Read all stored materialized snapshots/observations/master external identities and compare them field-for-field to the supplied DTO, excluding generated IDs and `imported_at`.
5. If materialization differs, throw `RAW_INPUT_MATERIALIZATION_CONFLICT`.
6. Only on complete equality return `status: "already-imported"`.

Normal re-import must never silently repair or rewrite a differing materialization.

## 8. Raw read API

Add a repository API equivalent to:

```js
readRawInput(db, payloadSha256)
```

Return at least:

```js
{
  payloadSha256,
  payloadBytes,     // exact bytes
  byteLength,
  inputFormat,
  importedAt
}
```

Database/repository must not JSON.parse the BLOB here.

This API is the direct acceptance point for “rich information can be recovered from DB alone.”

## 9. Analysis projection contract

Keep the downstream record contract exactly unchanged:

```text
username
handle
comment
postedAt
postedDate
```

Keep:

```js
ANALYSIS_PROJECTION_VERSION = "1.0.0";
```

Change:

```js
ANALYSIS_MANIFEST_SCHEMA_VERSION = 2;
DATABASE_SCHEMA_VERSION = 3;
```

Snapshot ordering becomes:

```text
payload_sha256 ASC
snapshot_index ASC
comment source_index ASC
```

Manifest snapshot provenance must include at least:

```json
{
  "payload_sha256": "...",
  "snapshot_index": 0,
  "input_format": "tiktokRawSnapshot-1.0.0",
  "platform": "tiktok",
  "extracted_at": "...",
  "source_canonical_url": "...",
  "loaded_count": 0,
  "reported_count": 0,
  "coverage_note": "...",
  "output_start_index": 0,
  "record_count": 0
}
```

Remove `raw_schema_version` from manifest provenance.

## 10. Filesystem raw store

Normal rich-raw import and analysis must not require or write the content-addressed raw filesystem store.

Remove normal-operation dependencies on:

```text
DEFAULT_RAW_ROOT
ensureRawSnapshotStored()
raw_relpath
--raw-root (import-raw-snapshot)
```

`rawSnapshotRelativePath()` may remain only as a **legacy migration validation helper**.

The old filesystem may remain on disk, but after migration it is not authoritative and is not part of normal DB read paths.

## 11. Verification

Replace filesystem-oriented verification with DB-oriented verification equivalent to `verifyRawInputs()`.

For selected/all raw inputs verify:

- `SHA256(payload_bytes) === payload_sha256`.
- `length(payload_bytes) === byte_length`.
- every snapshot references a raw input.
- `(payload_sha256, snapshot_index)` uniqueness is enforced.
- snapshot `loaded_count` equals comment observation row count.
- exactly one video observation exists per snapshot.
- `PRAGMA foreign_key_check` has no violations relevant to these rows.

Do not reparse collector-specific raw bytes as part of Database verification.

## 12. Normalized-only import is unchanged

Do not modify the existing `importNormalizedPayload*()` contract or merge `imports/comment_observations` into the rich raw model.

## 13. Acceptance criteria

Implementation is complete only when all are true:

1. Exact input bytes are persisted in SQLite for rich raw imports.
2. SHA is calculated over those exact bytes.
3. DB is sufficient to recover rich raw bytes; external raw files are unnecessary after import/migration.
4. One raw input can atomically materialize N snapshots.
5. Snapshot provenance is `(payload_sha256, snapshot_index)`.
6. Comment ordering remains `source_index` within snapshot.
7. Failed import leaves no raw input/snapshot/observation partial state.
8. Exact duplicate import is idempotent only after full materialization integrity comparison.
9. Same raw with differing materialization fails closed.
10. Semantically equal but byte-different JSON remains separate raw inputs.
11. Existing 5-field v1.5 projection is byte-contract compatible at the record-field level.
12. Analysis export does not require external raw files.
13. Rich-only fields omitted from normalized tables remain recoverable from DB BLOB.
14. Legacy v2 raw data cannot be marked v3-complete without successful exact-byte backfill.
15. Database and Processing contain no `new-comments.json`-specific parsing.
16. Normalized-only import remains unchanged.
