# Test Matrix

## A. Comment-batch contract

| Case | Expected |
|---|---|
| valid exact five-field array | accept |
| root `[]` | accept |
| empty strings in any field | accept |
| whitespace-only strings | accept |
| opaque `postedAt` e.g. `"not parsed"` | accept |
| duplicate objects | accept, preserve multiplicity |
| invalid UTF-8 | `CommentBatchContractError/VALIDATION_ERROR` |
| invalid JSON | same |
| root object instead of array | reject |
| missing any of five keys | reject |
| extra key | reject |
| null/number/boolean/object/array field value | reject |

## B. Adapter

- bytes preserved exactly in `payloadBytes`
- `inputFormat === "tiktokCommentBatch-1.0.0"`
- exactly one snapshot/materialization even for `[]`
- `materializationKind === "comment-batch"`
- `platform === "tiktok"`
- `loadedCount === input.length`
- `comment` → `commentText` only mapping rename
- source order unchanged
- duplicate objects remain duplicate DTO items

## C. Generic DTO validation

### Rich

- existing exact rich DTO + discriminator accepts
- missing discriminator rejects
- wrong discriminator rejects
- existing rich required fields remain required
- existing nullable rich fields semantics unchanged

### Comment batch

- exact batch shape accepts
- `loadedCount < 0` rejects
- unsafe/non-integer loadedCount rejects
- loadedCount mismatch rejects
- extra rich fields reject
- five-field comment extra/missing field rejects
- `platform === ""` rejects
- non-TikTok non-empty platform at generic DTO layer is allowed

## D. Migration v4 → v5

- `PRAGMA user_version = 5`
- all preexisting snapshots `materialization_kind = 'rich-snapshot'`
- row counts unchanged
- IDs/provenance unchanged
- video observations unchanged
- comments unchanged
- indexes/FKs preserved
- newer-than-supported DB remains fail-closed

## E. Persistence

### Comment batch

- exact raw BLOB stored
- raw `input_format` stored
- 1 snapshot row
- correct loaded_count
- unavailable metadata all NULL
- 0 video observations
- no batch-derived videos/authors/comments master rows
- comments count == loadedCount
- source_index exactly input indices
- rich-only six fields all NULL
- common five fields exact strings

### Rich regression

- video observation remains exactly one
- rich-only six comment fields non-NULL
- existing master identity behavior unchanged
- v4 nullable stats behavior unchanged

## F. Idempotency/conflicts

- exact same bytes/format/materialization → `already-imported`
- same SHA stored bytes mismatch → `RAW_INPUT_CONFLICT`
- same bytes + same format but differing DTO materialization → `RAW_INPUT_MATERIALIZATION_CONFLICT`
- source-index corruption detected by reimport comparison
- batch accidental comment master link detected by comparison
- nullable numeric rich values never become zero via `Number(null)`

## G. Atomicity

Inject failure after some batch observations are inserted.

Expected after rollback:

- no new raw_input
- no new raw_snapshot
- no comment observations
- no master rows

## H. Repository / corruption

- loaded_count mismatch → `DATABASE_INTEGRITY_ERROR`
- source index gap (`0,1,3`) → error in normal read and verify
- source index shifted (`1,2,3`) → error
- rich video observation deleted → verify error
- batch video observation manually inserted → verify error
- rich comment six-field group partially NULL → SQL CHECK rejection or verify error
- batch comment rich-only group non-NULL → verify error
- FK corruption → verify error

## I. Analysis projection / manifest

- batch output is exact five-field records
- duplicate records preserved
- source order preserved within snapshot
- rich + batch selection uses same projection
- `ANALYSIS_PROJECTION_VERSION === "1.0.0"`
- `DATABASE_SCHEMA_VERSION === 5`
- `ANALYSIS_MANIFEST_SCHEMA_VERSION === 3`
- batch manifest has nullable unavailable provenance
- manifest does **not** add `materialization_kind`
- deterministic output/manifest ordering preserved

## J. CLI

```bash
npm run comment-db -- import-comment-batch --input fixture.json --db test.sqlite3
```

- help contains command
- unknown/extra option behavior matches existing CLI
- `--input` required
- read failure → `INPUT_READ_FAILED`
- validation error exits nonzero without partial DB writes
- successful import reports payload/comments or equivalent stable summary
- reimport reports already imported
- `--snapshot-sha <sha>` export works because batch has exactly one child

## K. Architecture

- Database/Processing do not import `src/collector/comment-batch/**`
- preferably enforce no `src/database/**` or `src/processing/**` import of any `src/collector/**`
- Processing remains SQLite-independent where already required

## L. Private 24,622 acceptance

For `current_raw.json` outside repository:

1. strict contract validates all rows.
2. input length = 24,622.
3. DB observation count = 24,622.
4. exported length = 24,622.
5. For every index `i`:

```text
input[i].username   === output[i].username
input[i].handle     === output[i].handle
input[i].comment    === output[i].comment
input[i].postedAt   === output[i].postedAt
input[i].postedDate === output[i].postedDate
```

6. Duplicate multiplicities exactly equal.
7. second exact import is idempotent.
8. no synthetic master identities were created.
