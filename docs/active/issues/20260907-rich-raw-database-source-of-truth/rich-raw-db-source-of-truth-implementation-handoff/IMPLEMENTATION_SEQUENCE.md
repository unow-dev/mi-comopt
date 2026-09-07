# Recommended Implementation Sequence

Implement in this order so each layer has a stable dependency to build on.

## 1. Migration infrastructure + v3 schema

- Add async migration prepare/validate support.
- Add v3 migration context/backfill behavior.
- Add `003-rich-raw-inputs.sql`.
- Add migration tests first.

Do not change CLI analysis selectors before the schema/repository can represent multi-snapshot provenance.

## 2. Generic Database import core

- Define/validate generic DTO.
- Add `importRawInput()`.
- Generalize video/author master helpers to use DTO platform.
- Add full duplicate integrity comparison.
- Add raw read API support/query primitives.

## 3. Existing TikTok single-snapshot adapter

- Map existing validated raw snapshot payload into the generic DTO.
- Make `importRawSnapshotBytes/File` delegate to `importRawInput()`.
- Remove normal filesystem publication.

At this point all existing rich snapshot semantic tests should pass after updating persistence expectations.

## 4. Repository/provenance

- Add `readRawInput()`.
- Move selected snapshot model to `(payloadSha256, snapshotIndex)`.
- JOIN `raw_inputs` for `inputFormat/importedAt`.
- Implement DB-only `verifyRawInputs()`.

## 5. Processing manifest

- Add `snapshotIndex` to sorting/provenance.
- Manifest schema 2 / database schema 3.
- Keep five-field projection unchanged.

## 6. CLI

- Remove normal import `--raw-root`.
- Add `backfill-raw-inputs`.
- Add `--snapshot-ref` and strict legacy `--snapshot-sha` resolution.
- Replace `verify-raw-store` with `verify-raw-inputs`.

## 7. Cleanup

- Remove dead filesystem publication code/error paths/imports.
- Retain only legacy-path helpers needed by migration.
- Ensure no normal read/write path reaches legacy raw root.

## 8. Full regression

Run package tests:

```text
npm test
```

Also manually exercise a representative backfill on a copied v2 DB/raw root before applying the implementation to any irreplaceable working database.
