# 04. 実装者向け作業順序・変更対象

## 0. 開始前チェック

- [ ] `git status` が期待どおりで、既存の未コミット変更を破壊しない。
- [ ] Issue #2 と docs を確認。今回の handoff より新しい仕様があれば差分を明記する。
- [ ] `package/src/workflow/v3/definitions.js`、`result-rules.js`、`task-handlers-v3.js`、`domain-services.js`、`application/services.js` を再読する。
- [ ] baseline テストを実施し、失敗している既存テストを記録する。
- [ ] production DB / Workspace をテストに使わない。

## 1. Domain 純粋関数を作成

**新規** `package/src/three-class/classification-correction.js`

- `buildCorrectedClassificationState({survivors,baseLabels,correction})` を実装。
- 既存 `assertCompleteClassificationState()` を利用。重複 survivor / 重複 label の検証も明示。
- `observationId`を `String(...)` へ直接投入しない。stringまたはsafe integerだけ受理して文字列化し、null/undefined/bool/object/NaN、空IDを拒否。
- `commentText` を正規化しない。完全一致のみ。
- target group の全 survivor を新ラベルで統一し、他 observation のラベルを保持。
- `state`は既存分類State準拠の `{schema_version:1,labels:[...]}`（WorkDefinition.schemaVersion=2とは独立）、`change`は対象/変更件数・旧ラベル分布。
- 出力は決定的。元配列を mutate しない。
- 通常分類の `worseThreeClassLabel()` / `assertClassificationHandoffSafe()` は変更しない。

**テスト** `package/tests/v3-classification-correction.test.js` に pure function test を追加。

## 2. Application 提案サービスを作成

**新規** `package/src/application/v3/correction-service.js`

- `ClassificationCorrectionServiceV3.propose(ctx,input)` を実装。
- 既存 `createV3OperationContext` / `runV3Idempotent` / `v3StepResult` / `StateControlPlane` の慣習に合わせる。
- request に含める `requestedBy` は前段で認証済みであることを境界として扱い、非空・human actor を検証。
- `classificationVersionId` の Stream 所属 / Head 一致と明示的 Corpus dependency の整合性を確認。
- Corpus snapshot refs を固定し、`readSelectedSnapshotsInReferenceOrder()` と `projectCumulativeCorpus()` から survivors を得る。**同じ projection の実装を重複作成しない**。
- `readClassificationVersionLabels(db, versionId)` を使用（指定 Version のみを正本とする）。グローバル legacy label テーブルを使わない。
- policy ID を `readExactPolicyVersion()` で検証。
- Domain関数で完全stateを計算し、既存`normalizeLabels()`の正規化規約と`semanticSha256(state)`を整合させる。**`normalizeLabels()`は現在`application/services.js`の非export関数**のため、そのままimportできない。安全なexport/refactorまたは同一境界に閉じた正規化関数を設け、semantic hashの一致を統合テストで保証する。
- `recordAssessment()` と `createProposal()` を既存 API で実行。
- `Proposal.payload.correction` に監査メタデータを固定。`Proposal.dependencies` に Corpus と Policy を入れる。
- **createDecision / commitProposal を呼ばない**。`autoCommit` / `derivedOnly` のショートカットは設けない。
- `HEAD_CONFLICT` のみ result の `conflict` / `superseded` へ変換。それ以外は Task Failure。
- result は `review_required` + proposal/assessment refs（厳密なキー構成）とする。
- `readCorrectionReviewSummary()` は persisted proposal/assessment から読み取り専用で生成。

**Export** `package/src/application/index.js` を更新。

## 3. Commit-time ガードを加える

**変更** `package/src/application/services.js` の `typedClassificationHandler().validate`

