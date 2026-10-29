# 03. WorkDefinition と接続仕様

## WorkDefinition

```text
workDefinitionId = classification-correction
revision = 1                // 新しい WorkDefinition としての初版
schemaVersion = 2           // comment-data-update v3 と同じ JSON definition schema
```

原則 `comment-data-update` とは入口を分離し、既存の Keyword Selection 以降を構成関数ごと再利用する。

## WorkStep マトリクス

| Step ID | Worker | Capability | Input（主要） | 許容 outcome | 権限 |
|---|---|---|---|---|---|
| `03-correction-propose` | agent | `classification.correction.propose` | pinned Corpus / Classification / classification policy, correction, requestedBy | `review_required`, `superseded` | `state:read`, `state:propose` |
| `05-review-classification` | human | — | Proposal ID, Assessment ID; レビュー情報表示 | `accept`, `reject` | human auth |
| `06-finalize-classification` | agent | `classification.finalize` | Proposal ID, Task review result | `continue`, `rejected`, `superseded` | `state:read`, `state:commit` |
| `07a` 以降 | existing | existing keyword/release/... | pinned Corpus + new Classification Version | existing | existing |

最初の agent が成功すると、常に `review_required`。`continue`、`unchanged`、`auto-commit` は許可しない。

## Flow スケッチ

```text
Session(input immutable)
  └─ 03-correction-propose
       ├─ superseded  → terminal(superseded/classification)
       └─ review_required
            ├─ 05-review-classification (human accept | reject)
            └─ 06-finalize-classification
                 ├─ rejected   → terminal(change_rejected/classification)
                 ├─ superseded → terminal(superseded/classification)
                 └─ continue   → keywordFlow({ corpus: SESSION(pin.corpus),
                                               classification: STEP(06.finalize.classificationVersionId) })
                                     └─ releaseFlow(...)
                                          └─ promotion + deployment + verification
```

- Proposal 作成・review 待ちの間は既存 Classification Version を変更しない。
- `06-finalize-classification` は `assessed` のshortcutでreview省略されないよう、`proposalId`と`review`を必須Bindingにし、**サービス境界でもworkDefinitionIdがclassification-correctionなら`assessed`受信を拒否**する。
- `05-review-classification`完了入力はProvider側の `{outcome,result:{rationale}}`。既存サービス `authorizedReview()` は `{outcome,actor,rationale}` を必要とするため、**Actorをどこから受け取るかを統合テストで確認して、信頼済みtask completionのclaimant actorだけを利用するAdapterで明示変換**する。Result中のactor自己申告を使わない。変換不能ならfail-closed。

## Task Binding の例（JS 概念コード）

```js
const propose = agentTask(
  '03-correction-propose',
  'classification.correction.propose',
  ['state:read','state:propose'],
  {
    corpusVersionId: SESSION('/pinned/corpusVersionId'),
    classificationVersionId: SESSION('/pinned/classificationVersionId'),
    classificationPolicyVersionId: SESSION('/pinned/classificationPolicyVersionId'),
    correction: SESSION('/correction'),
    requestedBy: SESSION('/requestedBy'),
  },
  'C03'
);

const review = humanTask(
  '05-review-classification', 'Review the classification correction',
  {
    proposal: STEP('03-correction-propose', '/refs/proposalId'),
    assessment: STEP('03-correction-propose', '/refs/assessmentId'),
  },
  ['accept', 'reject'],
  {type:'object',additionalProperties:false,properties:{rationale:{type:'string',minLength:1}}}
);

const finalize = agentTask(
  '06-finalize-classification','classification.finalize',
  ['state:read','state:commit'],
  {
    proposalId: STEP('03-correction-propose','/refs/proposalId'),
    review: TASK('05-review-classification',''),
  },
  '06',20000
);
```

実際の API 引数・Task result の取り出しは既存 Provider が受け入れる形式に合わせる。上記はそのまま実行可能なパッチではない。

## 既存下流フローの共有方法

現行の `keywordFlow({ classification })` / `releaseFlow({ classification, keyword })` は Corpus に `STEP('02-update-corpus','/refs/corpusVersionId')` をハードコードしている。訂正 Workflow に `02-update-corpus` はないため、入力 Binding を汎化する。

