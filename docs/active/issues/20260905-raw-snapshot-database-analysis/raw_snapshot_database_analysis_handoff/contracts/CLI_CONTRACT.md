# CLI contract

Executable remains `npm run comment-db -- ...` from repository root via the existing workspace forwarding.

## Existing command — unchanged

```text
comment-db import
  --input <normalized-comments.json>
  [--db <sqlite-path>]
```

Its v1 semantic canonical hash and timestamp normalization behavior must not change.

## New: import-raw-snapshot

```text
comment-db import-raw-snapshot
  --input <rich-raw-snapshot.json>
  [--db <sqlite-path>]
  [--raw-root <directory>]
```

Defaults:

```text
--db       <repo>/var/comment-history.sqlite3
--raw-root <repo>/var/raw-snapshots
```

Relative user-provided paths follow the existing CLI resolution rule: npm `comment-db` invocation resolves from `INIT_CWD`; otherwise from process cwd.

Success status values are conceptually `imported` or `already-imported`; exact human log wording may follow the existing CLI style but must include payload SHA and comment count.

## New: export-analysis-input

```text
comment-db export-analysis-input
  --snapshot-sha <64-lowercase-hex>
  [--snapshot-sha <64-lowercase-hex> ...]
  --output <json-path>
  --manifest <manifest-path>
  [--db <sqlite-path>]
```

Rules:

- at least one `--snapshot-sha`
- duplicate SHA in one invocation -> `CLI_ERROR`
- invalid SHA syntax -> `CLI_ERROR`
- unknown SHA in DB -> runtime error (`SNAPSHOT_NOT_FOUND`)
- no implicit latest/all/date-range selection
- no `--raw-root`; export is DB-only
- output and manifest paths must be distinct
- if either final target already exists, fail closed rather than silently overwrite

## New: verify-raw-store

```text
comment-db verify-raw-store
  [--snapshot-sha <sha> ...]
  [--db <sqlite-path>]
  [--raw-root <directory>]
```

No SHA means all v2 rich snapshots. Duplicate SHA is CLI error. Unknown SHA is runtime error.

## help and exit codes

```text
0  success or help
1  input/schema/raw-store/DB/export/integrity error
2  command/option/argument misuse
```

Operator errors must remain concise and stack-trace-free, matching current CLI behavior.

## error codes to expose through CommentDatabaseError (or equivalent shared error)

Required semantic codes:

```text
VALIDATION_ERROR
INPUT_READ_FAILED
RAW_STORE_WRITE_FAILED
RAW_STORE_CORRUPT
DATABASE_INTEGRITY_ERROR
SNAPSHOT_NOT_FOUND
EXPORT_WRITE_FAILED
IMPORT_FAILED
```

Existing v1 error codes remain intact.
