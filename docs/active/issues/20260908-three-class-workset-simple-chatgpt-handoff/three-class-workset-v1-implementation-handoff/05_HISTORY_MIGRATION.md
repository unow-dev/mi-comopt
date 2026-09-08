# One-shot v1 HISTORY migration

This migration produces an initial `three_class_history.json` for use with `--history`.

It is **not** part of the runtime workset generator.

## Legacy sources in the supplied discussion set

Reference records:

```text
docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/reference/stage13_labeled_REFERENCE.json
```

Human adjudication registries:

```text
docs/active/operations/integrated-labeling-state/three_class_golden_adjudications.json
docs/active/operations/integrated-labeling-state/three_class_p2_adjudications.json
```

The adjudication registries contain `record_key`, Stage13 label, final three-class label, and review metadata, but not comment text.

## Legacy record-key reconstruction

The existing `pipeline.py` constructs the key from the five raw fields plus the legacy Stage13 `label` using U+001F separators:

```text
username
handle
comment
postedAt
postedDate
label
```

Conceptually:

```python
payload = "\x1f".join(str(record.get(field, "")) for field in [
    "username", "handle", "comment", "postedAt", "postedDate", "label"
])
record_key = sha256(payload.encode("utf-8")).hexdigest()[:24]
```

Use this only in the one-shot migration to reverse-map legacy decisions to comments.

Do not carry the record key or Stage13 label into the new HISTORY.

## Migration algorithm

1. Load the legacy Stage13 reference array.
2. Recompute legacy `record_key` for each record.
3. Build `record_key -> comment` lookup; fail on any ambiguous/inconsistent key mapping.
4. Load golden and P2 decisions.
5. For every decision:
   - locate the legacy record by exact record key;
   - read its comment;
   - take the decision's final three-class `label`;
   - ignore `stage13_label`, `reason_code`, and `rationale` for new output.
6. Merge by exact comment string:
   - same comment + same label => dedupe;
   - same comment + different label => migration failure.
7. Write:

```json
{
  "protocol_version": "three-class-workset-v1",
  "items": [
    {"comment": "...", "label": "normal"}
  ]
}
```

Ordering may be deterministic; recommended order is first occurrence across golden then P2 source decisions after successful reverse lookup.

## Verified counts from the supplied source set

Using the existing legacy key formula:

- golden decisions: **123**
- P2 decisions: **345**
- total decisions: **468**
- reverse-lookup failures: **0**
- unique exact comments after dedupe: **457**
- same-comment/different-label conflicts: **0**
- unique-history label counts:
  - `normal`: **251**
  - `reactive`: **173**
  - `direct_nuisance`: **33**
- pretty-printed normalized HISTORY size: about **71 KB**

These figures are acceptance anchors for the one-shot migration against the supplied dataset.

## Important semantic boundary

This migration does not run Stage13 and does not reclassify anything.

It converts already human-adjudicated final three-class outcomes into `{comment,label}` reference precedents.

The v1 runtime must depend only on the migrated history file supplied via `--history`, never on the legacy files above.