- `proposal.payload.correction?.kind === 'manual_classification_correction'` の場合だけ特別チェックする。
- `proposal.dependencies` 中の固定 Corpus ID と現在の Corpus Stream Head の一致を **commitProposal の DB トランザクション内**で検証する。
- 必要であれば Correction Proposal の metadata 整合性（base、対象/旧新/理由が存在する）も確認。
- `classification.finalize` の既存通常分類ルートは維持するが、**Correction WorkDefinitionなら`assessed`を禁止し、Proposal IDと認証済みreview必須**の分岐を設ける。一般分類のshortcutは維持する。
- **P0修正:** `commitProposal()` のno-op branchより前に `domainHandler.preflight({db,proposal,currentHead})` 等を追加する。`preflight`は correction Proposal だけを厳密検証（Corpus Head、base、targetの旧ラベル、同文group全件、group外不変、payload/hash）し、普通のClassificationには影響させない。`validate()`の後付けのみでは回避される。訂正Proposalは`unchanged`を成功に変換しない。
- 通常分類 Proposal に Corpus Head の新しい制約を誤適用しない。

## 4. Workflow / 契約を追加

**変更** `package/src/workflow/v3/contracts.js`

- 新 `CLASSIFICATION_CORRECTION_SESSION_INPUT_SCHEMA` を追加。
- `validateClassificationCorrectionSessionInputSchema()` を追加。
- `requestedBy`、`correction`、`pinned`、`target`、`inputContract` に `additionalProperties:false` / required / enum を適用。
- `reason` は非空かつ空白だけ不可。JSON Schema だけで不足するルールは JS validator で保証。
- 既存 comment batch の Session Schema は変更しない。

**変更** `package/src/workflow/v3/session-input.js`

- `resolveCorrectionSessionInput()`、必要な検証と pin の生成。
- base Classification の corpus dependency を参照する。曖昧な corpus pin は拒否。
- Classification / Corpus Head の比較・Stream/Policy の厳密一致を確認。
- 既存 `resolvePinnedSessionInputV3()` に不要な例外や別 Workflow 固有分岐を混ぜない。

**変更** `package/src/workflow/v3/definitions.js`

- `buildClassificationCorrectionDefinitionV3({revision=1})`、`registerClassificationCorrectionDefinitionV3()` を追加。
- `03-correction-propose`、human review、既存 finalize の3 Task と分岐を構成。
- `AGENT_OUTCOMES` に `C03:['review_required','superseded']`。
- `keywordFlow` と `releaseFlow` の Corpus Binding を引数化。
- 既存 `comment-data-update` 側の呼出しは既存 Corpus Step Binding を渡し、意味が変わらないことを確認。
- `superseded` / `deployment_failed`後の成功処理をsuccess branchの内側へ移す。後続Taskが起動しないことをテストする（noopだけで終了しない）。
- 新定義の validator/hash/immutable revision を対応させる。定義書式は `validateAndHashDefinition` による検証を必須とする。

**変更** `package/src/workflow/v3/result-rules.js`

```text
03-correction-propose:
  review_required + review_required + [assessmentId, proposalId]
  superseded     + conflict        + []
```

例外は成功 result として登録しない。

## 5. Agent Adapter / Runtime / Operator を接続

**変更** `package/src/integration/task-handlers-v3.js`

- `classification.correction.propose` を `V3_SERVICE_CAPABILITIES` と handler map に登録。
- `ClassificationCorrectionServiceV3` を生成して `.propose(ctx,input)` を呼ぶ。
- `routingForResult()` の既存 `stateResult` → outcome に正しく接続。
- `validateV3WorkStepResult` が新 Step ID を許容することを確認。
- `requestedBy`はSession起動時の**実際に認証されたactor**（service actorではない）。CLI `--actor`単独では認証の証明とならないため、本番起動に必須の認証境界を設ける。

**変更** `package/src/integration/v3-runtime.js`

- 新 WorkDefinition の登録と Session 起動関数。
- `registerV3Definition()` と Local/Temporal Runtime が両定義を登録できるようにする。
- cutover guard は comment-data-update revision >=3 に依存する可能性がある。correction revision=1 を間違って渡さない。v3 が有効な環境のみ許可する。
- 通常 `startCommentDataUpdateV3()` の互換性は維持する。

