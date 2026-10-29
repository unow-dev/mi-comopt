# Issue: 分類修正を一括承認し、最後に1回公開できるようにする

作成日: 2026-10-30（JST）

GitHub Issue: [#3](https://github.com/unow-dev/mi-comopt/issues/3)

状態: 実装修正待ち（単一修正Sessionは終了済み）

## 目的

複数の分類修正を1つのSessionでレビュー・承認し、1つのClassification Versionにまとめて反映したうえで、後続の更新とproduction公開を1回だけ行える状態にする。

## 背景

現行の `classification-correction@1` は、指定Observationと完全一致するコメント本文のグループを1つだけ修正する。分類承認後は、そのSessionからキーワード更新、Release、production Promotion、Deploymentへ進む。この経路を修正対象ごとに最後まで進めると、対象ごとに公開処理が発生する。

今回、ユーザーが正と指定した [response (3).json](<../../handoff/response (3).json>) と現行分類を照合し、25本文グループ・29観測の差分を確認した。ユーザーは、この差分をまとめて修正し、最後に1回公開する運用を選択した。本Issueは、先行の単一修正実装に対する追加仕様と実装修正を扱う。

## 要求

### 一括修正と承認

- 1件以上の修正要求を1つのSessionで受け取り、共通のbase Classification、Corpus、分類policyのVersionに固定する。
- 各修正について、対象Observation、期待する現行ラベル、修正後ラベル、理由、要求者を監査可能にする。今回の正本JSONとI番号の対応も追跡できるようにする。
- 修正範囲は、固定されたCorpusのsurvivorのうち、対象とコメント本文が完全一致する全観測とする。本文のtrimや正規化で対象を広げない。
- 全修正を集約したAssessmentとProposalを作成し、レビューでは各修正の本文、変更前後のラベル分布、影響件数、理由と、全体の変更件数を確認できる。
- バッチ全体を承認または却下する。承認時に1つの新しいClassification Versionを作成し、却下時はClassification Headを進めない。
- 不明な対象、無効なラベル、空の理由、変更のない修正、同一本文グループの重複指定・矛盾、期待ラベルの不一致を検出する。1件でも成立しない場合は、部分的なClassification更新を行わない。
- commit直前にもbase Classification Head、Corpus Head、依存Version、全修正の対象・差分、Assessment、semantic hashを再検証する。競合時に一部の修正だけを反映しない。
- 対象外のラベル、全survivorの分類coverage、既存Versionの不変性を維持する。

### 後続更新と1回の公開

- バッチ全体のClassification commitが成立した場合だけ、集約したVersionをpinして既存のキーワード更新、Release、production Promotion、Deployment経路へ1回進む。
- 本文グループごとの中間Classification Version、Release、Promotion、Deployment Requestを作成しない。
- production Promotionの人間による承認とdeployment identity検証を維持する。再実行・再送時にも同じ操作によるVersionやDeployment Requestを重複作成しない。
- 却下、入力不正、head競合では後続のRelease・公開処理へ進まない。

### 版管理と既存機能

- 新しい入力契約とWorkDefinitionを版管理し、登録済みの `classification-correction@1` を上書きせず新revisionとして追加する。既存Sessionの入力や定義を途中で変更しない。
- `classification-correction@1` の定義hash `ed591d63927ebef56db9412d9fdb9a48b39ec6e2f0283aedef9cdedb8b8adabd` を維持する。
- 既存の `comment-data-update@3` / `@4`、新規コメント分類、累積ラベル継承、既存単一修正の契約を維持する。
- operatorから一括修正を開始し、レビュー対象と全体の変更内容を確認できるようにする。

### ラベル読込と処理時間

単一修正Sessionの開始とレビュー情報表示では、`readClassificationVersionLabels()` のJOINが各ラベルに対してObservation表を全走査する計画になり、数分かかった。レビュー表示もcommit preflight相当の再検証を行うため、同じ読込が繰り返された。

Issue作成時の作業ツリーには、Observationの主キー検索と従来の文字列一致条件を併用する未コミットの改善差分がすでに存在する。この差分を引き継ぎ、結果の互換性、query plan、実データ規模での処理時間を確認する。改善済みの部分を重複実装せず、一括修正で同じCorpus投影やラベル全件読込を修正件数分繰り返さないようにする。

## 実装・確認の対象範囲

| 範囲 | 確認・修正する内容 |
| --- | --- |
| Session入力契約・Version解決 | 複数修正、版ごとの検証、共通の固定Version、要求者の認証 |
| 分類修正の計算・Application Service | 全修正を集約した状態、重複・矛盾検出、Assessment・Proposal・監査情報 |
| 承認・commit preflight | バッチ全体の再検証、1つのVersionへの反映、競合時の停止 |
| WorkDefinition・runtime・operator | 新revisionの登録・起動、全体レビュー、後続経路の1回実行 |
| ラベル読込・レビュー表示 | 主キー検索、文字列IDの照合互換性、繰り返し読込の抑制 |
| 回帰・E2E検証・運用文書 | 既存定義の不変性、承認・却下・競合・再実行、1回公開の確認 |

## 今回の修正対象と期待結果

以下はIssue作成時の照合結果である。実行再開時には、正本のhashと現行Headを再照合する。

- 正本: [response (3).json](<../../handoff/response (3).json>)
- 正本SHA-256: `ccbca9c459ab7dc564d499e1dd2b8db151819d8d5324b5e76b331998e4c6289b`
- Workset ID: `809c68f0-7345-44c4-af1c-24a11c9b9018`
- I番号の対応元: `production-comment-data-update-20261028T221851Z-codex/03a-prepare-classification-handoff` の永続化済みreceiptに含まれる `classificationPlan.handoffItems`。単純な行番号から推測しない。
- Base Classification: Version 12 / `version_67c4dfa11ecb223a5f41d1c92c67dcb8`
- Corpus: `version_9ae43beeb67a924bdd62dc837b50d734`
- Classification policy: `policy_9473a17cbcabc21d56e44fc5b8b63c7e`
- 正本の1,582判断とhandoffのID集合は一致し、1,557判断は現行と一致した。残る25本文グループ・29観測はすべて `normal` から `direct_nuisance` への修正である。

| I番号 | 代表Observation ID | 対象観測数 |
| --- | --- | --- |
| I204 | 45921 | 5 |
| I205 | 45922 | 1 |
| I221 | 45945 | 1 |
| I323 | 46076 | 1 |
| I349 | 46105 | 1 |
| I581 | 46432 | 1 |
| I594 | 46450 | 1 |
| I629 | 46493 | 1 |
| I675 | 46555 | 1 |
| I702 | 46595 | 1 |
| I712 | 46608 | 1 |
| I733 | 46633 | 1 |
| I739 | 46640 | 1 |
| I745 | 46646 | 1 |
| I760 | 46662 | 1 |
| I770 | 46672 | 1 |
| I771 | 46673 | 1 |
| I959 | 46937 | 1 |
| I1041 | 47029 | 1 |
| I1206 | 47214 | 1 |
| I1222 | 47231 | 1 |
| I1252 | 47271 | 1 |
| I1433 | 47514 | 1 |
| I1438 | 47523 | 1 |
| I1454 | 47575 | 1 |

I204の本文は「うおwかっかー.」。対象Observation IDは `45921`、`46365`、`46445`、`46935`、`47243` の5件である。

このbaseに全修正を反映した場合、全44,419観測のラベル件数は次の値になる。

| ラベル | 現行 | 修正後 |
| --- | --- | --- |
| normal | 41,456 | 41,427 |
| direct_nuisance | 1,217 | 1,246 |
| reactive | 1,746 | 1,746 |

## 完了条件

- 単一修正と複数修正を新しい入力契約で扱え、25本文グループ・29観測を1つのProposalでレビューできる。
- 承認で1つのClassification Versionだけが作成され、対象29観測の変更と対象外ラベル・全44,419観測のcoverage維持を確認できる。
- 却下、入力の一部不正、同一グループの重複・矛盾、Classification／Corpus Head競合、Proposal／Assessment改変で部分更新や公開が発生しない。
- 隔離環境のE2Eで、集約したClassification Versionを使うキーワード更新・Release・Promotion・Deployment Requestが各1経路で実行され、最終identityが一致する。
- 操作の再試行・再送によりClassification Version、Proposal、Release、Deployment Requestが重複しない。
- 登録済みのWorkDefinition hashと既存Sessionの挙動、新規コメント分類と累積ラベル継承が維持される。
- ラベル読込の結果互換性と主キー検索を確認し、44,419ラベル規模で開始・レビュー表示・commitの所要時間とquery planを記録する。
- 変更内容、検証結果、一括修正の開始・レビュー・公開手順を記録する。

本Issueの実装検証は隔離環境で行う。実運用の一括修正Sessionの再開始、Human Taskの承認、production公開は、その時点のユーザー指示に従う。

## 終了した単一修正Session

2026-10-30（JST）、ユーザー指示によりWork Orchestratorの `cancelSession` で終了した。

- Session ID: `production-classification-correction-20261030-response3-I204-447206f4-94a7-4d91-9715-eaaa7754c48a`
- Session状態: `cancelled`
- `03-correction-propose`: `completed`
- `05-review-classification`: `cancelled`
- Proposal: `proposal_9640d677afeda0cab9413a152d2f9523`（保存済み）
- Assessment: `assessment_9640d677afeda0cab9413a152d2f9523`（保存済み）
- Proposalに対するDecision: なし
- Classification Head: Version 12のまま
- このSessionのDeployment Request: 0件
- 終了理由には本Issueのディレクトリを記録した。

このSessionとProposalを一括修正に再利用せず、実装修正後は新しい入力契約による別Sessionを開始する。

## 関連文書・実装

- [作業タスク列](WORK_TASK_SEQUENCE.md)
- [先行の単一分類修正Issue](../20261029-manual-individual-classification-correction/ISSUE_BODY.md)
- [入力契約](../../../../package/src/workflow/v3/contracts.js)
- [Session入力の解決](../../../../package/src/workflow/v3/session-input.js)
- [WorkDefinition](../../../../package/src/workflow/v3/definitions.js)
- [分類修正Application Service](../../../../package/src/application/v3/correction-service.js)
- [分類修正の状態計算](../../../../package/src/three-class/classification-correction.js)
- [ラベル読込](../../../../package/src/database/three-class-label-repository.js)
- [operator](../../../../package/src/integration/v3-operator.js)
