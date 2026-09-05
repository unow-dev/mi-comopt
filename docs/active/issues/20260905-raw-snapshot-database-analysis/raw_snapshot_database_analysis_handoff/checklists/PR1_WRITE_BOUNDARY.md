# PR1 checklist — raw write boundary

## Objective

Deliver a complete, independently reviewable path:

```text
valid rich raw -> exact raw store -> Comment DB v2
```

## Checklist

- [ ] add raw schema contract under `package/contracts/raw-snapshots/`
- [ ] add `ajv` 8.x + `ajv-formats` 3.x runtime dependencies
- [ ] use Ajv draft-2020-12 class; enable `date-time` format validation
- [ ] add semantic validation: loadedCount/items length
- [ ] add semantic validation: conflicting video IDs
- [ ] do not add schema-unlisted semantic restrictions
- [ ] add migration `002-raw-snapshots.sql`
- [ ] set app schema version 2 and migration list [001, 002]
- [ ] add exact-byte content-addressed store
- [ ] default raw root `<repo>/var/raw-snapshots`
- [ ] add `.gitignore` `/var/raw-snapshots/`
- [ ] implement explicit effective video ID rule
- [ ] no pseudo IDs
- [ ] normalize only fields listed in DB contract
- [ ] author master is identity-only
- [ ] comment userId observation-only
- [ ] use `BEGIN IMMEDIATE` for v2 import
- [ ] same exact SHA reimport idempotent
- [ ] detect corrupt existing raw target
- [ ] add `import-raw-snapshot`
- [ ] add `verify-raw-store`
- [ ] preserve existing `import` behavior
- [ ] update structural v1 tests for additive v2 tables
- [ ] newer schema test uses `APPLICATION_SCHEMA_VERSION + 1`
- [ ] add v1-to-v2 data-preservation test
- [ ] add raw/import/integrity tests from TEST_PLAN
- [ ] update comment DB documentation/privacy notes
- [ ] `npm test` green

## Review focus

- no accidental changes to v1 hash/timestamp normalization
- no raw byte reserialization before canonical store
- no DB profile data beyond contract
- no candidate/UI imports
- no dedupe logic
