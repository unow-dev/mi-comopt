# Candidate workflow scripts

`candidate-workflow.mjs` は、handoff の契約に従うローカル決定処理を提供します。

```bash
npm run candidate-workflow -- bootstrap ...
npm run candidate-workflow -- evaluate ...
npm run candidate-workflow -- generate-request ...
npm run candidate-workflow -- canonicalize-proposal ...
npm run candidate-workflow -- prepare-handoff ...
npm run candidate-workflow -- full-update ...
npm run candidate-workflow -- validate-current ...
```

LLM provider/APIは呼び出しません。`candidate-proposal.json` は外部境界から受け取り、以降をローカルで検証・canonicalize・評価・publicationします。

## Manual ChatGPT handoff

### 1. Handoffを生成する

```bash
npm run candidate-workflow -- prepare-handoff \
  --publication-root ./candidate-publication \
  --dataset ./three-class.json \
  --policy ./candidateEvaluationPolicy.json \
  --taxonomy ./candidateTaxonomy.json \
  --source-ref upstream://integrated-labeling/three-class \
  --outdir ./handoff
```

`--outdir` は既存directoryを指定できません。生成物は11ファイルで、`handoff_manifest.json` はローカル検証用なのでChatGPTへ渡しません。

### 2. ChatGPTへ投入する

`prompt.txt` をチャットメッセージとして貼り付け、残り9ファイルを添付します。`handoff_manifest.json` は添付しません。

### 3. JSON-only回答を保存する

ChatGPTの最終回答を編集せず、単一のJSON objectとして `candidate_proposal.json` に保存します。Markdown code fenceや説明文が含まれる場合は自動修復せず、JSON-onlyで再出力させます。

### 4. `full-update`を実行する

```bash
npm run candidate-workflow -- full-update \
  --registry ./candidate-publication/current/candidate_registry.json \
  --request ./handoff/candidate_generation_request.json \
  --proposal ./candidate_proposal.json \
  --dataset ./handoff/source_dataset.json \
  --policy ./handoff/evaluation_policy.json \
  --taxonomy ./handoff/taxonomy.json \
  --candidate-view ./handoff/candidate_view.json \
  --pre-evaluation ./handoff/pre_evaluation.json \
  --handoff-manifest ./handoff/handoff_manifest.json \
  --outdir ./candidate-publication
```

手動handoffでは `--handoff-manifest`、`--candidate-view`、`--pre-evaluation` を必須にします。`canonicalize-proposal` は診断・開発用であり、production handoffの事前手順には含めません。`add` のcandidate IDは `full-update` 内で一度だけ発行されます。
