# Implementation Handoff: Comment Database MVP

## 1. Objective

Implement a local SQLite database that can safely and idempotently accumulate normalized comment **observations** and support:

- comment-text search;
- grouping/filtering by source and post reference;
- time-based analysis by collection timestamp;
- later manual investigation of filter-keyword candidates.

The MVP is intentionally a persistence/import boundary. It is **not** a collector integration and is **not** a filter-decision history system.

## 2. Scope boundary

### In scope

- SQLite schema and migration 001.
- A Node 24 import CLI.
- Strict validation of a normalized JSON payload.
- UTC normalization of collection timestamps.
- Canonical payload hashing for idempotent re-import.
- Atomic import transactions.
- Query-supporting indexes.
- Repository scripts and documentation.
- Git exclusion of mutable SQLite data and sidecars.

### Explicitly out of scope

- Collector-specific parsing or scraping.
- Guessing/minting a native comment ID.
- Cross-import comment deduplication.
- Usernames, handles, profile data, or other account metadata.
- Persisting filter decisions.
- Persisting detected keyword hits.
- FTS5/full-text index.
- Automatic retention/deletion policy.
- Encryption-at-rest implementation.
- UI/API for browsing the database.
- External/server database migration.

Do not add any of the above during the MVP unless the issue scope is explicitly reopened.

## 3. Why the persistence unit is an observation

The provided source bundle does not include a collector contract or evidence that a stable source-native comment ID is always available. Therefore the database must not invent a comment identity from text, timestamps, or hashes.

The durable fact stored by v1 is:

> At a collection time, a source/post produced this comment text as one observed record.

The same underlying comment may therefore be observed more than once across different imports. This is intentional. The database reports **observation counts**, not guaranteed unique-comment counts.

## 4. Normalized input contract — schemaVersion 1

The importer accepts one JSON object with exactly these top-level keys:

```json
{
  "schemaVersion": 1,
  "observations": [
    {
      "source": "tiktok",
      "postRef": "opaque-post-reference",
      "collectedAt": "2026-09-04T01:23:45Z",
      "commentText": "comment body"
    }
  ]
}
```

### Top-level validation

- JSON root must be an object, not an array/null/scalar.
- Exact keys: `schemaVersion`, `observations`. Unknown keys are rejected.
- `schemaVersion` must be the integer `1`.
- `observations` must be an array. Empty arrays are valid.

### Observation validation

Each observation must be an object with exactly these keys:

- `source`
- `postRef`
- `collectedAt`
- `commentText`

Rules:

- `source`: string containing at least one non-whitespace character.
- `postRef`: string containing at least one non-whitespace character.
- `commentText`: string. Empty string is allowed; do not trim or normalize it.
- `collectedAt`: string in RFC 3339-compatible date-time form with an explicit timezone.

For v1, accept timestamps matching this shape before semantic date validation:

```text
YYYY-MM-DDTHH:mm:ss[.SSS](Z|+HH:MM|-HH:MM)
```

Fractional seconds may contain 1–3 digits only. Reject missing timezones and values that cannot represent a real date/time.

Normalize accepted timestamps to UTC using `Date#toISOString()`. Stored values therefore use the canonical form:

```text
YYYY-MM-DDTHH:mm:ss.SSSZ
```

Do not silently repair invalid input.

### String preservation

Do not trim, case-fold, Unicode-normalize, remove punctuation, or rewrite `source`, `postRef`, or `commentText`. Validation may inspect whitespace, but persisted string content must remain the supplied content except for `collectedAt`, which is normalized to UTC.

## 5. Canonical payload SHA-256

Idempotency is defined over normalized logical payload content, not input-file formatting.

After validation and timestamp normalization:

1. Convert every observation to the JSON string of this tuple:

```js
JSON.stringify([
  source,
  postRef,
  collectedAtUtc,
  commentText,
])
```

2. Sort these observation strings using JavaScript's default string ordering (`Array.prototype.sort()` with no comparator).
3. Keep duplicates. Sorting changes order only; it must not deduplicate.
4. Build the canonical JSON string:

```js
JSON.stringify([1, sortedObservationStrings])
```

5. Compute SHA-256 over its UTF-8 bytes and encode as lowercase hexadecimal.

This is `payload_sha256`.

Consequences:

- Whitespace/property ordering in the input JSON does not affect identity.
- Observation-array ordering does not affect identity.
- Duplicate multiplicity does affect identity.
- A changed normalized observation produces a different payload identity.

Do not replace this algorithm with raw-file SHA or semantic comment deduplication.

## 6. SQLite schema

Migration 001 is supplied in `schema/001_init.sql` and is authoritative.

Logical model:

### `imports`

One row per unique normalized payload.

- `import_id`: SQLite integer primary key.
- `payload_sha256`: canonical payload hash, unique.
- `imported_at`: actual database import time, UTC ISO timestamp. This is **not** collection time.
- `schema_version`: currently `1`.
- `observation_count`: input observation count including duplicates.

