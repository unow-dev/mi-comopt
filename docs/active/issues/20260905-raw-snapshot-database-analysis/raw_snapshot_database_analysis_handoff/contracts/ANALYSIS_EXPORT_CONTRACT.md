# Analysis input export contract v1.0.0

## Purpose

Create the **new/incoming-side 5-field artifact** consumed by the existing current+incoming integration issue. It is not the full Stage13 dataset builder.

## Selection

Only snapshot SHA values explicitly supplied by CLI are included.

Canonical snapshot order:

```text
payload_sha256 ASC
```

Within a snapshot:

```text
source_index ASC
```

No cross-snapshot dedupe or comment identity collapse.

## JSON records

Each record has exactly these keys in this insertion order:

```json
{
  "username": "...",
  "handle": "...",
  "comment": "...",
  "postedAt": "...",
  "postedDate": "..."
}
```

Mapping is direct from normalized observation fields. Values are strings preserved from raw snapshot.

Serialization:

```js
JSON.stringify(records, null, 2) + "\n"
```

UTF-8, no BOM.

The current Stage13 pipeline requires top-level array and exact 5 fields. Do not add metadata, commentId, userId, DB PK, snapshot SHA, or labels to these records.

## Manifest schema v1

Manifest object property order is part of deterministic serialization and should follow this example order:

```json
{
  "schema_version": 1,
  "projection_version": "1.0.0",
  "database_schema_version": 2,
  "output_sha256": "<64 lowercase hex>",
  "output_record_count": 3,
  "snapshots": [
    {
      "payload_sha256": "<64 lowercase hex>",
      "platform": "tiktok",
      "raw_schema_version": 1,
      "extracted_at": "2026-09-05T00:00:00Z",
      "source_canonical_url": "https://...",
      "loaded_count": 3,
      "reported_count": 10,
      "coverage_note": "partial load",
      "output_start_index": 0,
      "record_count": 3
    }
  ]
}
```

### definitions

- `output_sha256`: SHA-256 of exact output JSON bytes, lowercase hex
- `output_record_count`: final array length
- `snapshots`: same canonical order as output
- `output_start_index`: zero-based first output row for this snapshot
- `record_count`: number of exported observations for this snapshot; v1 equals snapshot `loaded_count`
- no `generated_at`: same source set must produce byte-identical manifest

Manifest serialization is also `JSON.stringify(value, null, 2) + "\n"`, UTF-8, no BOM.

## Determinism

Same DB content and same set of snapshot SHAs must produce byte-identical output JSON and manifest regardless of:

- order of `--snapshot-sha` CLI options
- order snapshots were imported
- process timezone
- current time
- raw store availability

## Consumer boundary

The integration issue should verify before merging:

```text
SHA256(new-comments.json) == manifest.output_sha256
JSON array length == manifest.output_record_count
snapshot ranges cover [0, output_record_count) without gaps/overlap
```

Dedupe/merge with legacy data remains consumer responsibility.
