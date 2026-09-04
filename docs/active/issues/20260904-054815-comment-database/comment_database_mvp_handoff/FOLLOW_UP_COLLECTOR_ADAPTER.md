# Follow-up Issue: Collector → Comment DB Adapter

This is intentionally separate from the Comment Database MVP because the supplied source bundle does not contain the collector implementation or its output contract.

## Objective

Transform actual collector output into the database's normalized schemaVersion 1 payload:

```json
{
  "schemaVersion": 1,
  "observations": [
    {
      "source": "...",
      "postRef": "...",
      "collectedAt": "...timezone-aware RFC3339...",
      "commentText": "..."
    }
  ]
}
```

## Required investigation

For the real collector, identify authoritative mappings for:

- `source`: source/service namespace.
- `postRef`: stable opaque reference for the related post.
- `collectedAt`: the actual observation/collection timestamp.
- `commentText`: collected comment body.

## Rules

- Do not substitute comment-posting time for collection time.
- Do not substitute run/import time for collection time.
- Do not infer a post reference from unrelated filenames unless that filename is an established collector contract.
- Do not invent missing values solely to satisfy the DB schema.
- If required data is unavailable, extend the collector contract first.
- Preserve comment text exactly except for JSON decoding.

## Follow-up acceptance criteria

- Mapping is documented against the actual collector implementation/output.
- Representative collector fixture converts to valid schemaVersion 1 payload.
- Adapter integration test imports the converted fixture successfully.
- No account/profile fields are forwarded to the DB payload.
