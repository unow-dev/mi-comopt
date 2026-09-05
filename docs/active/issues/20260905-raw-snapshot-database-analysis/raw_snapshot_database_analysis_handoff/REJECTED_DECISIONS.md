# Rejected / superseded decisions

This file is normative: **do not implement these ideas as part of this issue**, even if they appear in earlier discussion notes.

## 1. Legacy baseline in Comment DB

Rejected:

```text
stage13_baseline_imports
stage13_baseline_records
import-stage13-baseline
```

Reason: old/new 5-field integration already belongs to the dedicated current+incoming integration issue. Putting Stage13/legacy integration into this DB issue expands scope and couples DB to a processing stage.

## 2. Cross-snapshot dedupe in export

Rejected:

- five-field occurrence-ordinal union
- commentId collapse
- representative observation selection
- max multiplicity logic

Reason: `export-analysis-input` is a faithful selected-snapshot projection. Merge/dedupe belongs downstream.

## 3. Auto-select latest/all snapshots

Rejected. Snapshot set must be explicit SHA inputs.

## 4. Timestamp-derived export ordering

Rejected:

- `extracted_at_epoch_ms`
- `Date.parse(extractedAt)` as a second contract
- forced `YYYY-MM-DDTHH:mm:ss.sssZ`

Final ordering is snapshot SHA ascending. Raw `extractedAt` keeps schema v1 `format: date-time` semantics only.

## 5. Export depending on raw store

Rejected. Export reads DB only. Raw integrity is a separate `verify-raw-store` concern.

## 6. Full account/user master

Rejected. Top-level author gets identity-only `authors`; comment `userId` is observation-only. Do not assume `author.id` and comment `userId` share an identity namespace.

## 7. Author profile duplication

Rejected in v2. username/nickname/secUid/signature/avatar/profile stats remain raw-only.

## 8. Invented semantic restrictions

Rejected:

- nonnegative checks not present in raw schema
- trimming identifiers
- whitespace-only ID -> NULL conversion
- guessing missing dates
- `reportedCount >= loadedCount`

## 9. Generic shape-detecting import

Rejected. Existing `import` and new `import-raw-snapshot` are explicit commands with distinct hash/contracts.

## 10. DB direct access from processing/UI

Rejected. DB repository returns plain records; pure projection operates without SQLite; downstream remains file/artifact-driven.
