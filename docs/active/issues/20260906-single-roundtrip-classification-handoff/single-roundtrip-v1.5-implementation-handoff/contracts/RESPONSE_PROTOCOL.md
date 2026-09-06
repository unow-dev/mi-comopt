# Response protocol summary

Canonical response:

```json
{
  "schema_version": 1,
  "request_id": "<64hex>",
  "stage13_decisions": {
    "S000001": {"label": "normal", "note": "..."}
  },
  "three_class_decisions": {
    "T000001": {"reason_code": "normal_context", "note": "..."},
    "T000002": null
  }
}
```

Rules:

- every S task: object, never null
- every potential T task: key always present
- active T: object
- inactive T: null
- `note`: string with non-whitespace content
- no additional keys in decision objects
- strict duplicate JSON key rejection
- response `request_id` must exactly match workspace request
- Three-Class final label is derived from reason code, not supplied by reviewer

Reason mapping:

| reason_code | label |
|---|---|
| direct_target | direct_nuisance |
| mixed_target | direct_nuisance |
| spam | direct_nuisance |
| anti_target | reactive |
| support_reaction | reactive |
| meta_reaction | reactive |
| quoted_attack | reactive |
| normal_context | normal |
