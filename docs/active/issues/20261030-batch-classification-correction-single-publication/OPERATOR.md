# 一括分類修正の操作手順

## 入力と版

一括修正は `classification-correction@2`／`classificationCorrectionBatch@2.0.0` を使用する。従来の `classification-correction start` はrevision 1のまま使用できる。

一括入力のJSON Schemaと確定したTask bindingは `package/contracts/classification-correction-batch/` にある。開始コマンドのJSONは次の形式にする（値は説明用）。要求者はJSONに記入せず、operatorの認証結果から保存する。

```json
{
  "correctionOperationId": "unique-business-operation-id",
  "baseClassificationVersionId": "base-version-id",
  "corrections": [
    {
      "targetObservationId": "1001",
      "expectedLabel": "normal",
      "replacementLabel": "direct_nuisance",
      "reason": "人間が確認した修正理由"
    },
    {
      "targetObservationId": "1002",
      "expectedLabel": "reactive",
      "replacementLabel": "normal",
      "reason": "人間が確認した修正理由"
    }
  ]
}
```

代表IDは文字列で指定する。`"001"` と `"1"` は別ID。本文のtrim・文字種の正規化は行わない。同一本文グループは代表IDが異なっても重複指定できず、全メンバーのラベルがexpectedLabelと一致する必要がある。

任意の `provenance` を指定する場合、バッチ共通の `sourceSha256`・`worksetId`・`receiptRef` と、各修正の `provenance.sourceSha256`・`handoffItemId` を指定する。各修正内ですべて指定してもよい。共通値との矛盾、不完全な根拠、正本とreceiptのID集合・代表ID・本文・修正先ラベルの不一致は受け付けない。I番号からObservation IDを推測しない。

正本は `--source PATH` で同じWorkspaceのcontent-addressed ArtifactStoreへ保存できる。hashがJSONに指定したprovenanceのいずれかと一致することを確認する。登録済みの正本を使う再送では `--source` を省略できる。

## 開始と確認

以下は操作例であり、今回の実装作業では実運用に対して実行していない。

```bash
npm --workspace package run comment-data-update:v3 -- classification-correction-batch start \
  --db /path/to/comments.sqlite3 --workspace /path/to/workspace \
  --session-id new-session-id --batch-json /path/to/batch.json \
  --source /path/to/source.json --actor OS_USER
```

必要なら `--pinned-json PATH` で後続公開用のVersionを明示する。分類・Corpusはbaseの依存Versionを使い、現在のHeadと一致させる。policy等は固定Versionの存在・種別を検証し、分類policyはbaseの依存と一致させる。policy Headの更新で固定済みSessionの契約は変えない。

```bash
npm --workspace package run comment-data-update:v3 -- tasks \
  --db /path/to/comments.sqlite3 --workspace /path/to/workspace --session-id returned-session-id
```

`05-review-classification` の `correctionReview` で、全グループの本文・代表ID・影響ID・変更前後の分布・理由・根拠と、全体の件数・固定Version・hashを確認する。バッチ全体へのacceptまたはrejectを指定する。

```bash
npm --workspace package run comment-data-update:v3 -- human-task open \
  --db /path/to/comments.sqlite3 --workspace /path/to/workspace \
  --session-id returned-session-id --step-id 05-review-classification --actor OS_USER

npm --workspace package run comment-data-update:v3 -- human-task complete \
  --db /path/to/comments.sqlite3 --workspace /path/to/workspace \
  --session-id returned-session-id --step-id 05-review-classification --actor OS_USER \
  --outcome accept --rationale '確認した判断理由'
```

既定の認証はOSログインユーザーとの一致を要求する。分類policyに `correction_authorization` がある場合は要求者の許可条件にも従う。レビュアーは分類policyの `authorization`／`review_authorization` の許可条件に従う。Human Taskをopenした本人がcompleteする。

## 後続更新と公開

分類commit後、同じSessionでキーワードhandoffを受け取る。`07b-receive-keyword-proposal` をopenし、表示された出力先へ `candidate_proposal.json` を1件だけ保存してcompleteする。キーワードのレビューが提示された場合は別途判断する。

Release作成後の `13-review-production-promotion-*` は分類承認とは別の承認である。tasksで実際のStep IDを確認し、対象Releaseを確認してopen／completeする。承認後はDeployment Event受信、identity検証、Deployment状態記録まで同じSessionで進む。失敗・競合の枝からverify／recordへ進まない。

## 再送と復旧

- 同じ業務操作の再送では `correctionOperationId`、base、修正内容、理由、provenance、要求者、明示したpinを維持する。修正配列の順序変更は同一要求として扱う。
- 別の `--session-id` を指定しても、最初に登録されたSessionのIDを返す。以後は返された `sessionId` で確認・再開する。新しいSessionやProposal、公開経路は作らない。
- 同じ操作IDで内容を変えると `IDEMPOTENCY_CONFLICT` になる。省略した後続pinは最初の登録値を再利用するため、Head更新後の再送も同じ要求を参照する。
- 開始応答を失った場合も同じコマンドを再送する。開始前に操作とSessionの対応が永続保存されている。
- commitと確定レシートは同時に保存される。Task結果を失った場合も確定済みVersionを再利用する。commit後の公開失敗によって分類状態は巻き戻さない。
- 却下・superseded・cancelledとなったSessionも同じ操作IDで再生成しない。別の業務判断としてやり直す場合は、現在のHeadを再確認し、新しい操作IDとSession IDを指定する。
- レビューや公開の実行判断は実行時のユーザー指示に従う。

## 検証

```bash
npm test
npm run build

# 指定DBへは読み取り専用で接続し、SQLite backupで作った一時コピーだけを更新する。
BATCH_CORRECTION_ACCEPTANCE_DB=/path/to/comments.sqlite3 \
  node --test package/tests/v3-correction-batch-real-data.test.js

# 同じ44,419ラベルに対し、旧JOINも全件比較・測定する（数分かかる）。
BATCH_CORRECTION_ACCEPTANCE_DB=/path/to/comments.sqlite3 \
BATCH_CORRECTION_BENCHMARK_LEGACY=1 \
  node --test package/tests/v3-correction-batch-real-data.test.js
```

実データ試験はhandoff記載のVersion 12・正本・receiptに一致するDBを対象とする。DeploymentはMemoryDeploymentAdapterで検証し、GitHub Pagesへは公開しない。