**変更** `package/src/integration/v3-operator.js`

- correction Session 起動、Session/Task 参照、レビュー表示、Human Task 操作を公開。
- 現行 `WORK_DEFINITION_ID` 固定フィルタを必要な範囲で緩めるが、既存 comment-data-update 専用操作のガードは残す。
- Reviewer actorは既存のclaim/human completionの信頼できる実体から供給。`{outcome,result:{rationale}}`→`{outcome,actor,rationale}`の明示的な変換と署名元/claim所有者検証を行う。

**変更** `package/scripts/comment-data-update-v3-operator.mjs`, `package/scripts/README.md`

- 既存 CLI に correction 起動コマンドを追加する（独立 CLI ファイルは作らない）。
- 必須フィールドが読める入力方式と、review summary / accept / reject をオペレーターが利用できることを確認。
- productionの起動制御、Deployment確認経路を既存に合わせる。認証主体を検証できない`--actor`のみの実行は本番で禁止。

## 6. 統合テスト・回帰テスト

**新規** `package/tests/v3-classification-correction.test.js`

**既存変更** `v3-cumulative-corpus-update.test.js`、`v3-workflow.test.js`、`v3-runtime.test.js`、`v3-operator.test.js`。特に修正後ラベルの将来継承、Human Reject、レビュー待ち Head 競合、release identity までを確認。

テストの詳細は `05_ACCEPTANCE_AND_TESTS.md`。

## 7. 最終レビュー・納品

- [ ] `npm --workspace package test` が成功（開始時からの既知失敗を除き、新規失敗なし）。
- [ ] 訂正の human review が`assessed` shortcutまたは不正なActor DTOで省略されない。
- [ ] 通常分類の workset 除外条件が緩和されていない。
- [ ] Proposal の semantic hash と Review 表示が同一内容を参照する。
- [ ] commit時の Corpus / Classification Head競合をno-opより前の同一DBトランザクション内でfail-closedに判定。
- [ ] 既存 Version が不変、却下時に Head 不変。
- [ ] Keyword / Release が新 Classification Version を pin する。
- [ ] ソース変更、テスト結果、実行した/していない production 操作を記録。

## 完了時ディレクトリ骨子

```text
package/
├── src/
│   ├── three-class/
│   │   ├── cumulative-classification-plan.js  [KEEP]
│   │   ├── label-resolution.js                [KEEP]
│   │   └── classification-correction.js       [NEW]
│   ├── application/
│   │   ├── index.js                           [MOD]
│   │   ├── services.js                        [MOD; correction-only commit guard]
│   │   └── v3/
│   │       ├── domain-services.js             [KEEP]
│   │       └── correction-service.js          [NEW]
│   ├── workflow/v3/
│   │   ├── contracts.js                       [MOD]
│   │   ├── session-input.js                   [MOD]
│   │   ├── definitions.js                     [MOD]
│   │   └── result-rules.js                    [MOD]
│   └── integration/
│       ├── task-handlers-v3.js                [MOD]
│       ├── v3-runtime.js                      [MOD]
│       └── v3-operator.js                     [MOD]
├── scripts/
│   ├── comment-data-update-v3-operator.mjs    [MOD]
│   └── README.md                             [MOD]
└── tests/
    ├── v3-classification-correction.test.js   [NEW]
    ├── v3-cumulative-corpus-update.test.js    [MOD]
    ├── v3-workflow.test.js                    [MOD]
    ├── v3-runtime.test.js                     [MOD]
    └── v3-operator.test.js                    [MOD]

docs/active/issues/20261029-manual-individual-classification-correction/
├── ISSUE_BODY.md                              [UPDATE: decisions + acceptance]
└── WORK_TASK_SEQUENCE.md                      [UPDATE: work + evidence]
```

これは「予定配置」であり、実装中に既存コードとの整合性上どうしても追加が必要な場合は、新規ファイル/DB 追加の理由を報告する。観測可能な受け入れ条件を優先する。
