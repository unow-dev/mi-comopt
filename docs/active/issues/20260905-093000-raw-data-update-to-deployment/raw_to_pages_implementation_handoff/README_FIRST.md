# 実装handoff — 最新raw-dataからGitHub Pagesデプロイまでの継続更新運用

## このhandoffの位置づけ

このZIPは、`ISSUE_BODY.md`「最新raw-dataからGitHub Pagesデプロイまでの更新運用」を実装作業者へ渡すための最終handoffです。

**実装仕様の優先順位は次のとおりです。**

1. このZIP直下の `README_FIRST.md`
2. `docs/IMPLEMENTATION_SPEC.md`
3. `docs/PR_1_LABELING_CONTINUITY.md`
4. `docs/PR_2_JOINT_PUBLICATION.md`
5. `docs/PR_3_CI_AND_BOOTSTRAP.md`
6. `docs/ACCEPTANCE_TESTS.md`
7. `docs/DECISION_LOG.md`
8. `reference_snapshot/` 以下の現行実装・元資料

`reference_snapshot/` は事実確認用のスナップショットです。議論途中の記述や既存運用文書と最終仕様が衝突する場合、**このhandoffの最終仕様を優先**してください。

## 最終的に採択した方向

今回のissueでは、大規模なrelease-management基盤は作りません。既存のStage 13、3-Class、keyword candidate、account candidate、Vite/Pagesの処理を極力そのまま使い、次の欠落だけを閉じます。

1. raw入力を「今回の評価母集団となるauthoritative full snapshot」として扱う。
2. Stage 13は毎回固定baselineへ戻らず、2回目以降は**直前の公開成功runのStage 13出力**をreferenceとして再利用する。
3. 3-Classの人手P0/P1（および明示的にレビューしたP2）を使い捨てCSVで終わらせず、**operational registryへpromotion**して次回runで再利用する。
4. keyword候補とaccount候補を**同じthree-class dataset SHA**から生成する。
5. UIへ反映する8artifactを1つの更新単位として検証する。
6. `package/public/data-release.json` を追加し、raw→Stage13→three-class→keyword/accountの対応を公開状態へ結び付ける。
7. CIでtests + release検証 + buildを通した後だけPagesへdeployし、公開後の`data-release.json`がrepository版と一致することを確認する。
8. runtime contractを`docs/active/issues/...`のlifecycleから切り離し、`package/contracts/`へ恒久配置する。

## 明示的に今回やらないこと

以下は設計上有用ですが、このissueでは実装しません。

- Collectorそのものの実装
- immutable private release archive管理基盤
- byte-exact full replay framework
- correction release / Stage13 correction patch
- 3-Class decision correction/retirement framework
- release ID state machine / sealed phase artifacts
- historical release directory database
- private manifest graph
- disaster-recovery / retention / remote backup設計
- deployment commitを別manifestへ埋め込む仕組み
- candidate change-setを固定した完全byte replay
- implementation PR / release PRを自動分類する大規模release framework

## 実装順

- PR 1: Stage 13継続reference + 3-Class registry promotion
- PR 2: keyword/account joint publication + `data-release.json` + `verify:release` + runtime contract移設
- PR 3: CI/Pages検証 + production bootstrap + 運用文書更新

詳細は各PR仕様を参照してください。

## 完了条件

最新のauthoritative full raw snapshotを入力し、前回判断を再利用しながら必要な新規レビューだけを行い、同一three-class datasetからkeyword/account両候補を生成し、8公開artifactと`data-release.json`をGitへ反映し、CI build/deploy後にPages上の`data-release.json`がrepository版とbyte一致すること。

さらに、公開成功後のStage 13出力を次回用referenceへpromotionでき、次回runの`prepare-stage13`がそれを使えることを確認してissueをcloseします。

## 現在確認済みの基準

- Integrated Labelingの既存テスト: **22 test groupsすべてgreen**
- 現行keyword run ID: `run_bf8163da-cc49-4549-a42a-f02636d4b97c`
- 現行account run ID: `run_3d717ec7-9fe7-4239-9f12-a79dac3279cb`
- 現行keyword/account共通dataset SHA:
  `sha256:b15bf5a4f431e56fb1d5b9e1490b94fbca3950ad596f4db142877c45bb0d95b3`

詳細は `docs/CURRENT_BASELINE.md` を参照してください。
