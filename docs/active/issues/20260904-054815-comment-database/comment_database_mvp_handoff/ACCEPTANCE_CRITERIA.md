# Acceptance Criteria

The MVP is accepted only when all items below are satisfied.

## Build/runtime

- [ ] Works under the repository's Node `>=24 <25` engine contract.
- [ ] Adds no third-party SQLite dependency.
- [ ] `npm test` remains green.
- [ ] `npm run build` remains green.

## Schema/migrations

- [ ] Missing DB is created automatically by the import command.
- [ ] Migration 001 creates exactly the required MVP tables/indexes.
- [ ] `PRAGMA user_version` becomes `1` after initialization.
- [ ] A DB with `user_version > 1` is rejected without payload writes.
- [ ] Foreign-key enforcement is enabled and verified.

## Input validation

- [ ] Root object requires exact keys `schemaVersion` and `observations`.
- [ ] `schemaVersion` must equal integer `1`.
- [ ] Observation objects require exact keys `source`, `postRef`, `collectedAt`, `commentText`.
- [ ] `source` and `postRef` are strings containing a non-whitespace character.
- [ ] `commentText` is a string; empty string remains valid.
- [ ] `collectedAt` requires explicit timezone and valid date/time.
- [ ] Fractional seconds longer than 3 digits are rejected in v1.
- [ ] Unknown/additional keys are rejected.
- [ ] No input string is silently trimmed/case-folded/Unicode-normalized.

## Timestamp behavior

- [ ] Stored `collected_at` is UTC `Date#toISOString()` form.
- [ ] Equivalent timezone representations normalize to the same UTC instant.
- [ ] `imports.imported_at` is a separate UTC import timestamp, not collection time.

## Idempotency

- [ ] Canonical payload hash follows the algorithm in `IMPLEMENTATION_HANDOFF.md` exactly.
- [ ] JSON formatting/property order does not change payload identity.
- [ ] Observation-array ordering does not change payload identity.
- [ ] Duplicate multiplicity does change payload identity.
- [ ] Re-importing the same canonical payload is exit-0/no-op and adds no rows.

## Persistence semantics

- [ ] Every original observation index is stored as 0-based `source_index`.
- [ ] Duplicate observations inside a single payload are stored as separate rows.
- [ ] Repeated observation content across different non-identical payloads is not deduplicated.
- [ ] No username, handle, or profile fields exist in the v1 schema.
- [ ] No filter-decision or detected-keyword fields exist in the v1 schema.

## Atomicity/error handling

- [ ] Full payload validation completes before payload data writes begin.
- [ ] One payload is imported in one transaction.
- [ ] Any row/write error rolls back both the import row and all observation rows.
- [ ] Operator errors return nonzero and write useful stderr output.
- [ ] Normal errors do not emit uncontrolled stack traces.

## Paths/Git safety

- [ ] Default DB resolves to `<repo>/var/comment-history.sqlite3` independent of process CWD.
- [ ] Migration path resolves independent of process CWD.
- [ ] `--db` override works for tests/maintenance.
- [ ] Root `.gitignore` excludes `/var/*.sqlite3` and `/var/*.sqlite3-*`.
- [ ] No real SQLite database is committed.

## Queryability

- [ ] Query by `(source, post_ref, collected_at)` is indexed.
- [ ] Query by `collected_at` is indexed.
- [ ] `LIKE` search over `comment_text` works.
- [ ] Documentation states counts are observation counts, not guaranteed unique-comment counts.

## Documentation

- [ ] `package/docs/comment-database.md` documents input schema, CLI, DB path, query examples, and limitations.
- [ ] Documentation explicitly marks collector-specific adapter work as outside v1 DB implementation.
- [ ] Documentation states that source-service terms/privacy/retention must be confirmed before real-data operation.
