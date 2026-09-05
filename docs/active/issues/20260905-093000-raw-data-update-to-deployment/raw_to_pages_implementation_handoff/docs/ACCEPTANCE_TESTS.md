# Acceptance Tests

## A. Existing regression

- [ ] Integrated Labeling既存22 test groupsすべてgreen。
- [ ] Node既存test suiteが実リポジトリでregressionなし。
- [ ] `npm run build`成功。

## B. Raw contract

- [ ] top-level array以外reject。
- [ ] exact 5 fields以外reject。
- [ ] 5 field値がstring以外ならreject。
- [ ] 重複5-field rowを勝手にdedupしない。
- [ ] release generatorがraw record countとbyte SHAを正しく記録。

## C. Stage 13 continuity

- [ ] run1で新規reviewを含むStage13 outputを生成。
- [ ] run1 outputをrun2 referenceとしてprepare。
- [ ] run1と同一recordsはexact reuseされる。
- [ ] run2で`validate --reference <run1 output>`がpass。
- [ ] `validate`だけbaselineへ戻す誤運用をrunbook/testで防ぐ。
- [ ] deploy前にはoperational referenceを更新しない。
- [ ] release record Stage13 SHAとsource Stage13 SHA不一致ならpromotion失敗。

## D. 3-Class registry promotion

- [ ] operational baseline registryがloaderを通る。
- [ ] P0/P1 review CSV 4 columnsをpromotionできる。
- [ ] promotion後、manual overrideなしstrict finalでmandatory=0になる。
- [ ] invalid reason_code reject。
- [ ] label/reason_code mismatch reject。
- [ ] unknown record_key reject。
- [ ] golden/P2 overlap reject。
- [ ]既存同keyを異なるdecisionへ変更しようとするとreject。
- [ ] decision orderがrecord_key sortで安定。
- [ ] free-text noteがpublic rationaleへそのまま入らない。
- [ ] P2対象でないpriority-2をP2 registryへ入れられない。

## E. Keyword lineage

- [ ] parent manifest run ID mismatch reject。
- [ ] parent registry SHA mismatch reject。
- [ ] new run manifest parent_manifest_content_sha256がnon-null。
- [ ] current candidate IDs/historyが維持される。

## F. Joint publication

- [ ] keywordとaccountが同一three-class SHAなら成功。
- [ ] accountへ旧keyword metaを渡すとdataset mismatchで失敗。
- [ ]公開対象が8artifact exact set。
- [ ] candidateWorkflowConfig等が通常data updateで変化しない。

## G. data-release.json

- [ ] generatorがactual raw/Stage13/reference/three-classからSHAを計算。
- [ ] keyword run ID/published_atをcurrent meta/manifestから取得。
- [ ] account run ID/published_atをcurrent meta/manifestから取得。
- [ ] `three_class.sha256 == keyword.dataset_sha256 == account.dataset_sha256`。
- [ ] verify-releaseで改ざんkeyword metaを検出。
- [ ] verify-releaseで改ざんaccount metaを検出。
- [ ] verify-releaseで改ざんrelease recordを検出。

## H. Runtime contracts

- [ ] canonical keyword policy/taxonomyが`package/contracts/keyword-candidates/`に存在。
- [ ] canonical account policyが`package/contracts/account-block-candidates/`に存在。
- [ ] scripts/testsがactive issue contract pathへ依存しない。
- [ ] contract content/hash semanticsが現行artifactと互換。

## I. CI / Pages

- [ ] PRでtests + verify:release + buildが走る。
- [ ] PRからPages deployしない。
- [ ] mainでvalidation成功後だけdeploy。
- [ ] deploy後`data-release.json` HTTP 200。
- [ ] deployed bytes == repository/build bytes。
- [ ] mismatch時workflow fail。

## J. End-to-end bootstrap

- [ ] authoritative full rawを用意。
- [ ] Stage13 bootstrap referenceを明示。
- [ ] Stage13 final成功。
- [ ] operational 3-Class registry promotion成功。
- [ ] three-class final unresolved mandatory 0。
- [ ] keyword publication成功。
- [ ] account publication成功。
- [ ] shared dataset SHA gate成功。
- [ ] 8artifact + data-release commit。
- [ ] CI green。
- [ ] Pages deploy成功。
- [ ] deployed release record一致。
- [ ] Stage13 reference promotion成功。
- [ ] 次回prepareがpromoted referenceを読める。

このJが全て通った時点をissue close条件とする。