```js
function keywordFlow({ corpus, classification }) {
  // corpusVersionId: corpus
  // classificationVersionId: classification
  // 成功時:
  // releaseFlow({ corpus, classification, keyword: STEP('10-finalize-keyword-selection','/refs/keywordSelectionVersionId') })
}

function releaseFlow({ corpus, classification, keyword }) {
  // corpusVersionId: corpus
  // classificationVersionId: classification
  // keywordSelectionVersionId: keyword
}

// normal flow
keywordFlow({
  corpus: STEP('02-update-corpus','/refs/corpusVersionId'),
  classification: STEP('06-finalize-classification','/refs/classificationVersionId'),
});

// correction flow
keywordFlow({
  corpus: SESSION('/pinned/corpusVersionId'),
  classification: STEP('06-finalize-classification','/refs/classificationVersionId'),
});
```

**両経路で既存処理を同じ関数から生成する**。下流ロジックをコピーしない。

## 既存 Branch の安全な再利用に関する既知の問題

現行 `definitions.js` に以下が存在する：

- `07a-prepare-keyword-handoff` の `superseded` branch が `noop`。
- `07-update-keyword-selection` の `superseded` branch が `noop`。
- `16-trigger-deployment` の `superseded` / `deployment_failed` branch が `noop`。

これらの直後に処理が続く構造なので、**訂正用に下流を共通化する際には、失敗・競合branchが成功処理へ落ちないようにする**。後続の`assess`/`finalize`/`verify`等を成功outcome branchの内側へ移動する。`terminalStatus`付き`noop`で親`sequence`が停止するとは推測しない。各非成功outcomeで後続の副作用が0件であることを回帰テストする。

`AGENT_OUTCOMES`、`result-rules.js`、`task-handlers-v3.js` の `routingForResult()`、Provider 定義 validation の組合せを揃える。

## Session 起動と WorkDefinition 登録

- `SESSION_INPUT_V3_SCHEMA` は `comment-data-update` 専用。これを不用意に拡張して既存バッチ入力の契約を緩めない。訂正専用 JSON Schema + validator を追加する。
- `resolveCorrectionSessionInput()` は**認証システムから渡された**trusted actor、Classification Version、対応する Corpus dependency、現行Heads、必要なPolicy/Keyword pinsを確定する。`--actor` 文字列を認証として扱わない。
- `startClassificationCorrectionV3()` は `workDefinitionId:'classification-correction'`、`revision:1` で開始する。
- `validateV3Definition()` は現状 `comment-data-update` のみ許可する。新 WorkDefinition を検証可能にする。過去の定義 revision/hash は不変。
- `registerV3Definition()`、`createV3LocalRuntime()`、`createV3TemporalRuntime()`、worker profile の capabilities に接続する。
- `assertV3StartAllowed(controlPlane, targetRevision)` など現行の cutover guard は `comment-data-update` の revision=3 以降を想定している可能性があるため、**revision=1 をそのまま旧ガードに渡さない**。必要な v3 cutover/preflight 制約を保った新 Workflow 起動経路として適合させる。
- `v3-operator.js` は `WORK_DEFINITION_ID='comment-data-update'` で Session をフィルタしているので、訂正 Session の一覧・取得・Human Task 操作を対応させる。
- scripts は既存 `comment-data-update-v3-operator.mjs` を拡張し、専用 CLI を新設しない。CLI の具体的なサブコマンド名は既存のコマンド体系に合わせて決定する。

## Human Review の表示

レビュー担当者は、少なくとも以下を確認できなければならない：

- base Classification Version / Corpus Version
- `observationId`、`commentText`、影響 observation 数
- group の変更前ラベル分布、変更後ラベル
- 理由、要求者、Proposal / Assessment ID

`readCorrectionReviewSummary()` 等により persist 済み Proposal/Assessment から表示する。入力 Session 値だけを表示して「レビュー済み」とは見なさない。

## Expected 終端と出力

- `deployed`: release / deployment identity の検証完了
- `change_rejected` (`stage:classification`): human reject、新 Classification Version なし
- `superseded` (`conflictAt:classification`): Classification/Corpus 競合（どちらかを補助 details に記録可能）
- `not_promoted`: Promotion reject
- `deployment_failed`: Deployment 不成立・検証失敗
- `blocked` / failed task: 入力不正、Integrity不一致、設定不備など（成功Outcomeには変換しない）

**強制不変条件:** 訂正が `rejected`、`superseded` または例外で終了したら`keyword-selection`以下の新規Taskを実行しない。deploymentの`superseded`/`deployment_failed`なら`verify`/`record`を実行しない。

失敗した場合に既に確定した Classification Version を逆方向に書き換えることはない。
