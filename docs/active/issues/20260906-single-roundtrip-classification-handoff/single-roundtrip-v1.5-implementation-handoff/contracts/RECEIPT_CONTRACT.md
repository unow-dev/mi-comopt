# Receipt contract

Receipt exact fields may be extended, but the following information is normative minimum.

## prepare_receipt.json

- `schema_version`
- `pipeline_version=1.5.0`
- `protocol_version=single-roundtrip-v1`
- `request_id`
- resolved operational `state_dir`
- input/reference/registry/config/implementation hashes
- source record count
- Stage13 pending row count
- Stage13 unique human decision count
- potential Three-Class task count
- `handoff_required`
- handoff path/SHA if present
- state: `AWAITING_RESPONSE` or `FINALIZED_NO_HANDOFF`

## accepted/receipt.json

- request_id
- raw accepted response SHA-256
- accepted response byte size
- deterministic Stage13 output SHA
- prospective golden SHA
- deterministic Three-Class final SHA
- integrated validation report SHA
- accepted timestamp only as metadata (not classification identity)

## final/finalization_receipt.json

- request_id
- accepted response SHA
- final operational golden SHA
- final clean Stage13 SHA
- final clean Three-Class SHA
- audit/summary/validation hashes
- state `FINALIZED`

Receipts are immutable once written. State is inferred from receipt/artifact existence, not a mutable status field.
