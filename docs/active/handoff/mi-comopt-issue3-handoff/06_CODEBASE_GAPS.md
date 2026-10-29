# 06 既存コードとの照合と草案の不整合

この文書はGitHub connectorで確認できた `main` の特定ファイルに対する観察である。別ブランチ、未コミットの作業ツリー、すでに進行中の変更まで不存在と断定しない。

## 確認済みの実装契約

| 対象 | `main`で確認した事実 | 作業内容 |
|---|---|---|
| `package/src/workflow/v3/contracts.js` | `WORK_STEP_RESULT_V3_SCHEMA` は `{stateResult,refs,details?}`、`refs`はadditionalProperties false。`changeSetId`は未定義。 | 型草案の`refs.changeSetId`を`details`へ移すか、スキーマ・result-rules・bindingsを整合させて拡張する。 |
| `package/src/workflow/v3/result-rules.js` | Step IDごとにrouting/stateResult/refsキーの**完全一致**規則を持つ。 | 01/02/03/06の新規Step規則を追加。既存行を変更しない。 |
| `package/src/integration/task-handlers-v3.js` | Adapterは`routingForResult()`から`outcome`を導出。Capability一覧は既存処理のみ。 | batch4 Capabilityと`blocked -> invalid`等のStep別対応を追加。 |
| `package/src/application/v3/context.js` | `operationIdForV3Task` は`${sessionId}/${stepId}`。`runV3Idempotent`はTask単位のreceiptを作成。 | 業務操作IDを別途保存・一意化する。Session間再送の保証をTask receiptだけに依存しない。 |
| `package/src/state/control-plane.js` | `recordAssessment`, `createProposal`, `createDecision`は個別transaction/receipt。`commitProposal()`はtransaction内でHeadを比較してからdomainHandler.validateを実行。 | commit内preflightの拡張と業務操作IDの同一性を設計。入れ子transactionを作らない。 |
| `package/src/workflow/v3/session-input.js` | `comment-data-update`専用の入力契約、pin解決。 | 新Session契約と解決関数を別追加。既存を変更しない。 |
| `package/src/workflow/v3/definitions.js` | 現行のKeyword/ReleaseではCorpusを`STEP('02-update-corpus',...)`から参照。 | CorrectionBatchでは`SESSION('/pinned/corpusVersionId')`に接続。 |
| `package/src/workflow/v3/outcomes.js` | terminal outcomeは既存`comment-data-update`契約で検証。`invalid_request`はない。 | 新WorkDefinition専用Outcome契約/検証規則を追加。 |
| `package/src/integration/v3-operator.js` | `WORK_DEFINITION_ID = 'comment-data-update'`、コメント更新Session用のoperator。 | CorrectionBatch専用のstart/list/review導線を追加。既存Sessionの判定を汚染しない。 |
| `package/src/database/three-class-label-repository.js` | `readClassificationVersionLabels`はCASTによる文字列ID一致のLEFT JOINを実施。 | 既存未コミットの最適化差分があれば継承。主キー探索と文字列ID互換性を両立。 |
| `package/src/three-class/cumulative-classification-plan.js` | `assertCompleteClassificationState`、累積分類継承の関数あり。 | 適用可能なcoverage検証を再利用。分類一括修正は「未解決へのhuman decision」ではなく既存ラベルの明示的な上書き。 |

## 現行の型草案に残る整合課題

1. **Step 02の変更集合参照**: `reference/classification-correction-v2.task-types.ts` の `ResolveBatchResult` は `refs.changeSetId` を定義するが、現行`WORK_STEP_RESULT_V3_SCHEMA`は許容しない。`details.changeSetId`に統一する案が最小変更。
2. **Step 02 input**: `ResolveBatchInput`は`requestFingerprint`必須。一方、先のWorkDefinition案はStep01の`details.requestFingerprint`へのbindingが不足していた。
3. **Step 03 input**: `ProposeBatchInput`は`changeSetId`と`requestFingerprint`を必要とする。WorkDefinition側に同じbindingが必要。
4. **Session認証情報**: 草案Session型には`requester`があるが、WorkDefinitionの先行案ではStep01へのbindingなし。operatorで認証済actorを保持し、一致検証する。
5. **stateResultの表現**: `blocked`を入力不正に使えるが、existing adapterの`routingForResult`はそれを`invalid`にマップしない。batch4 Taskに限る対応規則を追加し、他Taskへ影響させない。
6. **ConflictAtの表現**: 草案には`policy`があるが、現行のterminal outcome schemaは`policy`を許さない。Classification Policyの不整合をどの終了分類で表すか、両方のschemaで整合させる。
7. **Humanレビューの`rationale`**: Task結果では`review.result.rationale`、既存Application Serviceは`review.rationale`を読む箇所がある。Adapter正規化の必要性を確認し、認可されたレビューを確実に保存する。
8. **Finalizationの冪等性**: 既存`runV3Idempotent`はmutationの後で外側receiptを書き得る。commit/Head更新・業務操作receiptを別トランザクションにしない保証が必要。
9. **Repositoryの契約**: `CorrectionBatchSessionInput.pinned.keywordSelectionVersionId`は型でnullを許可。後続の既存サービスでnullを扱えることを確認し、Version解決関数と一致させる。
10. **Hash正規化の仕様**: 入力順を意味に含めるか、内容集合として並べ替えるか、同一修正が重複してもfingerprintで不正を検出するかをテスト可能に定義。
11. **TypeScript vs JS実行時検証**: `tsc --strict`の成功はJSON SchemaやDBの一意制約を保証しない。
12. **先のWorkDefinition草案**: 以前の対話で作られたJS草案はこの環境で参照可能なファイルとして存在しない。このhandoffはそれを同梱済みと主張しない。`02_WORKFLOW_AND_BINDINGS.md`を基に定義を実装する。

## 実装選択の判断基準

- 実装ファイル名よりも、**契約の一貫性・不変条件・既存挙動**を優先する。
- 定義の終了規則はOrchestratorの実際の`sequence`/`choice`意味論を参照して記述する。曖昧ならTaskを実行してはいけない枝を物理的に作らない。
- `classification-correction@1`などの未取得コードを想像で改修しない。作業者のローカル実体を先に確認。

## 根拠URL

- Issue: https://github.com/unow-dev/mi-comopt/issues/3
- Input: https://github.com/unow-dev/mi-comopt/blob/main/package/src/workflow/v3/contracts.js
- Rules: https://github.com/unow-dev/mi-comopt/blob/main/package/src/workflow/v3/result-rules.js
- Definition: https://github.com/unow-dev/mi-comopt/blob/main/package/src/workflow/v3/definitions.js
- Adapter: https://github.com/unow-dev/mi-comopt/blob/main/package/src/integration/task-handlers-v3.js
- Context: https://github.com/unow-dev/mi-comopt/blob/main/package/src/application/v3/context.js
- State: https://github.com/unow-dev/mi-comopt/blob/main/package/src/state/control-plane.js
- Label reader: https://github.com/unow-dev/mi-comopt/blob/main/package/src/database/three-class-label-repository.js
