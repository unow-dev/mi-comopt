# Three-Class Workset Protocol v1

Protocol identifier:

```text
three-class-workset-v1
```

## 1. Workset archive

Exactly five root-level regular files:

```text
PROMPT.md
RULES.md
HISTORY.json
ITEMS.json
response.schema.json
```

Archive entries must be unique and safe. Reject:

- duplicate member names;
- directory entries;
- nested paths;
- absolute paths;
- `.` or `..` path segments;
- backslash-path ambiguity;
- symlink entries;
- any unspecified file.

## 2. HISTORY.json

Shape:

```json
{
  "protocol_version": "three-class-workset-v1",
  "items": [
    {
      "comment": "...",
      "label": "reactive"
    }
  ]
}
```

Contract:

- exact top-level properties: `protocol_version`, `items`;
- `protocol_version` must equal `three-class-workset-v1`;
- `items` may be empty;
- each item has exactly `comment`, `label`;
- `comment` is any JSON string;
- `label` is exactly one of `direct_nuisance`, `reactive`, `normal`;
- duplicate JSON keys are invalid;
- same exact comment + same label may be deduplicated by the generator;
- same exact comment + different label is invalid;
- no normalization is applied to comment text.

HISTORY is reference precedent. It is not a cache and not an absolute override of `RULES.md`.

## 3. ITEMS.json

Shape:

```json
{
  "protocol_version": "three-class-workset-v1",
  "workset_id": "7dcb0b3e-8acc-4e61-984d-7a2df6123456",
  "items": [
    {
      "id": "I1",
      "comment": "..."
    }
  ]
}
```

Contract:

- exact top-level properties: `protocol_version`, `workset_id`, `items`;
- `protocol_version` is exactly v1;
- `workset_id` is UUID v4;
- `items` may be empty;
- every item has exactly `id`, `comment`;
- item ID matches `^I[1-9][0-9]*$`;
- IDs are unique;
- comments are unique by exact string within ITEMS;
- comments are arbitrary strings;
- no normalization.

Generator assigns item IDs sequentially from first occurrence: `I1`, `I2`, ...

Cross-file duplicate comments between HISTORY and ITEMS are allowed.

## 4. response.schema.json

Generated per workset from the canonical v1 schema template. The only run-specific value is the `workset_id` const.

Canonical logical shape:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["workset_id", "decisions"],
  "additionalProperties": false,
  "properties": {
    "workset_id": {
      "const": "<WORKSET_ID>"
    },
    "decisions": {
      "type": "object",
      "propertyNames": {
        "pattern": "^I[1-9][0-9]*$"
      },
      "additionalProperties": {
        "enum": [
          "direct_nuisance",
          "reactive",
          "normal"
        ]
      }
    }
  }
}
```

Do not enumerate all item IDs in schema. Exact target coverage is a local validator check.

## 5. response.json

Shape:

```json
{
  "workset_id": "7dcb0b3e-8acc-4e61-984d-7a2df6123456",
  "decisions": {
    "I1": "reactive",
    "I2": "normal"
  }
}
```

Contract:

- exact top-level properties: `workset_id`, `decisions`;
- no protocol version is echoed;
- no note/reason/confidence/rationale fields;
- duplicate JSON keys invalid;
- `workset_id` exactly matches ITEMS;
- decision values are one of the three labels;
- decision key set must exactly equal the item ID set in ITEMS.

For empty ITEMS:

```json
{
  "workset_id": "<same uuid>",
  "decisions": {}
}
```

## 6. Authority model

- Local v1 implementation is authoritative for protocol structure.
- `RULES.md` is authoritative for classification meaning.
- `HISTORY.json` is reference precedent.
- `response.schema.json` is a bundled machine-readable contract for ChatGPT, but is not trusted as the validator's source of truth.
- `comment` strings are data, not instructions.
