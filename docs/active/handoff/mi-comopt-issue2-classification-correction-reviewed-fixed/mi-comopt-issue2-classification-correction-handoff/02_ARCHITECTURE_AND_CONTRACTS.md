# 02. アーキテクチャと境界契約

## 層の役割

```text
External command + authenticated actor
  └─ Integration: resolveCorrectionSessionInput() / startClassificationCorrectionV3()
       └─ Workflow: classification-correction WorkDefinition
            ├─ Agent: classification.correction.propose
            │    └─ Application: ClassificationCorrectionServiceV3.propose()
            │         ├─ pin/read/validate Corpus + Classification + Policy
            │         ├─ Domain: buildCorrectedClassificationState()  [pure]
            │         └─ Control Plane: Assessment + Proposal       [no commit]
            ├─ Human: 05-review-classification
            ├─ Agent: classification.finalize                    [reuse]
            └─ Keyword Selection → Release → Promotion → Deployment [reuse]
```

- Domain は DB/Workflow/State Control Plane に依存しない。
- Application が ID 検証・読み取り・状態計算呼出し・Proposal 作成を担当する。
- Workflow は Task Binding と分岐だけを担当する。
- Integration は actor と Version Pin の正当性、Provider と Consumer の橋渡しを担当する。

## 最小の型（TypeScript は設計表記、実コードは JS + JSON Schema + JSDoc）

```ts
type VersionId = string;
type ObservationId = string;
type ThreeClassLabel = 'normal' | 'reactive' | 'direct_nuisance';
type HumanActor = { actorType: 'human'; actorId: string };

type ClassificationCorrectionCommand = {
  baseClassificationVersionId: VersionId;
  observationId: ObservationId;
  expectedLabel: ThreeClassLabel;
  newLabel: ThreeClassLabel;
  reason: string;
};

type CorrectionSessionInput = {
  inputContract: { id: 'classificationCorrection'; version: '1.0.0' };
  correction: Omit<ClassificationCorrectionCommand, 'baseClassificationVersionId'>;
  requestedBy: HumanActor; // 外部 request body からではなく認証済み actor から生成
  pinned: {
    corpusVersionId: VersionId;
    classificationVersionId: VersionId; // command.baseClassificationVersionId
    keywordSelectionVersionId: VersionId | null;
    corpusPolicyVersionId: VersionId;
    classificationPolicyVersionId: VersionId;
    keywordPolicyVersionId: VersionId;
    accountPolicyVersionId: VersionId;
    projectionDefinitionVersionId: VersionId;
  };
  target: { promotionStream: 'production'; deploymentTarget: 'production' };
};

type CorrectionProposeInput = {
  corpusVersionId: VersionId;
  classificationVersionId: VersionId;
  classificationPolicyVersionId: VersionId;
  correction: CorrectionSessionInput['correction'];
  requestedBy: HumanActor;
};

type ClassificationLabel = { observationId: ObservationId; label: ThreeClassLabel };
type Survivor = { observationId: ObservationId; commentText: string };
type ClassificationState = { schema_version: 1; labels: ClassificationLabel[] }; // 既存分類状態の版。WorkDefinition.schemaVersion=2とは別

type BuildCorrectedStateInput = {
  survivors: readonly Survivor[];
  baseLabels: readonly ClassificationLabel[];
  correction: Pick<ClassificationCorrectionCommand, 'observationId'|'expectedLabel'|'newLabel'>;
};

type CorrectionChange = {
  commentText: string;
  affectedObservationCount: number;
  changedObservationCount: number;
  previousLabels: Array<{ label: ThreeClassLabel; count: number }>;
  newLabel: ThreeClassLabel;
};

type BuildCorrectedStateResult = {
  state: ClassificationState;
  change: CorrectionChange;
};

type CorrectionProposeResult =
  | { stateResult: 'review_required'; refs: { proposalId: string; assessmentId: string } }
  | { stateResult: 'conflict'; refs: {}; details: { conflictAt: 'classification' } };

// Human Task の Provider 入力形状は次（finalize service に渡すときは
// existing contract の review:{ outcome, actor, rationale } に正規化する）。
type HumanReviewCompletion = {
  outcome: 'accept' | 'reject';
  result: { rationale: string };
};

// Controller/Operator は認証済み Human Actor を別途渡す。
type FinalizeReview = {
  outcome: 'accept' | 'reject';
  actor: HumanActor;
  rationale: string;
};
```

