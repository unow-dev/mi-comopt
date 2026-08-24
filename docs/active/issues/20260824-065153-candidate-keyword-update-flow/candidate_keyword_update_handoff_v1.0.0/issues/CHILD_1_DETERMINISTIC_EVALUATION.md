# 候補キーワードの決定的評価基盤を整備する

## Depends on

なし。

## Scope ownership

- normalization / matching
- evaluation policy 1.0.0
- category taxonomy 1.0.0
- D/R/N metrics
- recommendation / publication eligibility
- deterministic sorting / rounding
- JSON schemasの共通基盤
- evaluator + validator基盤
- golden fixtures
- JCS content hashing / deterministic formatter

## Required behavior

- 3-class inputは `direct_nuisance/reactive/normal` のみ。
- reactiveはreference-only。
- active candidate全件を同一datasetに対して評価。
- precision thresholdは丸め前の整数比で判定。
- `D=0,N=0` precisionはnull。
- published eligibilityはD>=1。
- evaluation artifactはcandidate_id昇順、UI published JSONはpolicy sort順。

## Acceptance Criteria

- [ ] `policy/evaluation/1.0.0.json` とschemaを導入。
- [ ] `policy/taxonomy/1.0.0.json` とschemaを導入。
- [ ] normalization vectorsが通る。
- [ ] recommendation boundary fixturesが通る。
- [ ] reactiveだけを増減してもprecision/utility/recommendationが変わらないtestがある。
- [ ] comment内複数matchでも1hitである。
- [ ] rateを最大6桁half-evenでserializationする。
- [ ] total orderingが決定的である。
- [ ] dataset consumer validationが上流labeling判定ロジックを複製しない。
- [ ] current production candidate JSONのwrite pathはこの子Issueでは変更しない。
