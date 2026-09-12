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
python3 scripts/promote_stage13_reference.py ...
```

## Account block candidate workflow

公開済み3-Class final、対応するsummary、account policy、現在のkeyword metaを明示入力として、候補artifactを検証してから3ファイル単位で公開します。入力不整合時は既存のaccount artifactを変更しません。

```bash
npm run account-candidate-workflow -- \
  --dataset /path/to/three_class_labeled.json \
  --summary /path/to/summary.json \
  --policy contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json \
  --keyword-meta src/data/filterKeywordCandidates.meta.json \
  --publish-dir src/data
```

公開済みaccount artifactの検証は次で行います。artifactが未生成の場合も、未生成を空配列として扱わず失敗します。

```bash
npm run verify:data
```

LLM provider/APIは呼び出しません。`candidate-proposal.json` は外部境界から受け取り、以降をローカルで検証・canonicalize・評価・publicationします。

## Manual ChatGPT handoff

### 1. Handoffを生成する

```bash
npm run candidate-workflow -- prepare-handoff \
  --publication-root ./candidate-publication \
  --dataset ./three-class.json \
  --labeling-summary ./three_class_final/summary.json \
  --labeling-validation ./validation_report.json \
  --policy ./candidateEvaluationPolicy.json \
  --taxonomy ./candidateTaxonomy.json \
  --source-ref upstream://integrated-labeling/three-class \
  --outdir ./handoff
```

`--labeling-summary` と `--labeling-validation` を両方指定すると、pipeline version、mandatory review完了、Stage13 SHA、最終three-class datasetのSHAをローカルで照合します。照合済みの最終dataset SHAがcandidate requestのsource identityになります。片方だけの指定や不一致は失敗します。両方を省略すれば、従来のsource artifact SHAを使うhandoff経路です。

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
  --parent-manifest ./candidate-publication/current/run_manifest.json \
  --candidate-view ./handoff/candidate_view.json \
  --pre-evaluation ./handoff/pre_evaluation.json \
  --handoff-manifest ./handoff/handoff_manifest.json \
  --outdir ./candidate-publication
```

手動handoffでは `--handoff-manifest`、`--candidate-view`、`--pre-evaluation` を必須にします。`canonicalize-proposal` は診断・開発用であり、production handoffの事前手順には含めません。`add` のcandidate IDは `full-update` 内で一度だけ発行されます。

## Joint publication and release identity

keyword 5 artifactとaccount 3 artifactを別々のstaging directoryへ生成した後、同じthree-class finalから作られたことを確認して原子的に公開します。

```bash
npm run publish:joint-data -- \
  --keyword-dir ./candidate-publication/current \
  --account-dir ./account-publication \
  --data-dir ./package/src/data \
  --raw ./work/<run>/current_raw.json \
  --stage13 ./work/<run>/stage13_labeled.json \
  --stage13-reference ./var/integrated-labeling/stage13_reference.json \
  --three-class ./work/<run>/three_class/three_class_labeled.json \
  --scope-id <stable-scope-id> \
  --source-ref <source-snapshot-ref> \
  --release-out ./package/public/data-release.json
```

`create:data-release`は実raw・Stage 13・reference・three-classとstaging 8 artifactからrelease recordだけを生成し、`verify:release`はrepositoryの公開8 artifactとcanonical runtime contractをfail-closed検証します。`data-release.json`がない状態で架空の値を作らず、bootstrap入力が揃うまで公開を停止します。

## Optimicom UI release

対象UI専用のread-only releaseは、schema v8へ明示migrationしたDBから生成します。export commandはDBを自動migrationせず、current keyword publicationが指す単一snapshotの整合性とsource SHAを検証します。

```bash
npm run comment-db -- migrate --db ./var/comment-history.sqlite3
npm run export:optimicom-ui -- \
  --db ./var/comment-history.sqlite3 \
  --output-root ./docs/active/temp/optimicom-react-tailwind/public
npm run verify:optimicom-ui-release -- \
  --release ./docs/active/temp/optimicom-react-tailwind/public/optimicom-ui-release.json
```

`optimicom-ui-release.json`は最後にatomic replaceされ、4つのdata artifactはcontent-addressed pathへ先に公開されます。deployment後は次で全artifactを取得して検証します。

```bash
npm run verify:deployed-optimicom-ui-release -- \
  --url https://example.test/ \
  --expected ./docs/active/temp/optimicom-react-tailwind/public/optimicom-ui-release.json
```
