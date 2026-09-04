# Implementation Handoff

## 1. 目的

責務と依存関係をディレクトリ単位で明示し、データ加工ロジックをUI・DB・外部I/Oの具体実装から隔離する。

大枠は元issueの決定を維持する。

- コレクター層
- データベース層
- データ加工層
- UI層

`adapters` は第5レイヤーではない。CLI/composition rootからfilesystem等の外部境界へ接続する実装置き場としてのみ使う。

## 2. 最終ディレクトリ構造

```text
package/
  src/
    processing/
      shared/
        workflow-validation-error.js

      keyword-candidates/
        candidate-workflow.js
        update-flow.js
        artifact-validation.js
        handoff-workflow.js

      account-block-candidates/
        account-block-candidate-workflow.js

    database/
      comment-database.js

    ui/
      App.jsx
      styles.css
      new-badge.js
      candidate-data.js
      candidate-data-adapter.js

    lib/
      account-block-candidate-workflow.js
      # compatibility re-export shim only。実ロジック禁止。

    data/
      # generated artifacts。今回移動・再生成しない。

    main.jsx

  scripts/
    adapters/
      keyword-publication.js

    candidate-workflow.mjs
    account-block-candidate-workflow.mjs
    comment-database.mjs
    verify-data.mjs
```

Collector実装はsupplied sourcesに存在しないため、今回 `src/collector/` や架空interfaceを作らない。将来のcollector実装は `src/collector/` に置き、collector固有形式からDBのnormalized inputへのadapterもcollector側で扱う。

## 3. 依存規則

### Processing

`src/processing/**` は以下へ依存してはならない。

- `src/database/**`
- `src/ui/**`
- `scripts/**`
- React / react-dom
- `node:sqlite`

keyword featureとaccount featureの直接相互依存も禁止する。

```text
keyword-candidates  -> account-block-candidates  NG
account-block-candidates -> keyword-candidates   NG
keyword/account -> processing/shared             OK
```

`node:crypto`、JSON serialization、UUID/時刻生成まで一律禁止するルールは今回設けない。issueの要求を超えるpure-core化はscope外。

### Database

`src/database/comment-database.js` はComment DB境界として維持する。normalized payload validation、timestamp normalization、canonical payload SHA、SQLite migration/transaction、`importNormalizedPayloadFile()` を今回再設計しない。

### UI

`App.jsx` はgenerated JSONを直接importしてはならず、artifactのsnake_caseフィールドも直接参照してはならない。

```text
src/data/*.json
  -> src/ui/candidate-data.js
  -> src/ui/candidate-data-adapter.js
  -> UI model
  -> App.jsx
```

### Filesystem publication

keyword publicationは `scripts/adapters/keyword-publication.js` に置く。filesystem lock、staging、immutable publication directory、stale-parent check、atomic `current` symlink promotionはここに残す。

adapterからProcessingのpure helper（例: `prettyJson`）を利用する依存は許容する。逆方向 `processing -> scripts/adapters` は禁止。

## 4. WorkflowValidationError

現在account featureがkeyword featureの `WorkflowValidationError` をimportしている横依存を解消する。

新規:

```text
src/processing/shared/workflow-validation-error.js
```

keyword/account双方がsharedからimportする。

必要なら `candidate-workflow.js` から `WorkflowValidationError` をre-exportして新module内API互換を保ってよいが、account featureがkeyword featureを直接importしてはならない。

## 5. Keyword candidate modules

### `candidate-workflow.js`

`src/lib/candidate-workflow.js` を `src/processing/keyword-candidates/candidate-workflow.js` へ移動する。

原則として既存API・アルゴリズム・hash/serialization契約を変更しない。

ただしUI責務の重複を解消するため、以下をcandidate processingから削除する。

- `DEFAULT_NEW_KEYWORD_DISPLAY_DAYS`
- `isNewCandidate()`

これらの正は `src/ui/new-badge.js` とする。

今回、以下は変更しない。

- `createRunId()` / `createRequestId()` の方式
- `canonicalizeProposal()` のUUID fallback
- candidate評価ロジック
- artifact schema
- hash algorithm

### `update-flow.js`

`src/lib/update-flow.js` を `src/processing/keyword-candidates/update-flow.js` へ移動する。挙動変更は行わない。

