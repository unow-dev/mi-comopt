# 候補レジストリ・bootstrap・publication・NEW表示を整備する

## Depends on

Child 1。

## Scope ownership

- persistent candidate registry
- UUIDv4 candidate ID
- legacy 187 bootstrap
- category ID migration
- first publication history / introduced_at
- current meta
- `bootstrap_migration` / `local_rebuild`
- publication transaction / optimistic concurrency
- generated artifact reconstruction validation
- App candidate_id / NEW表示
- Child 2 -> Child 3 cutover freeze

## Registry rules

- lifecycle statusは`active/retired`。
- first publication stateは `never_published / published_at_known / published_at_unknown`。
- legacy 187は`published_at_unknown`, `introduced_at=null`。
- metricsはregistryへ保存しない。

## Bootstrap

`reference/bootstrap_candidate_id_map.json` を使用し、187 identity in -> 187 identity outを保証する。semantic add/retire/mergeは禁止。

## Cutover

published JSON schema変更、Appのcandidate_id対応、NEW表示、registry/current meta導入、legacy write path停止を同一cutover unitにする。

Child 2完了後からChild 3完了まではsemantic candidate updateをfail closedする。`local_rebuild`のみ可能。

## Acceptance Criteria

- [ ] registry schemaとcurrent stateを導入。
- [ ] bootstrap source/hash/mapを検証できる。
- [ ] 187 active / 187 published / 0 NEWを満たす。
- [ ] v1.4.0 bootstrap回帰が高42/中11/任意134と一致する。
- [ ] keyword raw exact値がvariantsへ含まれ、candidate内normalized duplicateがない。legacy cross-candidate conflict 1件はgrandfatherされる。
- [ ] published JSONはregistry + evaluation + taxonomyから再生成できる。
- [ ] legacy `direct_nuisance_coverage` を `direct_recall_contribution` へcutoverする。
- [ ] App keyはcandidate_idを使う。
- [ ] NEW pure functionはnull/直後/期限直前/期限ちょうど/期限後をtestする。
- [ ] stale parentでcurrent stateが一切変更されない。
- [ ] publication bundleがatomic。
- [ ] old local generatorがcurrent publicationを書き換えられない。
