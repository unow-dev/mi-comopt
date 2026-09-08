# Code change map

Repository paths below are relative to the `package/` root shown in the supplied discussion set.

## `db/comment-database/006-three-class-label-application.sql` — add

Use `03_DB_MIGRATION_006.sql` as the specification.

No data backfill. No inference from existing artifacts/comments. No triggers. No CASCADE delete clauses.

## `src/database/comment-database.js` — modify

- `APPLICATION_SCHEMA_VERSION`: `5 -> 6`
- append migration:

```js
{ version: 6, filename: "006-three-class-label-application.sql" }
```

Do not otherwise change migration transaction semantics.

## `src/processing/analysis-input/raw-snapshot-projection.js` — modify

- `DATABASE_SCHEMA_VERSION`: `5 -> 6`
- keep `ANALYSIS_PROJECTION_VERSION = "1.0.0"`
- keep `ANALYSIS_MANIFEST_SCHEMA_VERSION = 3`

The projection contract did not change; only the backing DB schema version did.

## `src/database/three-class-label-repository.js` — add

SQL-only repository for:

- workset provenance registration
- provenance lookup / ref reconstruction
- registry-scoped target observation read
- DB-wide existing comment/label group read
- registry-scoped existing target label read
- plain label insert

Do not place workflow conflict decisions in this module.

## `scripts/adapters/three-class-workset.js` — modify

- extract private `buildThreeClassItems(records)` from current generator loop
- add private transaction helper using `BEGIN IMMEDIATE` / `COMMIT` / best-effort `ROLLBACK`
- refactor response reading into one shared validated-submission helper
- preserve existing `validateThreeClassResponse()` output behavior
- update generator to register workset provenance only after package + archive validation + staging cleanup
- add safe final-ZIP cleanup on post-package/pre-commit failures owned by this invocation
- add `applyThreeClassResponse()` per `02_IMPLEMENTATION_SPEC.md`

Do not move the ITEMS builder into protocol validation. It converts projected DB records into workset items and belongs to the adapter workflow.

## `scripts/pack-three-class-workset.py` — modify

After the packager creates the final hard-link, if its later self-read/validation fails, remove the final path only if this invocation created it.

Do not rely on the JS caller to clean this failure mode.

## `scripts/comment-database.mjs` — modify

Add command:

```text
apply-three-class-response
```

Arguments:

```text
--workset <path>   required
--response <path>  required
--db <path>        optional
```

No snapshot selector options for this command.

Add it to:

- supported commands
- usage/help
- allowed options
- required option checks
- dispatch

Import `applyThreeClassResponse` from the existing adapter.

## `tests/three-class-workset.test.js` — modify

Add generator-provenance, apply, idempotency, scope, conflict, failure-cleanup, and CLI tests.

## `tests/raw-snapshot-database.test.js` — modify

Add/adjust migration 006 schema/version tests as appropriate.

Do not mechanically change tests that intentionally assert the intermediate v5 state of migration 005 fixtures.

## `tests/raw-snapshot-analysis-input.test.js` — modify

Update expectations that represent the current/latest `database_schema_version` from 5 to 6.

Do not change projection version or manifest schema version expectations.
