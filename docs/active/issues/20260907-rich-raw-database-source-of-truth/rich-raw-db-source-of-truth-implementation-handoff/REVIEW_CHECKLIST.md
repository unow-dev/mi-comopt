# Review Checklist / Reject Conditions

Reject the implementation if any item below is true.

## Source of truth

- [ ] Raw input is stored only after parse/serialize rather than as exact bytes.
- [ ] `raw_inputs.payload_bytes` is nullable in the completed v3 schema.
- [ ] Normal downstream operation still requires an external raw file.
- [ ] Normal rich import still writes an authoritative filesystem raw copy.
- [ ] Rich-only fields are “preserved” by proliferating normalized columns instead of storing exact raw bytes.

## Schema / identity

- [ ] `raw_snapshots.payload_sha256` remains UNIQUE by itself, preventing 1 raw input → N snapshots.
- [ ] snapshot ordinal is named `source_index` rather than `snapshot_index`.
- [ ] `raw_schema_version` remains attached to logical child snapshots.
- [ ] `raw_relpath` remains part of the normal v3 snapshot model/read path.
- [ ] legacy migration creates v3 rows with missing raw bytes.

## Architecture

- [ ] Generic Database import parses TikTok JSON or `new-comments.json`.
- [ ] Processing gains Database/filesystem/collector parsing dependencies.
- [ ] Generic master creation still hard-codes `"tiktok"` instead of using snapshot DTO `platform`.
- [ ] `new-comments.json` parsing is added to this issue despite the Architecture non-goal.
- [ ] normalized-only `import` behavior is changed/merged without a separate requirement.

## Transactions / duplicates

- [ ] Raw BLOB is committed separately from snapshots/observations.
- [ ] DB failure leaves a new authoritative raw file/row outside the transaction.
- [ ] duplicate SHA immediately returns `already-imported` without checking stored raw/materialization integrity.
- [ ] normal re-import silently repairs/overwrites a different materialization.
- [ ] a new materialization hash/version/canonical serialization system is introduced unnecessarily.

## Migration

- [ ] normal open guesses/scans a legacy raw root.
- [ ] populated v2 auto-migrates without backfilling exact bytes.
- [ ] filesystem I/O for all legacy files is performed while holding a long SQLite write transaction.
- [ ] migration reparses raw JSON and rebuilds normalized observations unnecessarily.
- [ ] migration permits partial success.
- [ ] migration changes existing snapshot/observation/master IDs without necessity.

## Analysis / CLI

- [ ] five-field output contract changes.
- [ ] `ANALYSIS_PROJECTION_VERSION` is bumped despite unchanged five-field semantics.
- [ ] manifest still identifies child snapshots by SHA alone.
- [ ] canonical ordering omits `snapshot_index`.
- [ ] `verify-raw-store` remains the canonical verification command.
- [ ] `import-raw-snapshot --raw-root` remains part of normal import semantics.
