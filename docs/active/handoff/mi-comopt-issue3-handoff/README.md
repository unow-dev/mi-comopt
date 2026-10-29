# mi-comopt Issue #3 — 一括分類修正 実装担当者向け handoff

- 作成基準日: 2026-10-30 (JST)
- 対象: https://github.com/unow-dev/mi-comopt/issues/3
- リポジトリ: https://github.com/unow-dev/mi-comopt
- 参照ブランチ: `main` （GitHub connectorで取得した範囲）
- 成果物の性質: **実装指示・設計資料・型草案**。実装済みコードや実行済み検証を意味しない。

## この handoff の目的

25本文グループ・29観測の分類修正を **1つのCorrectionBatch → 1 Assessment → 1 Proposal → 1 Human Review/Decision → 最大1 Classification Version → 1 Publication経路** として処理する機能を実装する。部分更新、予期しない自動承認、同一操作の重複Version/Release/Deployment Request生成を許さない。既存 `classification-correction@1` および `comment-data-update@3/@4` の挙動と定義hashを維持する。

## 読む順序

1. `01_SCOPE_AND_RULES.md` — 要求、対象データ、禁止事項、用語。
2. `02_WORKFLOW_AND_BINDINGS.md` — Taskの順序・条件・入力参照・終端。
3. `03_FUNCTION_PORTS.md` — 下位関数・読込・保存・commitの契約。
4. `04_IMPLEMENTATION_SEQUENCE.md` — 推奨実装順序と依存関係。
5. `05_ACCEPTANCE_TESTS.md` — 正常系・異常系・回帰・性能の検証表。
6. `06_CODEBASE_GAPS.md` — `main`で確認した既存契約との差分、型草案の未整合。
7. `07_DECISIONS_AND_BOUNDARIES.md` — 決定済み事項と作業者判断が必要な点。
8. `contracts/task-binding-map.json` — Task ID・Capability・入力元の機械可読な対応表。
9. `reference/*.ts` — 前段の議論で作成した、コンパイル可能な **型草案**。
10. `fixtures/issue3-targets.json` — Issueに記載された照合対象・期待集計値（投入要求ではない）。

## 実装対象の起点

- `package/src/workflow/v3/contracts.js`
- `package/src/workflow/v3/session-input.js`
- `package/src/workflow/v3/definitions.js`
- `package/src/workflow/v3/result-rules.js`
- `package/src/workflow/v3/outcomes.js`
- `package/src/integration/task-handlers-v3.js`
- `package/src/integration/v3-runtime.js`
- `package/src/integration/v3-operator.js`
- `package/src/application/v3/context.js`
- `package/src/application/v3/domain-services.js`
- `package/src/state/control-plane.js`
- `package/src/database/three-class-label-repository.js`
- `package/src/three-class/cumulative-classification-plan.js`

Issueが挙げる `package/src/application/v3/correction-service.js` と `package/src/three-class/classification-correction.js` は、確認した `main` では取得できなかった。別ブランチや未コミット差分に存在する可能性を否定しない。**本資料の型草案は既存実装に組み込まれたものではない。**

## 前提となる安全条件

- 認証・承認されたHuman Reviewなしに分類commitしない。分類承認とProduction Promotion承認は別。
- 初回commitと同一業務操作の再試行を区別する。同一操作を別Sessionから再送しても新しいClassification Versionを作らない。
- 変更集合と正本・handoff receiptの整合性を証明する。I番号からObservation IDを推測しない。
- 新しいClassification VersionのIDをPublicationへ渡す。補正前のbase Classification IDを渡さない。
- 試験用の例を実運用Sessionの開始・承認・公開命令と解釈しない。

## 参照資料の注意

`reference/*.ts`は現時点の設計会話の写しであり、実装する前に`06_CODEBASE_GAPS.md`の不整合を解消する。とくに `ResolveBatchResult.refs.changeSetId` は現行の結果schemaに存在せず、また `CorrectionBatchSessionInput.requester` は認証済みの情報と照合する必要がある。型が通ることと実行時契約が正しいことは別である。

## 実施していないこと

本handoffの作成ではGitHubリポジトリの変更、Issueへのコメント投稿、Sessionの開始、Human Taskの承認、productionへの公開を行っていない。
