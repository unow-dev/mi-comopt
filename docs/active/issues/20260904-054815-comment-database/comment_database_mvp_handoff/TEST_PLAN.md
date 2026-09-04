# Required Test Plan

Implement tests with Node's existing `node --test` setup. Tests should use a temporary directory/database and must not touch the real `var/comment-history.sqlite3`.

## 1. Initialization

- Import one valid payload into a nonexistent DB.
- Assert DB exists.
- Assert `PRAGMA user_version = 1`.
- Assert required tables and indexes exist.
- Assert counts: one import row; expected observation rows.

## 2. Valid timestamp normalization

Input examples:

- `2026-09-04T01:23:45Z`
- `2026-09-04T10:23:45+09:00`
- `2026-09-04T01:23:45.1Z`
- `2026-09-04T01:23:45.123Z`

Assert normalized UTC values are stored in `YYYY-MM-DDTHH:mm:ss.SSSZ` form.

## 3. Invalid timestamps

Reject at minimum:

- timezone-less `2026-09-04T01:23:45`
- date-only `2026-09-04`
- invalid date `2026-02-30T00:00:00Z`
- >3 fractional digits `2026-09-04T01:23:45.1234Z`
- arbitrary date text

Assert DB row counts do not change.

## 4. Strict schema

Reject:

- root array;
- missing `schemaVersion`;
- `schemaVersion: "1"`;
- unknown root key;
- missing observation field;
- unknown observation field;
- non-string `source`, `postRef`, `collectedAt`, or `commentText`;
- whitespace-only `source`/`postRef`.

Allow `commentText: ""`.

## 5. Canonical hash — formatting/property order

Create two files with identical logical content but different indentation and property ordering.

- First import succeeds.
- Second is `already imported`.
- DB counts unchanged after second command.

## 6. Canonical hash — observation ordering

Create payloads with the same observations in opposite order.

- Second import is a no-op.

## 7. Canonical hash — duplicate multiplicity

Payload A: observation X once.
Payload B: observation X twice.

- Hashes must differ.
- Both payloads can be imported.
- Payload B stores two observation rows with distinct `source_index` values.

## 8. Cross-import repeated content

Payload A and B are not canonically identical but share one identical observation.

- Both imports succeed.
- Shared observation content appears once per import; no cross-import dedupe occurs.

## 9. Atomic rollback

Force a write failure after the `imports` insert but before completion of all observation inserts (use a test hook or controlled constraint failure).

- Transaction rolls back.
- Neither the import row nor partial observation rows remain.

## 10. Foreign keys

- Confirm `PRAGMA foreign_keys` returns `1`.
- Attempt an orphan observation insert through test DB access and assert failure.

## 11. Newer schema protection

Create DB and set:

```sql
PRAGMA user_version = 2;
```

Run v1 importer.

- Command fails.
- No import/observation rows are added.

## 12. CWD independence

Launch the CLI from a temporary unrelated CWD without `--db` in a controlled fixture repository, or test the path-resolution function directly.

Assert migration/default DB paths derive from module location, not process CWD.

## 13. String preservation

Use strings containing:

- leading/trailing spaces in `commentText`;
- mixed case;
- composed/decomposed Unicode forms;
- punctuation/newlines.

Assert stored text exactly matches input bytes after JSON decoding. Only `collectedAt` may be rewritten.

## 14. Empty observations payload

Import:

```json
{"schemaVersion":1,"observations":[]}
```

- Import succeeds.
- One `imports` row with `observation_count = 0`.
- Zero observation rows.
- Re-import is no-op.

## 15. Git-safety check

At minimum review/test that `.gitignore` contains:

```text
/var/*.sqlite3
/var/*.sqlite3-*
```
