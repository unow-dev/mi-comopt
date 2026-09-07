# Decision Log

## D1 — Exact bytes, not parsed JSON, are authoritative

**Adopted:** SQLite BLOB + SHA-256 over exact bytes.

**Rejected:** parsed/canonicalized JSON as authority.

Reason: current system already identifies/preserves input byte sequences; changing identity semantics during the storage move would be unnecessary and lossy.

## D2 — Raw BLOB and normalized materialization coexist

**Adopted:** raw is source of truth; snapshot/observation tables remain materialized for normal processing.

**Rejected:** BLOB-only DB that reparses on every downstream operation.

Reason: preserve existing efficient, collector-independent five-field path.

## D3 — One raw input may contain multiple snapshots

**Adopted:** `raw_inputs` 1:N `raw_snapshots`, provenance `(payload_sha256, snapshot_index)`.

**Rejected:** SHA uniquely identifying a snapshot forever; synthetic child hashes.

Reason: production wrapper may contain multiple snapshots; inventing canonical child hashing creates a new serialization contract.

## D4 — `snapshot_index`, not a second `source_index`

Reason: `source_index` already means comment position within a snapshot. Distinct names reduce SQL/manifest ambiguity.

## D5 — Keep `raw_snapshots` table name

**Adopted:** rebuild semantics without rename.

**Rejected:** broad rename to `raw_input_snapshots`.

Reason: limited semantic gain for widespread code/schema churn.

## D6 — Remove child `raw_schema_version`

Wire-format version belongs on parent `raw_inputs.input_format`; logical child snapshots should not falsely claim the legacy raw JSON schema.

## D7 — Database is generic; adapter owns collector-specific parsing

**Adopted:** `payloadBytes + inputFormat + normalized snapshot DTOs` boundary.

**Rejected:** Database/Processing parsing `new-comments.json`.

Reason: explicit `ARCHITECTURE.md` dependency rule.

## D8 — Database validates DTO shape but not raw-to-DTO semantic mapping

Adapter tests prove mapping. Database proves storage/transaction/invariants. This keeps the trust boundary explicit.

## D9 — No zero-snapshot rich input in this issue

**Adopted:** `snapshots.length >= 1`.

Reason: avoids a new “raw-only successful ingestion” state not required by the issue. Add separately if acquisition audit semantics later require it.

## D10 — Normalized-only import remains separate

The source-of-truth guarantee applies to the rich raw path. Existing normalized `import` is not silently redefined as possessing rich raw provenance.

## D11 — Strict legacy backfill

**Adopted:** populated v2 cannot become valid v3 until all referenced legacy bytes are present and SHA-valid.

**Rejected:** nullable raw bytes / partial migration / discard-and-rebuild by default.

## D12 — Prepare outside write lock, validate inside `BEGIN IMMEDIATE`

Reason: avoid long filesystem I/O under write lock while preventing migration from using a stale v2 source set.

## D13 — Migrate existing normalized rows; do not reparse/reproject

Reason: this migration relocates source-of-truth bytes. Re-running a possibly changed parser would conflate storage migration with semantic reprojection and may alter existing IDs/data.

## D14 — Duplicate import uses full materialization integrity comparison

**Rejected:** SHA-exists => immediate success; count-only comparison.

Reason: neither detects corrupted/different normalized values. Normal import also must not silently repair conflicts.

## D15 — Do not add materialization hash/version now

Reason: it would require canonical serialization and another version contract. Field-level compare is sufficient for duplicate import frequency/scale and keeps scope bounded.

## D16 — Five-field projection remains unchanged

Keep `ANALYSIS_PROJECTION_VERSION = 1.0.0`; only provenance/manifest schema and DB schema versions change.

## D17 — Canonical CLI selector is snapshot ref

**Adopted:** `<payload_sha256>:<snapshot_index>`.

**Rejected:** raw-input SHA implicitly selecting all children; DB-local snapshot ID.

Reason: preserves current snapshot-level selection semantics and deterministic portable identity.

## D18 — Filesystem raw store is removed from normal operation

Legacy filesystem is migration input only. Verification becomes DB-oriented. Keeping misleading normal `--raw-root`/`verify-raw-store` semantics would undermine the source-of-truth change.
