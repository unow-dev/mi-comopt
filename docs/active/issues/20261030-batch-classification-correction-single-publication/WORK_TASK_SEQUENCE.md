# Work Task Sequence: 分類修正の一括承認と1回の公開

## Purpose

複数の分類修正を1つのSessionでレビュー・承認し、全修正を保持した1つのClassification Versionを基点として、後続更新とproduction公開を1回だけ進められる。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、一括修正と公開回数に関する決定済みの要求を整理する。
- [x] 2. 運用中の修正Sessionの範囲で、AIエージェントが、開始済みSessionを監査履歴を保持して終了する。
- [ ] 3. 既存実装の範囲で、AIエージェントが、単一修正と後続公開の仕組みおよび作業ツリーの変更影響を確認する。
- [ ] 4. 一括修正の仕様整理の範囲で、AIエージェントが、入力検証・承認・競合・互換性について実装前に満たすべき条件を整理する。
- [ ] 5. 必要最小限の変更範囲で、AIエージェントが、複数修正の一括反映と後続公開の1回実行を可能にする変更を行う。
- [ ] 6. 分類ラベルの読込とレビュー表示の範囲で、AIエージェントが、照合の正確性を維持して処理時間を改善する。
- [ ] 7. 検証範囲で、AIエージェントまたはCIが、一括修正・監査・失敗時の停止・公開回数・再実行・既存フローへの影響を確認する。
- [ ] 8. 作業結果の範囲で、AIエージェントが、実施内容・確認結果・運用再開に必要な手順を記録する。

## Work Notes

- 2026-10-30（JST）、ユーザーは差分25本文グループ・29観測をまとめて修正し、最後に1回公開するための実装修正Issueの作成を指示した。今回の作業は旧Sessionの終了とIssue作成までで、一括修正の実装は未着手。
- 要求・完了条件・修正対象一覧は [ISSUE_BODY.md](ISSUE_BODY.md) に記載した。正本は [response (3).json](<../../handoff/response (3).json>)。SHA-256は `ccbca9c459ab7dc564d499e1dd2b8db151819d8d5324b5e76b331998e4c6289b`。
- I番号は同一Worksetの永続化済みhandoff receiptに対応付けている。正本とhandoffの1,582 IDが一致し、差分25本文グループ・29観測、変更方向がすべて `normal` → `direct_nuisance` であることを読み取り専用で再確認した。
- Session `production-classification-correction-20261030-response3-I204-447206f4-94a7-4d91-9715-eaaa7754c48a` は公式runtimeの `cancelSession` により `cancelled` となり、レビュータスクも `cancelled` になった。
- Proposal `proposal_9640d677afeda0cab9413a152d2f9523` とAssessment `assessment_9640d677afeda0cab9413a152d2f9523` は保存され、Decisionは存在しない。Classification Headは `version_67c4dfa11ecb223a5f41d1c92c67dcb8` のまま、このSessionのDeployment Requestは0件である。
- 既存の実装変更とラベル読込SQLの改善差分が未コミットで存在する。新規の実装作業では現行差分を確認し、登録済み定義と既存Sessionの契約を維持する。
- 新しい一括修正Sessionの再開始とproduction公開は実装修正後のユーザー指示に従う。追加の仕様判断が必要になった場合はここに記録し、人間が判断する。
- Issue本文と作業タスク列の相対リンク、チェックリスト形式、対象25グループ・29観測の件数、正本hashを確認した。Sessionの終了状態・監査情報の保持・Head維持・Deployment Request 0件を保存済みデータから再確認し、`git diff --check` も成功した。
- 2026-10-30（JST）、ユーザー指示により [GitHub Issue #3](https://github.com/unow-dev/mi-comopt/issues/3) として登録した。リポジトリ内の参照は本文中のパス表記にし、先行Issue #2へのリンクを設定した。作業タスク列はIssue本文に含めず本ファイルで管理する。登録済み本文が準備した内容と一致し、状態がopenであることを確認した。
