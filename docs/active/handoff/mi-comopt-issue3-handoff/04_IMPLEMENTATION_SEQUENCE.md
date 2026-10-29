# 04 実装タスク列

以下は実装担当者の作業順序。GitHub Issueの本文・既存契約を優先し、本書の設計草案と食い違う場合は意図を確認して整合を取る。各段階の成果物は機能・契約・テストを合わせて扱う。

## A: 現行コードとローカル差分の把握

- [ ] `main`と作業ブランチの差分を確認。Issue記載の`correction-service.js`、`classification-correction.js`、`WORK_TASK_SEQUENCE.md`が別ブランチ/未コミット差分にあるか確認。
- [ ] 既存`classification-correction@1`の実際の登録経路と定義hashを確認。存在しない場合は欠けている前提として報告し、代用実装を推測しない。
- [ ] `comment-data-update@3/@4`のRegistryレコードとテストを収集。
- [ ] 既存`StateControlPlane`のcommit・Receipt・Head更新の原子性を把握。

## B: 新Session Inputと認証

- [ ] `classificationCorrectionBatch`新契約をJSON Schemaとして追加。1件以上、必須fields、pin、target、provenanceを規定。
- [ ] Version IDのストリーム帰属・存在・必要なHead一致を検証。
- [ ] 認証済み要求者の取得と、入力上のclaimとの照合を定義。未認証の`requester`を信用しない。
- [ ] 操作ID/入力fingerprintの安定化（入力順や任意情報の意味を明文化）。異なる内容の同一操作IDを拒否。
- [ ] Session開始APIとoperatorの新WorkDefinition選択を追加。既存の開始APIは変更しない。

## C: Domain処理と共通Snapshot読込

- [ ] 共通Snapshot読込（固定Corpusのsurvivor全件+固定ClassificationVersionのlabels全件）を1回に集約。
- [ ] 代表Observationの存在とsurvivor帰属、本分完全一致グループを解決。
- [ ] 重複・競合・ラベル不一致・no-op・空理由・coverage不足をグループ単位および全体で検証。
- [ ] 前後の全分類状態、分布、変化したObservation ID、hashを生成。副作用なし。
- [ ] 正本hash/receipt参照の照合とAudit provenanceを実装。

## D: AssessmentとProposal

- [ ] CorrectionChangeSetの不変保存（対象、変更前後ラベル、理由、根拠、fingerprint）。
- [ ] 1 Assessment+1 Proposalの作成と保存を実装。レビュー対象の内容をimmutableにする。
- [ ] 修正ごとの本文、影響件数、分布、理由、総件数をレビュー用DTOに投影。
- [ ] 同一`correctionOperationId`再送が同じProposalを参照するようにする。

## E: Reviewとcommit

- [ ] HumanレビューをProposal全体へのaccept/rejectのみにする。
- [ ] Task/Proposal/actor/Policyの束縛を検証。
- [ ] commit中にHeadと依存・ChangeSet・Assessment・提案semantic hashを**再計算/再検証**。
- [ ] 1 Classification Version、全ラベル、Head、業務操作確定レコードを原子的に記録。
- [ ] commit直後の障害、別Sessionによる再送、同時承認の競合を含むテストを追加。

## F: WorkDefinitionとAdapter

- [ ] 新revisionの定義、Step結果規則、Session schema、Outcome schemaを追加。
- [ ] 新規4 Capabilityを登録し、handler実装を接続。
- [ ] Task入出力bindingを`contracts/task-binding-map.json`に合わせる。`refs.changeSetId`の扱いを決着。
- [ ] すべてのcontinue枝の内側に次Taskを置く。`invalid`/`superseded`/`rejected`で後続が実行されないことを検証。
- [ ] 後続Keyword→Release→Promotion→Deploymentは1つの成功経路として構築。既存のTask IDと結果規則を必要に応じて共通化。
- [ ] 新revisionのSession開始・レビュー表示をoperatorへ追加。

## G: 性能と互換性

- [ ] `readClassificationVersionLabels()`のJOINについて、主キー検索と**文字列ID一致**の両立を確認。すでにある未コミット改善差分を重複適用しない。
- [ ] `EXPLAIN QUERY PLAN`と44,419ラベル規模での開始/レビュー/commit時間を測定。改善前後の測定条件を記録。
- [ ] 結果のObservation集合・ラベルの同一性を改善前後で比較。

## H: E2Eと成果記録

- [ ] 25グループ・29観測→1 Proposal/1 VersionのE2E。
- [ ] 故意の入力不正・拒否・Head競合・改ざん・障害後再送のE2E。
- [ ] Keyword Selection→Release→Promotion→Deployment Requestが各1経路であることを確認。
- [ ] production identity検証・別承認保持・複数Session再送の冪等性を検証。
- [ ] 旧revisionの定義hash、旧Session、既存累積分類が変わらないことを確認。
- [ ] 実装差分、検証結果、運用操作手順、未解決課題を記録。

## 成果物の優先順位

まず**純粋なDomain計算・実行時契約・原子的commit・停止分岐**を完成させる。パフォーマンス改善やUI表現の調整を優先して、整合性条件を曖昧にしない。
