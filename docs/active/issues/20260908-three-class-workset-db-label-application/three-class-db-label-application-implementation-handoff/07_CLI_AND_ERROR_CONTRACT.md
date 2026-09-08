# CLI and error contract

## New command

```bash
npm run comment-db -- apply-three-class-response \
  --workset path/to/workset.zip \
  --response path/to/response.json \
  [--db path.sqlite3]
```

Do not add snapshot selectors or mutation override flags.

## Success output

One stdout line:

```text
APPLIED workset=<uuid> observations=<N> inserted=<N> unchanged=<N>
```

Examples:

```text
APPLIED workset=01234567-89ab-4cde-8fab-0123456789ab observations=24622 inserted=24622 unchanged=0
APPLIED workset=01234567-89ab-4cde-8fab-0123456789ab observations=24622 inserted=0 unchanged=24622
APPLIED workset=01234567-89ab-4cde-8fab-0123456789ab observations=0 inserted=0 unchanged=0
```

All counts refer only to the registered workset target observations. DB-wide same-label rows used for consistency checking are not included in `unchanged`.

## Exit codes

Preserve existing CLI behavior:

- `0`: success
- `1`: runtime/protocol/database/application failure
- `2`: CLI argument error

Do not allocate per-application-error exit codes.

## New semantic error codes

### `WORKSET_NOT_REGISTERED`

The validated ZIP workset ID is absent from the DB provenance registry.

### `WORKSET_SOURCE_MISMATCH`

The registered source snapshots, re-read through the existing repository/projection path, do not regenerate the validated ZIP ITEMS exactly.

### `LABEL_CONFLICT`

At least one requested exact comment already has a different current label anywhere in the DB, or a target observation has a different current label.

The error should expose enough diagnostic information for the first conflict, e.g.:

- workset ID
- conflict count if cheaply known
- example observation ID
- existing label
- requested label

Do not dump comment bodies into error output as a requirement.

## Existing error system

Use `CommentDatabaseError` / the existing adapter `worksetError(...)` pattern.

Unexpected SQLite/SQL execution failures remain in the existing database-error family (e.g. `DATABASE_QUERY_FAILED` where appropriate). Do not introduce a generic `THREE_CLASS_APPLY_FAILED` wrapper that hides the existing DB error taxonomy.

Impossible source/target/invariant states use `DATABASE_INTEGRITY_ERROR`.