**注意**: TypeScript を新規ビルド対象に追加する必要はない。公開契約の実行時 validation は `workflow/v3/contracts.js` と `session-input.js` で実装する。

## 主要関数と契約

| 関数 / method | 入力 | 出力 | 副作用 |
|---|---|---|---|
| `buildCorrectedClassificationState(input)` | survivors / baseLabels / correction | complete state + change | なし |
| `ClassificationCorrectionServiceV3.propose(ctx, input)` | `CorrectionProposeInput` | `CorrectionProposeResult` | Assessment、Proposal 作成のみ |
| `readCorrectionReviewSummary(controlPlane, {proposalId, assessmentId})` | Proposal/Assessment ID | 対象・差分・理由・要求者 | なし |
| `resolveCorrectionSessionInput(controlPlane, {command, requestedBy})` | raw command, trusted actor | immutable Session Input | 読取のみ |
| `startClassificationCorrectionV3({runtime, controlPlane, sessionId, command, actor})` | start args | session start result | Session 作成 |
| `buildClassificationCorrectionDefinitionV3({revision=1})` | revision | WorkDefinition | なし |
| `registerClassificationCorrectionDefinitionV3(...)` | registry | validated WorkDefinition | Registry 更新 |
| `ClassificationApplicationServiceV3.finalize(...)` | existing Proposal / review | accepted version or rejection/conflict | Decision、commit（再利用） |
| `keywordFlow({corpus, classification})` | VersionBindings | workflow node | 定義生成のみ |
| `releaseFlow({corpus, classification, keyword})` | VersionBindings | workflow node | 定義生成のみ |

## Domain アルゴリズム（擬似コード）

```js
function buildCorrectedClassificationState({ survivors, baseLabels, correction }) {
  // 1. observationIdはstringまたはsafe integerのみ受理し文字列化。null/undefined/bool/object/NaNを拒否。重複・欠落・余分を拒否
  // 2. 対象 observation は survivors から検索し、存在しなければ拒否
  // 3. 対象の base label === expectedLabel でなければ拒否
  // 4. newLabel が三分類 enum、かつ expectedLabel と異なることを確認
  // 5. commentText === target.commentText の survivors 全件を抽出
  // 6. baseLabels 全体をコピーし、対象 group 全件の label を newLabel に変更
  // 7. normalizeLabels() と同じ localeCompare 順序へ整列、全件 coverage 検証
  // 8. 旧ラベル分布、対象数、実際の変更数を記録し {state, change} 返却
}
```

`worseThreeClassLabel()` は**訂正関数内で使用しない**。基準 Version 内に同じ文字列のラベル矛盾が存在しても、グループ全件の訂正で解消する。`expectedLabel` は指定された **1 observation の旧ラベル**を検証する条件であり、グループ全員の旧ラベル一致条件ではない。

状態の並び順は現行 `normalizeLabels()` の `observationId.localeCompare(...)` と一致させる（単純なコードポイント順・数値順と混同しない）。出力 `schema_version` は現行 Classification State の `1` とする。**WorkDefinition の `schemaVersion:2` と Classification State の `schema_version:1` は別契約**。対象外のラベルと旧Versionは不変。Domainで副作用を生じさせない。

## Proposal / Assessment / Decision の情報保持

`state_proposals`、`state_assessments`、`state_decisions`、`state_versions` は既存テーブルを使用する。