### `artifact-validation.js`

`src/lib/artifact-validation.js` を `src/processing/keyword-candidates/artifact-validation.js` へ移動する。`WorkflowValidationError` はsharedから参照する。

## 6. Keyword handoff workflow

`scripts/candidate-workflow.mjs` に残っている意味判定を `src/processing/keyword-candidates/handoff-workflow.js` へ抽出する。

### Processingへ移すもの

- base publication / policy / taxonomy / evaluationのbinding整合性
- source dataset SHA解決
- source dataset ref解決
- labeling evidenceの意味検証
- handoff manifestのstructure / request identity / file set / SHA整合性検証
- handoff bundleの内容生成に必要なpureな意味処理

現行関数でいう主要対象:

- `assertHandoffBaseBindings`
- `resolveDatasetSourceSha`
- `resolveDatasetSourceRef`
- `verifyLabelingEvidence` のI/Oを除いた部分
- `verifyHandoffManifest` のI/Oを除いた部分

### Script側に残すもの

- CLI引数解析
- `fs` / `path` を用いたread/write
- labeling summary / validation JSONのread/parsing
- runtime contract filesのread
- publication filesのread
- handoff directory作成
- handoff filesのwrite
- export directoryのwrite
- stdout / exit handling

### 境界API

実装時は少なくとも次の2つのpure boundaryを用意する。名前は以下を使用する。

```js
prepareHandoffBundle({
  registry,
  evaluation,
  publishedCandidates,
  currentMeta,
  baseManifest,
  datasetInput,       // { value, bytes }
  policyInput,        // { value, bytes }
  taxonomyInput,      // { value, bytes }
  labelingEvidence,  // undefined or { summary, validation }
  explicitSourceSha,
  explicitSourceRef,
  requestId,
  runtimeBytes,       // filename -> Buffer
})
```

返却:

```js
{
  request,
  sourceSha,
  sourceRef,
  handoffManifest,
  files, // filename -> Buffer。handoff_manifest.json を含む。
}
```

および:

```js
verifyHandoffBundle({
  manifest,
  request,
  handoffFiles, // filename -> Buffer
  cliFiles,     // filename -> Buffer
})
```

Processing APIへfilesystem pathを渡さない。

既存のcoded error codeは維持する。

- `HANDOFF_INPUT_MISMATCH`
- `SOURCE_SHA_REQUIRED`
- `SOURCE_REF_REQUIRED`
- `DATASET_ARTIFACT_HASH_MISMATCH`
- `LABELING_EVIDENCE_INVALID`
- `HANDOFF_MANIFEST_MISMATCH`
- その他既存テストが依存するcode

## 7. Keyword publication

移動:

```text
src/lib/publication.js
-> scripts/adapters/keyword-publication.js
```

維持する公開関数・挙動:

- `resolveCurrentPublicationDir`
- `publishBundleAtomically`
- `readCurrentPublication`
- lock
- stale-parent protection
- immutable publication directory
- duplicate run ID rejection
- atomic `current` promotion

`candidate-workflow.mjs`、`publication.test.js`、`handoff.test.js` のimportを新pathへ更新する。

## 8. Account candidate — provenance互換例外

### 実装本体

移動:

```text
src/lib/account-block-candidate-workflow.js
-> src/processing/account-block-candidates/account-block-candidate-workflow.js
```

新実装は `WorkflowValidationError` を `processing/shared` からimportする。

### 旧path shim

`src/lib/account-block-candidate-workflow.js` は削除せず、以下だけを持つ通常ファイルとして残す。

```js
export * from "../processing/account-block-candidates/account-block-candidate-workflow.js";
```

symlinkは禁止。

### 絶対条件

`scripts/account-block-candidate-workflow.mjs` は **byte-for-byte変更しない**。

`scripts/verify-data.mjs` も今回変更しない。

理由は `ACCOUNT_GENERATOR_PROVENANCE_EXCEPTION.md` を参照。

そのためaccount script内のmanifest/meta orchestrationやpublication処理は今回抽出しない。左右対称な構造にするためだけに変更範囲を拡大しない。

## 9. Comment DB

移動のみを基本とする。

```text
src/lib/comment-database.js
-> src/database/comment-database.js
```

