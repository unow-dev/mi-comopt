# 一括分類修正の実装・検証結果

## 変更内容

- `classification-correction@2` と `classificationCorrectionBatch@2.0.0` を追加した。4 Capabilityで要求検証、本文グループの一括解決、1 Assessment／1 Proposalの保存、Human承認後の原子的commitを処理する。
- 対象は固定Corpusの本文完全一致グループ。グループ重複、全メンバーの期待ラベル不一致、入力不正、coverage欠損を検出し、部分更新しない。
- ChangeSetは既存の永続operation receiptへ不変保存し、`details.changeSetId` で参照する。全差分・理由・根拠・依存Version・入力fingerprint・分類状態hashを保存し、commit内で再読込・再計算する。
- ControlPlaneの同期transactionを合成可能にした。Assessment＋Proposalは同じtransactionで保存する。Decision、分類Version、全ラベル、Head、commit receipt、業務操作確定receiptも同じtransactionに属し、途中失敗時はすべてrollbackする。
- レビューはRegistryに保存されたHuman Task／成功Execution／actor／resultと照合し、Proposal・Assessment・ChangeSetへ束縛する。入力上のtrustedフラグだけでは承認できない。
- 業務操作IDは最初のSessionへ永続的に対応付ける。別Session IDからの再送でも元Sessionを返し、後続の公開経路を増やさない。Task試行IDとは区別する。
- 後続公開は新Classification Versionと固定Corpusを使う既存の成功枝へ接続した。Promotionの独立したHuman承認、Deploymentのwait／already_deployed、identity検証を維持した。
- ラベル読込SQLはベースラインにある主キー検索＋文字列一致条件を継承した。Snapshot投影と全ラベル読込はresolveで1回、commit再検証で1回行い、グループ件数分は繰り返さない。レビュー表示は保存済みChangeSetから投影する。

## 契約と運用

実行時schemaとbindingの確定版は `package/contracts/classification-correction-batch/`。handoffのreference型草案・チェックサム付き資料は変更せず、ChangeSet参照をdetailsにした差分は確定版へ反映した。

修正配列は代表IDで並べ替えてfingerprintを算出する。ID・本文・理由・provenanceの文字列はそのまま保持する。重複代表IDはhash前に、同一本文の別代表による重複はグループ解決時に拒否する。Classification／CorpusのHead一致を必須とし、policy等は固定Versionの存在・stream帰属・依存一致を検証する。

原子的commitが競合した場合、Decisionもrollbackする。Human Taskの完了結果とExecutionはRegistryに保持され、競合結果がSessionへ返る。commit済みの公開失敗では分類Versionを保持する。

操作手順は [OPERATOR.md](OPERATOR.md) を参照。

## 互換性

| WorkDefinition | 維持した定義hash |
| --- | --- |
| classification-correction@1 | `ed591d63927ebef56db9412d9fdb9a48b39ec6e2f0283aedef9cdedb8b8adabd` |
| comment-data-update@3 | `9598f503ba9a8e8753e0b1d9d1e4af2f1a80a4d10b718aba5ab250840438a726` |
| comment-data-update@4 | `b6e7d6bc04025ea54b4cbe2e8ff221e98f7b9d9a026950e79126915f3c09d1f4` |

## 検証結果

- `npm test`: 227件中226件成功、失敗0件、実データDB指定の必要な1件はskip（下記の独立実行で成功）。新revisionのTemporal試験を含む。
- 最後の検証補強後の一括修正専用13件も全件成功。
- `npm run build`: 成功。
- 一括修正専用テスト: 不正入力、同一本文重複、グループ内期待ラベル不一致、文字列ID、正本／receipt不一致、未認証要求者、無権限Reviewer、偽のレビュー、Proposal／Assessment／ChangeSet改ざん、Head競合、transaction途中失敗、commit応答喪失、再起動後再送を検証。
- 公開経路: 分類とPromotionの別承認、キーワードのreview不要時／必要時、Deploymentのalready_deployed／失敗／Promotion競合／トリガー応答喪失を検証。既存の累積分類・単一修正・旧Sessionの回帰も成功。
- `BATCH_CORRECTION_ACCEPTANCE_DB=var/comment-history.sqlite3 BATCH_CORRECTION_BENCHMARK_LEGACY=1 node --test package/tests/v3-correction-batch-real-data.test.js`: 1件成功。
- `git diff --check` とoperator CLIの構文検証／help表示: 成功。

実データコピーでの測定（Node v24.19.0、同一DBコピー・同一分類Version・44,419ラベル、他の回帰試験と並行実行、数値的な合格閾値は設定しない）:

| 測定範囲 | 実測 |
| --- | ---: |
| 旧CAST文字列JOIN・全件読込 | 191,468.60 ms |
| 改善済み主キーJOIN・全件読込 | 79.68 ms |
| 一括Session開始〜分類レビュー待ち | 1,848.30 ms |
| 保存済みバッチのレビュー表示 | 248.11 ms |
| 分類承認〜commit・キーワードhandoff準備 | 2,108.60 ms |

旧・新JOINの全行（Observation ID、本文、ラベル）は完全一致した。`EXPLAIN QUERY PLAN` は旧方式の `SCAN sco LEFT-JOIN` から `SEARCH sco USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN` へ変わる。ラベル側は両方とも `version_id` のindex検索であり、順序付けにはTEMP B-TREEを使う。

新定義 `classification-correction@2` のhashは `d7e84d39cdd6d9d1be25f130152d9f1b05a5fe039ba4554d1bf0938b8f56e3ff`。

隔離した実データコピーでは正本SHA-256、保存済みhandoffの1,582 IDとの対応、I204の5観測を照合した。25本文グループ・29観測を1 Assessment／1 Proposal／1 Classification Versionへまとめ、全44,419件の分類coverage、対象外ラベル、元Versionの不変性を確認した。変更後分布は `normal=41,427`、`direct_nuisance=1,246`、`reactive=1,746`。

キーワード更新、別途のキーワードレビュー、Release、独立したProduction Promotion承認、Deployment Request、identity検証、状態記録を同じSessionで完了し、ReleaseとDeployment Requestの増分はいずれも1件。別Session IDから再送しても増えない。

実データ元DBはreadOnly接続からSQLite backupで複製した。更新は一時コピーだけで行い、元DBの全Headが変化していないことを確認した。実運用Sessionの開始・承認・GitHub公開は行っていない。
