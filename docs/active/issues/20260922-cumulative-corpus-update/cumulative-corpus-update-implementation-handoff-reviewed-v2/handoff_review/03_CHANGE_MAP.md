# Change Map

## Primary change targets

| File / Area | Required change |
|---|---|
| `src/application/v3/domain-services.js` | Corpus v2 cumulative transition、classification plan利用、complete classification state生成 |
| `src/application/services.js` | `typedCorpusHandler()` snapshot ref canonical serialization |
| `src/database/raw-snapshot-repository.js` | observationId露出、reference-order reader |
| `src/database/three-class-label-repository.js` | pinned ClassificationVersion限定label reader |
| `src/processing/analysis-input/raw-snapshot-projection.js` | cumulative first-win projection追加 |
| `src/three-class/label-resolution.js` | 既存`worseThreeClassLabel()`ルールを再利用。意味変更しない |
| `src/three-class/cumulative-classification-plan.js` | 新規推奨。classification planのpure authority |
| `scripts/comment-data-update-v3-operator.mjs` | single snapshot handoff前提撤去、recovery CLI surface |
| `src/integration/v3-operator.js` | normal start preflight: schema v1 corpus headをsession作成前に`CORPUS_BOOTSTRAP_REQUIRED` |
| `scripts/adapters/keyword-candidate-comment-db.js` | Source Dataset v2 / cumulative corpus対応 |
| `src/processing/optimicom-ui-release/source-dataset.js` | v2 schema、single snapshot制約撤去 |
| `src/processing/optimicom-ui-release/release.js` | v2 source/manifest整合 |
| `scripts/export-v3-optimicom-ui-release.mjs` | exactly-one-snapshot制約撤去、v2 export |
| `src/application/v3/release-services.js` | cross-pin gate、artifact override撤去 |
| `src/migration/v3-cutover.js` | `recovery_frozen` state、`recovery_freeze` / `recovery_cancelled` / `recovery_completed` transitions、通常`fix_forward_v3`との分離 |
| deployment adapter / deployed-release verifier | served manifest + comments/keywords/accounts/overviewのread-back検証。既存provider verifierを再利用、足りなければinterface拡張 |

## Tests to extend

| Existing test | Focus |
|---|---|
| `tests/raw-snapshot-database.test.js` | reference order / observationId |
| `tests/raw-snapshot-analysis-input.test.js` | cumulative projection / dedupe |
| `tests/comment-db-state.test.js` | Corpus v2 persistence / ref serialization |
| `tests/v3-acceptance-services.test.js` | cumulative state / classification / release dependency gates |
| `tests/v3-handoff-integrity.test.js` | ChatGPT safety assertion / handoff identity |
| `tests/keyword-candidate-comment-db.test.js` | Source Dataset v2 keyword input |
| `tests/optimicom-ui-release.test.js` | Source Dataset v2 / release artifacts |
| `tests/v3-cutover.test.js` | `recovery_frozen` / stale-plan / completion receipt / `fix_forward_v3`拒否 |
| `tests/v3-operator.test.js` | no single snapshot operator path、schema v1 corpus headをsession作成前に拒否 |

## New test recommended

```text
tests/v3-cumulative-corpus-update.test.js
```

Issue固有のend-to-end invariantのみを集約する。

## Do not change unless required by compilation

- workflow v3 step structure
- workflow revision
- existing projection-definition policy semantics
- raw snapshots themselves
- existing legacy three-class CLI behavior
- DB table shape solely for this issue（recovery stage authorityは既存`application_operation_receipts`を使用）

## Legacy areas intentionally retained but removed from v3 authority

- `three_class_worksets`
- `three_class_workset_snapshots`
- `snapshot_comment_three_class_labels`
- DB-global `readExistingCommentLabels()` path
- legacy source dataset v1 verifier
