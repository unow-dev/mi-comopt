# Bootstrap Migration

## 目的

legacy `filterKeywordCandidates.json` の187 candidate identityを意味変更せず新registryへ移す。

Reference source:
- `reference/legacy_filterKeywordCandidates.json`
- raw SHA-256: `ce1baa51f927782496f617907880dd0c1442ddf5a2b8700746baa9b0f3879095`

## 禁止

bootstrap中にLLM判断、candidate add/retire/merge、semantic category変更を行わない。

## Candidate ID

`reference/bootstrap_candidate_id_map.json` に一度発行済みのUUIDv4を固定している。実装時はこのmapをそのまま使用できる。

per-entry semantic hashはlegacy candidateの `keyword`, `variants`, `category` だけをJCS化したSHA-256。indexだけでなく内容一致も検証する。

## Structural canonicalization

migrationでは次のみ許可する。

- `candidate_id`付与
- legacy category labelをtaxonomy `category_id`へ対応付け
- raw exact `keyword` をvariantsへ追加
- normalized duplicate variant除去
- canonical variant順へ並び替え
- metricsをv1.4.0 3-class dataset + evaluation policy 1.0.0で再計算
- field rename (`direct_nuisance_coverage` -> `direct_recall_contribution`)

これらはcandidate identity変更ではない。

## First publication history

全legacy候補:

```json
{
  "first_publication_state": "published_at_unknown",
  "introduced_at": null
}
```

よってbootstrap直後のNEW表示は0件。

## Regression baseline

`reference/bootstrap_expected_summary.json` を参照。期待値:

- legacy candidates: 187
- active registry candidates: 187
- published candidates: 187
- suppressed: 0
- v1.4.0 labels: D=549 / R=1225 / N=19659
- recommendation: 高推奨=42 / 中推奨=11 / 任意=134
- legacyのkeyword未包含variants: 5件
- structural variant canonicalization対象: 28件

per-candidate expectationは `reference/bootstrap_expected_evaluation.json` と `reference/bootstrap_expected_filterKeywordCandidates.json` に保存している。

Legacy cross-candidate normalized conflictは1件あり、`reference/bootstrap_known_cross_candidate_variant_conflicts.json` に固定している。bootstrapでは解消を強制しない。