`scripts/comment-database.mjs` とtestsのimport pathを更新する。

今回変更しない:

- `importNormalizedPayloadFile()`
- normalized input schema
- payload hashing semantics
- SQLite schema/migration
- transaction semantics
- default DB path semantics

既存Comment DB handoffではcollector-specific parsingをDB外の別adapter/follow-upとする判断が既に閉じている。今回再度設計しない。

## 10. UI

移動:

```text
src/App.jsx            -> src/ui/App.jsx
src/styles.css         -> src/ui/styles.css
src/lib/new-badge.js   -> src/ui/new-badge.js
```

追加:

```text
src/ui/candidate-data.js
src/ui/candidate-data-adapter.js
```

### `candidate-data.js`

generated JSONをimportできるUI moduleはここだけとする。

- `filterKeywordCandidates.json`
- `accountBlockCandidates.json`
- `candidateWorkflowConfig.json`

raw artifactをadapterへ渡し、UI modelのみexportする。

### `candidate-data-adapter.js`

pureなartifact -> UI model変換を行う。Appが実際に利用するフィールドだけを公開し、artifact全schemaのコピーを作らない。

Keyword UI model:

```js
{
  candidateId,
  keyword,
  variants,
  category,
  recommendation,
  matchType,
  directNuisanceHits,
  reactiveHits,
  normalHits,
  precisionExcludingReactive,
  introducedAt,
}
```

Account UI model:

```js
{
  handle,
  directNuisanceCount,
  evidence, // [{ comment, postedAt, postedDate }]
}
```

Config UI model:

```js
{
  newKeywordDisplayDays,
}
```

主な変換:

```text
candidate_id                  -> candidateId
match_type                    -> matchType
direct_nuisance_hits          -> directNuisanceHits
reactive_hits                 -> reactiveHits
normal_hits                   -> normalHits
precision_excluding_reactive  -> precisionExcludingReactive
introduced_at                 -> introducedAt

direct_nuisance_count         -> directNuisanceCount
evidence_sample               -> evidence

new_keyword_display_days      -> newKeywordDisplayDays
```

`App.jsx` は上記UI model名だけを参照する。React keyは `candidateId` を使う。

UIコピーの変更はarchitecture上必須ではないため、既存footer等の表示文言は原則変更しない。文字列中に `src/data/...` や `candidate_id` が出ること自体はimport/schema依存テストの対象にしない。

### `main.jsx`

importだけ更新する。

```js
import App from "./ui/App";
import "./ui/styles.css";
```

## 11. Architecture test

新規:

```text
tests/architecture-boundaries.test.js
```

外部lint/plugin依存は追加せず、Node標準 `node:test` で静的importを走査する。

最低限保証すること:

1. `src/lib/` に存在できるのは `account-block-candidate-workflow.js` だけ。
2. そのshimに実装ロジックを置かず、新Processing moduleへのre-exportだけである。
3. `src/processing/**` から `src/database/**`、`src/ui/**`、`scripts/**`、React、`node:sqlite` へのimportを禁止。
4. keyword/account Processing featureの直接相互importを禁止。
5. `src/ui/candidate-data.js` 以外のUI moduleから `src/data/*.json` のimportを禁止。
6. `App.jsx` がraw generated JSONを直接importしていない。

AST parser等の新dependencyは不要。

## 12. Scope外 / 禁止変更

以下を同PRで変更しない。

- account generator provenance契約
- `verify:data` のgenerator検証方式
- account CLI script bytes
- generated artifactsの再生成・手編集
- candidate評価policy / algorithm
- artifact schema
- hash algorithm / serialization contract
- UUID生成方式
- Comment DB public behavior
- SQLite schema/migration
- CLI command名 / option
- publication atomicity semantics
- handoff protocol version
- collector実装・架空interface
- TypeScript化
- DI framework導入
- 汎用 `utils` / `lib` ディレクトリの新設

## 13. Documentation

packageルートに `ARCHITECTURE.md` を追加し、以下を記述する。

- 4責務の意味
- `scripts/adapters` は第5レイヤーではないこと
- Processingの依存禁止規則
- UI data adapter境界
- Comment DBとcollector adapterの境界
- account legacy shimの存在理由と削除条件

既存READMEから `ARCHITECTURE.md` へのリンクを追加する。