### `comment_observations`

One row per input observation in a successfully committed import.

- `observation_id`: integer primary key.
- `import_id`: parent import.
- `source_index`: 0-based original index in the input `observations` array.
- `source`, `post_ref`, `collected_at`, `comment_text`: normalized/preserved values.

Do not add a unique constraint across observation content. Cross-import repeated observations are valid.

## 7. Required indexes

Migration 001 must provide:

- `(source, post_ref, collected_at)` for post/time analysis.
- `(collected_at)` for time-window analysis.

Do not add FTS5 in v1.

## 8. SQLite connection and migration rules

Use Node's built-in `node:sqlite`; do not add a third-party SQLite dependency for this MVP.

On every database connection:

```sql
PRAGMA foreign_keys = ON;
```

Verify foreign-key enforcement is active before writes.

Use `PRAGMA user_version` for migration state.

Migration files live under:

```text
package/db/comment-database/
```

Required first migration:

```text
001-init.sql
```

Rules:

- Missing DB: create it and apply migrations automatically on import.
- DB `user_version` lower than application migration version: apply missing migrations in order.
- DB `user_version` equal to application version: continue.
- DB `user_version` greater than application version: fail closed without data writes.
- Migration and payload import are separate transactions.
- Migration SQL must not contain application-specific input data.

## 9. Import transaction semantics

Processing order:

1. Read input bytes.
2. Parse JSON.
3. Validate the full payload.
4. Normalize every `collectedAt`.
5. Compute `payload_sha256`.
6. Resolve/open DB and apply migrations.
7. Check for existing `payload_sha256`.
8. If already imported, return success/no-op.
9. Otherwise start one write transaction.
10. Insert `imports` row.
11. Insert all `comment_observations` rows preserving original input indexes.
12. Commit.

If any step after transaction start fails, rollback the entire payload. Partial imports are forbidden.

The import timestamp must be generated once per import in UTC and reused for the `imports` row.

## 10. CLI contract

Package script:

```json
"comment-db": "node scripts/comment-database.mjs"
```

Root workspace forwarding script:

```json
"comment-db": "npm --workspace package run comment-db --"
```

Supported command:

```bash
npm run comment-db -- import --input path/to/normalized-comments.json
```

Optional override for tests/maintenance:

```bash
npm run comment-db -- import \
  --input path/to/normalized-comments.json \
  --db /absolute/or/relative/path.sqlite3
```

No `init`, `query`, `delete`, `export`, or migration-management subcommands in v1.

### Default paths

Default DB:

```text
<repository-root>/var/comment-history.sqlite3
```

Resolve repository root from the script/module location, **not** from process CWD.

Migration directory:

```text
<repository-root>/package/db/comment-database/
```

### Exit behavior

- Successful new import: exit `0`.
- Already-imported no-op: exit `0`.
- CLI/argument syntax error: normal argument-parser nonzero usage exit (recommended `2`).
- Validation, migration, schema-version, filesystem, or SQLite failure: exit nonzero (recommended `1`).

Do not print stack traces during normal operator errors unless an explicit debug mode is later added.

Recommended success output:

```text
imported payload=<sha256> observations=<count>
```

Recommended no-op output:

```text
already imported payload=<sha256> observations=<count>
```

Errors go to stderr.

## 11. Repository changes

Expected implementation files:

```text
package/
  src/lib/comment-database.js
  scripts/comment-database.mjs
  db/comment-database/
    001-init.sql
  tests/comment-database.test.js
  docs/comment-database.md
```

Expected repository-level changes:

- `package/package.json`: add `comment-db` script.
- root `package.json`: add forwarding `comment-db` script.
- root `.gitignore`: exclude mutable SQLite files.

Required `.gitignore` entries:

```gitignore
/var/*.sqlite3
/var/*.sqlite3-*
```

Do not commit a real database file.

## 12. Data handling / privacy

The MVP intentionally excludes usernames, handles, and profile metadata.

This does **not** make the database anonymous. Comment text and post references may themselves contain or reveal personal information.

Before real-data operation, the operator must separately confirm applicable source-service terms, privacy requirements, and an appropriate retention policy. This is an operational gate, not something the MVP implementation should invent.

## 13. Query expectations

The DB must support ordinary SQLite queries such as:

```sql
SELECT source, post_ref, collected_at, comment_text
FROM comment_observations
WHERE source = ?
  AND post_ref = ?
ORDER BY collected_at;
```

```sql
SELECT substr(collected_at, 1, 10) AS day, COUNT(*) AS observations
FROM comment_observations
GROUP BY day
ORDER BY day;
```

```sql
SELECT source, post_ref, collected_at, comment_text
FROM comment_observations
WHERE comment_text LIKE '%' || ? || '%';
```

Counts are observation counts. Do not present them as guaranteed unique-comment counts.

## 14. Definition of done

Implementation is done only when every acceptance criterion in `ACCEPTANCE_CRITERIA.md` passes and required tests in `TEST_PLAN.md` are automated.
