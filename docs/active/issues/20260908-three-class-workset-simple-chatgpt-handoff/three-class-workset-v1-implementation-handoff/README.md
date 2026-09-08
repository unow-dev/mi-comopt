# Three-Class Workset v1 — Implementation Handoff

## Status

This handoff is the implementation authority for the MVP discussed in the issue **「ChatGPT向け3-class判定セットを簡素化する」**.

Design choices are closed. The implementer should not re-introduce the old Stage13/single-roundtrip workflow under a different wrapper.

## Goal

Replace the current `three-class-workset` transport with a direct, black-box ChatGPT classification handoff:

```text
selected DB snapshots
        ↓
generate-three-class-workset
        ↓
workset.zip
├── PROMPT.md
├── RULES.md
├── HISTORY.json
├── ITEMS.json
└── response.schema.json
        ↓
ChatGPT
        ↓
response.json
        ↓
validate-three-class-response
        ↓
VALID / INVALID
```

ChatGPT directly derives exactly one of:

- `direct_nuisance`
- `reactive`
- `normal`

There is no upstream `normal / nuisance` classification in the new path.

## Read order

1. `01_FINAL_DECISIONS.md`
2. `02_IMPLEMENTATION_SPEC.md`
3. `03_PROTOCOL_V1.md`
4. `protocol/PROMPT.md`
5. `protocol/RULES.md`
6. `04_VALIDATION_CONTRACT.md`
7. `05_HISTORY_MIGRATION.md`
8. `06_CODE_CHANGE_MAP.md`
9. `07_ACCEPTANCE_TESTS.md`
10. `08_IMPLEMENTER_CHECKLIST.md`

## Source snapshot used for this handoff

The supplied discussion set contains the relevant current implementation under:

- `sources/package/scripts/adapters/three-class-workset.js`
- `sources/package/scripts/comment-database.mjs`
- `sources/package/scripts/pack-three-class-workset.py`
- `sources/package/templates/three-class-workset/README_FIRST.md`
- `sources/package/tests/three-class-workset.test.js`
- `sources/package/src/processing/analysis-input/raw-snapshot-projection.js`
- `sources/docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/...`

The old integrated-labeling package remains legacy code. The new workset path must not depend on it at runtime.

## Definition of done

Implementation is done when all acceptance tests in `07_ACCEPTANCE_TESTS.md` pass and the new generator/validator can run with `pipeline.py` unavailable.
