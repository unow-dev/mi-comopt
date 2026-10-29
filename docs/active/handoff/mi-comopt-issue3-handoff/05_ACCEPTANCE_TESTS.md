# 05 受け入れテスト・反例

全て**隔離されたテストDB/Workspace**で行う。Issueのproduction IDは照合参照として用い、現在のproductionへcommitしない。

## 正常系

| ID | 条件 | 期待結果 |
|---|---|---|
| P01 | CorrectionItem 1件 | 1グループを含む1 Proposal、1 Decision、最大1 Classification Version |
| P02 | Issue #3の25件入力 | 25グループ→29観測、Proposal/Assessment各1件、全件同時に確定 |
| P03 | I204の代表45921 | `45921,46365,46445,46935,47243`の5件が同じ変更として扱われる |
| P04 | 元の分類Version 12を基準 | 総数44,419、`normal=41,427`、`direct_nuisance=1,246`、`reactive=1,746` |
| P05 | 既存の対象外全Observation | ラベルが1件も変化しない、coverageが完全 |
| P06 | 分類承認→後続成功 | 新ClassificationVersionが後続に渡される。Keyword・Release・Promotion・Deploymentが1経路 |
| P07 | Promotionで別Human承認 | 分類承認だけではProduction Promotionが進まない |
| P08 | Deployment完了 | Release・Promotion・Deployment identityが一致し、recordは1つ |

## 入力不正・改ざん

| ID | 注入する異常 | 期待結果 |
|---|---|---|
| N01 | 空配列、空理由、無効ラベル | invalid。分類Head・公開成果物は不変 |
| N02 | `expectedLabel === replacementLabel` | invalid |
| N03 | 未知の代表Observation / survivorでない対象 | invalid |
| N04 | 同一本文グループを別代表IDで重複指定 | invalid。重複が同じ変更でも禁止 |
| N05 | 同一本文グループへ異なるラベルを指定 | invalid。部分成功なし |
| N06 | グループ中1件だけ期待ラベル不一致 | invalid。グループ内部分変更なし |
| N07 | `"a"`と`" a"`、NFKC前後、改行違い | 別グループであり拡張しない |
| N08 | Observation ID `"001"`と`"1"` | 文字列IDの同一視をしない |
| N09 | handoffのI番号とreceipt対応が不一致 | provenance検証失敗 |
| N10 | Proposal・Assessment・ChangeSetのhash改変 | commit不可。Head不変 |
| N11 | 無権限要求者・無権限Reviewer | 処理を拒否。偽装actorを受容しない |

## 競合と復旧

| ID | 条件 | 期待結果 |
|---|---|---|
| C01 | Proposal後に別操作がClassification Headを進める | superseded。部分更新/公開なし |
| C02 | Proposal後にCorpus Headが進む | superseded。部分更新/公開なし |
| C03 | Commit前の再検証後に並行更新 | 単一transaction/CASで競合検出、部分更新なし |
| C04 | Human Review拒否 | Decision rejected、Head不変、公開へ進まない |
| C05 | commit直後・Task receipt記録前にプロセス停止 | 再送で同じVersionを取得、新Version増加なし |
| C06 | 同じ業務操作ID・同一fingerprintを別Sessionで送信 | Proposal/Version/Release/Requestを重複作成しない |
| C07 | 同じ業務操作ID・異なるfingerprintを送信 | `IDEMPOTENCY_CONFLICT`、既存成果物不変 |
| C08 | Deployment Request作成直後に停止→再開 | 同一Requestを再利用、2回トリガーしない |
| C09 | `superseded`/`deployment_failed`各分岐 | 後続のverify/record/公開を誤実行しない |
| C10 | Keywordでreview不要（unchanged/committed） | 不存在のHuman TaskやProposalに依存せず後続成功 |
| C11 | `already_deployed` | Event Waitなしでidentity検証へ進む |

## 旧契約回帰

| ID | 対象 | 期待結果 |
|---|---|---|
| R01 | `classification-correction@1` | 定義hash `ed591d63927ebef56db9412d9fdb9a48b39ec6e2f0283aedef9cdedb8b8adabd` 不変 |
| R02 | `comment-data-update@3/@4` | 定義hash・Session入力・結果が不変 |
| R03 | 新規コメント分類 | 既存の処理・累積ラベル継承が動作 |
| R04 | label read query | 最適化前後で分類Version内のラベル列が完全一致 |

## 観測と記録

記録: 各Stepの`stateResult`/routing outcome、Proposal・Decision・Version ID、Head、Classificationラベルの差分、Release/Promotion/Deployment Requestの件数、Deployment identity、開始/レビュー表示/commitの時間、`EXPLAIN QUERY PLAN`。

**時間の数値的な合格閾値はIssueで指定されていない**。勝手に閾値を設けず、比較条件と実測値を報告する。