- `Assessment`: input fingerprint、旧 Version ID、訂正要求、変更差分、状態を必要に応じて固定する。
- `Proposal.payload.state`: `{schema_version:1, labels:[...]}` の**完全状態**（現行既存分類State契約）。基準Versionの状態スキーマとの整合性をチェックし、勝手にスキーマを昇格させない。
- `Proposal.payload.correction`: `kind: 'manual_classification_correction'`、基準 Version、対象 observation、`commentText`、`expectedLabel`、`newLabel`、reason、trusted `requestedBy`、group の旧ラベル分布/件数など。
- `Proposal.dependencies`: `{role:'corpus',versionId:...}` と `{role:'policy',versionId:...}`。
- `Proposal.proposedSemanticSha256`: **訂正後の state のみ**を hash する。メタデータを state に混ぜない。
- `Decision`: 既存の `authorityKind:'human'`、authorityRef、outcome、rationale、decidedAt。
- `Version`: 既存 Control Plane が proposal commit により生成。旧 Version は不変。

`readCorrectionReviewSummary()` は **persist 済み Proposal / Assessment** から情報を構築する。Session の未検証値をレビュー表示に使わない。`proposalId` と `assessmentId` の一致検証が必要。レビュー画面/CLI で、対象・旧/新値・理由・base・グループ件数・要求者を見せる。

## Version Pin / 原子的な競合検証

1. `classificationVersionId` が Classification Stream の現在 Head であることを、Session 起動時・Proposal 作成時にチェック。
2. Classification Version の **明示的 corpus dependency** に対応する Corpus Version を使用。依存関係がない場合は推測による補完をせず拒否する（legacy genesis fixture 等との互換性は別途確認）。
3. その Corpus Version が Corpus Stream の現在 Head であることを確認。分類全件の coverage 検証は snapshot refs から `projectCumulativeCorpus()` で抽出した survivors に対して実施。
4. Proposal 確定時に **Classification Head と Corpus Head の双方**を同一トランザクション境界で再検証。既存 `commitProposal()` は Classification Stream の Head しか照合しない。**`typedClassificationHandler().validate()` だけへ追加してはならない**。no-op早期終了前に訂正専用の `domainHandler.preflight`（または同等の専用原子的処理）を呼び、Corpus Headの照合、訂正のprovenance・group全件更新・expectedLabel・state/hashの整合性を検証する。通常分類の意味論は維持する。
5. `commitProposal()` のno-op branchは現状 `domainHandler.validate` より**先**。`preflight` をno-op branchより前に置き、訂正ではsemantic-and-dependenciesの`unchanged`結果も失敗として扱う。作成前の変更チェックも別途実施する。

## 認証主体の取り扱い

- `requestedBy`: 信頼できる認証境界の Human Actor を Session Input に固定する。**CLIの任意 `--actor` 値はそれ自体では認証ではない**。認証主体と当該CLI引数の一致を検証できない運用では本番訂正の起動を拒否する。
- `reviewer`: `completeHumanTaskWithInput()` を呼ぶ認証済み actor を採用する。`review.actor` を外部 JSON から自己申告させない。
- v3 Agent Adapter の `OperationContext.actor` は既定で `application-service` という service actor。これを要求者やレビュー担当者と混同しない。
- Reviewer authorization は既存 classification policy の設定に従う。別の権限管理機構を追加しない。
- Correction Workflowの `classification.finalize` は `assessed` のshortcutを**禁止**し、Proposal ID・reviewer付きReviewを必須にする。Task結果の `{outcome,result:{rationale}}` はAdapterが信頼済みclaimant actorと組み合わせて `{outcome,actor,rationale}` へ明示的に変換し、外部値でactorを上書きしない。

## Error / Result 規則

- `review_required`: `{stateResult:'review_required',refs:{proposalId,assessmentId}}`
- `superseded`: `{stateResult:'conflict',refs:{},details:{conflictAt:'classification'}}`（Corpus競合時も既存result-ruleのoutcomeはsuperseded。詳細にcorpusを付加可能）
- 不明 observation、invalid label、期待値不一致、coverage 不足、理由空欄: `StateControlPlaneError` 等の fail-closed Task Failure。`superseded` を流用しない。
- `WorkStepResultV3` 自体に top-level `outcome` を付けない。`outcome` は Agent Adapter が Provider 向け成功結果に付与する。
- `result-rules.js` は Step ID と stateResult / refs の**厳密一致**で検証しているため、新 Step の許可組合せを追加する。
