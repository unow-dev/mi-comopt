# Implementation specification — MVP v1

## 1. Scope

### Implement

1. `prepare-handoff` CLI command。
2. stable runtime contract resources。
3. minimal `handoff_manifest.json` generation / verification。
4. current publicationを1回だけresolveするhelper。
5. `prepareFullUpdate()` のpolicy/taxonomy request binding強化。
6. manual handoff経由の`full-update`でbundle byte integrityを検証。
7. tests / scripts README。

### Do not implement

- ChatGPT/OpenAI API call
- provider/model/settings metadata
- privacy/anonymization/sanitizer
- raw response保存
- execution receipt
- attempt/retry history
- ZIP runtime generation
- response repair / Markdown fence removal
- automatic rebase
- policy/taxonomy migration
- JSON Schema engine導入
- candidate ID deterministic化
- standalone `canonicalize-proposal` の削除

---

## 2. Stable runtime resource location

Issue配下のdocsをruntime dependencyにしない。

repository/package側に以下を置く。

```text
contracts/candidate-handoff/v1/
├── prompt.txt
├── PROMPT_CONTRACT_v1.md
├── candidate-proposal.schema.json
└── common.schema.json
```

この4ファイルをmanual handoff用のcanonical runtime copyとする。

`prepare-handoff` は `import.meta.url` 等を起点に絶対pathを解決し、process cwdへ依存しない。

このhandoff bundle内の `contracts/candidate-handoff/v1/` に、採択済み内容を同梱している。

---

## 3. New CLI: `prepare-handoff`

### Interface

```bash
candidate-workflow prepare-handoff \
  --publication-root DIR \
  --dataset FILE \
  --policy FILE \
  --taxonomy FILE \
  --outdir DIR \
  [--request-id ID] \
  [--source-ref REF] \
  [--source-sha SHA]
```

### Required input semantics

- `--publication-root`: `current` symlinkと`publications/`を持つpublication root。
- `--dataset`: 今回ChatGPTへ渡し、pre-evaluationにも使用する3-class dataset。
- `--policy`, `--taxonomy`: base publicationと同一version/contentであること。MVPではpolicy/taxonomy変更を同時に行わない。
- `--outdir`: **存在していてはいけない**。空directoryでもreject。

### `request-id`

- 指定時: そのIDを使用。
- 未指定時: 既存 `createRequestId()`。
- 固定request ID + 同一入力bytes/同一base publication/同一runtime resourcesなら、生成handoffはbyte-identicalであること。

---

## 4. Resolve current publication exactly once

`src/lib/publication.js` に、current symlink targetを固定するhelperを追加する。

例:

```js
export function resolveCurrentPublicationDir(rootDir) {
  return fs.realpathSync(path.join(path.resolve(rootDir), "current"));
}
```

要件:

- `prepare-handoff` 開始時に1回だけ呼ぶ。
- 以降、`current/...` を再参照しない。
- 以下5ファイルをresolved immutable directoryから読む。

```text
candidate_registry.json
candidate_evaluation.json
filterKeywordCandidates.json
filterKeywordCandidates.meta.json
run_manifest.json
```

handoff生成中に`current`が別runへpromotionされても、2 publicationを混在させない。

既存 `readCurrentPublication()` の挙動は本Issueでは変更しない。

---

## 5. Validate base publication before handoff generation

まず既存 `validateGeneratedArtifacts({ registry, evaluation, publishedCandidates, currentMeta, manifest, taxonomy })` を実行する。

その上で、handoff固有のcross-bindingを検証する。

```text
currentMeta.run_id
== manifest.run_id

currentMeta.dataset_artifact_sha256
== manifest.source_dataset.artifact_sha256
== evaluation.dataset.artifact_sha256

currentMeta.evaluation_policy_version
== manifest.evaluation_policy.version
== evaluation.evaluation_policy.version
== policy.policy_version

currentMeta.evaluation_policy_content_sha256
== manifest.evaluation_policy.content_sha256
== evaluation.evaluation_policy.content_sha256
== contentSha256(policy)

currentMeta.taxonomy_version
== manifest.taxonomy.version
== taxonomy.taxonomy_version

currentMeta.taxonomy_content_sha256
== manifest.taxonomy.content_sha256
== contentSha256(taxonomy)
```

registry hashes / run manifest content hash / published candidate hashは既存validatorの検証を再利用する。

handoff固有cross-binding不一致は `HANDOFF_INPUT_MISMATCH`。
既存validatorが出すerror codeは潰さず、そのまま返す。

---

## 6. Dataset identity: upstream SHA and handoff byte SHA are different concepts

### 6.1 Upstream artifact identity

`candidate_generation_request.json` の

```text
source_dataset.artifact_sha256
```

は既存契約どおり **upstream publication artifact identity** である。

handoff内 `source_dataset.json` のraw byte SHAをここへ入れてはいけない。

### 6.2 Resolve upstream source SHA

`prepare-handoff` は次の順序でsource SHAを決定する。

1. `--source-sha` があればそれをcandidate valueとする。
2. dataset top-level `artifact_sha256` があればcandidate valueと照合する。
3. dataset `manifest.artifact_sha256` があればcandidate valueと照合する。
4. 複数値が存在して互いに不一致ならfail。
5. どこにも値がなければ `SOURCE_SHA_REQUIRED`。
6. SHA形式は既存契約の `sha256:<64 lowercase hex>`。

既存 `DATASET_ARTIFACT_HASH_MISMATCH` を利用できる箇所では再利用してよい。

最終的なresolved SHAを `evaluateCandidates(... artifactSha256)` と `makeGenerationRequest(... sourceDatasetArtifactSha256)` の両方へ渡す。

### 6.3 Resolve source ref

```text
--source-ref supplied
    → supplied refを使用

--source-ref omitted
AND resolved source SHA == base manifest.source_dataset.artifact_sha256
    → base manifest.source_dataset.artifact_ref を継承

--source-ref omitted
AND resolved source SHA != base SHA
    → SOURCE_REF_REQUIRED
```

同じSHAへ別refを明示指定することは許可する。refはcontent identityではなくprovenance location/referenceだからである。

---

## 7. Generate the deterministic request inputs

base publicationのregistryと今回のdatasetを使って再評価する。既存`candidate_evaluation.json`を今回のpre-evaluationとして流用しない。

```js
evaluation = evaluateCandidates({
  registry,
  dataset,
  policy,
  policyContentSha256: contentSha256(policy),
  taxonomy,
  artifactSha256: resolvedSourceSha,
  knownConflictKeys: [...conflictSet(registry)],
});

candidateView = buildCandidateView(registry);
preEvaluation = buildPreEvaluation(evaluation);
```

request:

```js
request = makeGenerationRequest({
  requestId,
  baseRunId: manifest.run_id,
  baseRegistryContentSha256: contentSha256(registry),
  sourceDatasetArtifactSha256: resolvedSourceSha,
  sourceDatasetArtifactRef: resolvedSourceRef,
  candidateView,
  preEvaluation,
  evaluationPolicy: {
    version: policy.policy_version,
    content_sha256: contentSha256(policy),
  },
  taxonomy: {
    version: taxonomy.taxonomy_version,
    content_sha256: contentSha256(taxonomy),
  },
});
```

`makeGenerationRequest()` 自体のschema/semantic contractは変更しない。

---

## 8. Output directory contract

### Exclusive create

`--outdir` が既に存在する場合は、空でも非空でも `HANDOFF_OUTPUT_EXISTS`。
parent directoryは `mkdir(..., { recursive: true })` で作成してよいが、`outdir` 自体はrecursive createせず排他的に取得する。

既存directoryを変更・削除・上書きしない。

実装イメージ:

```js
let ownsOutputDir = false;
try {
  fs.mkdirSync(outdir); // recursive=false
  ownsOutputDir = true;
  // write files
} catch (error) {
  if (ownsOutputDir) fs.rmSync(outdir, { recursive: true, force: true });
  throw error;
}
```

`mkdir` が `EEXIST` なら `ownsOutputDir` をtrueにしてはいけない。

通常例外で失敗した場合のみ、その実行が新規作成したdirectoryをcleanupする。
process kill / machine crashでpartial directoryが残った場合、次回は自動修復・自動削除せず `HANDOFF_OUTPUT_EXISTS` とする。

---

## 9. Handoff files

生成directoryは **11ファイル**。

```text
handoff/
├── handoff_manifest.json        # local integrity only; ChatGPTへ渡さない
├── prompt.txt                   # ChatGPTへ渡す
├── PROMPT_CONTRACT_v1.md        # ChatGPTへ渡す
├── candidate_generation_request.json
├── candidate_view.json
├── pre_evaluation.json
├── evaluation_policy.json
├── taxonomy.json
├── source_dataset.json
├── candidate-proposal.schema.json
└── common.schema.json
```

### Write mode

| File | Write rule |
|---|---|
| `prompt.txt` | canonical runtime resource raw bytesをcopy |
| `PROMPT_CONTRACT_v1.md` | canonical runtime resource raw bytesをcopy |
| `candidate-proposal.schema.json` | canonical runtime resource raw bytesをcopy |
| `common.schema.json` | canonical runtime resource raw bytesをcopy |
| `source_dataset.json` | `--dataset` raw bytesをcopy |
| `evaluation_policy.json` | `--policy` raw bytesをcopy |
| `taxonomy.json` | `--taxonomy` raw bytesをcopy |
| `candidate_view.json` | `prettyJson(candidateView)` |
| `pre_evaluation.json` | `prettyJson(preEvaluation)` |
| `candidate_generation_request.json` | `prettyJson(request)` |
| `handoff_manifest.json` | section 10のobjectを`prettyJson()` |

外部入力JSONを読み直してpretty-printしてからhandoffへ書かない。実際にoperatorが指定したbytesを保持する。

---

## 10. Minimal handoff manifest

`handoff_manifest.json` はaudit logではない。handoff実ファイルのcopy/edit事故を検知するためのminimal integrity index。

timestamp/model/operator/privacy fieldsを入れない。

形:

```json
{
  "schema_version": 1,
  "request_id": "cgr_...",
  "input_fingerprint": "sha256:...",
  "files": {
    "prompt.txt": "sha256:...",
    "PROMPT_CONTRACT_v1.md": "sha256:...",
    "candidate_generation_request.json": "sha256:...",
    "candidate_view.json": "sha256:...",
    "pre_evaluation.json": "sha256:...",
    "evaluation_policy.json": "sha256:...",
    "taxonomy.json": "sha256:...",
    "source_dataset.json": "sha256:...",
    "candidate-proposal.schema.json": "sha256:...",
    "common.schema.json": "sha256:..."
  }
}
```

`files.*` は **最終的にhandoffへ書き込まれるraw bytes** のSHA-256 (`sha256:<hex>`)。

manifest自身はhash対象にしない。

`request_id` / `input_fingerprint` は生成requestと一致必須。

実装では、10ファイルのfinal bytesを確定 → SHA計算 → manifest生成、の順にする。

---

## 11. Fixed prompt

`contracts/candidate-handoff/v1/prompt.txt` をそのまま使用する。

promptはtransport instructionだけを持ち、candidate semantic rulesを複製しない。semantic source of truthは `PROMPT_CONTRACT_v1.md`。

`candidate-proposal.schema.json` のabsolute `$ref` は変更しない。promptで、添付`common.schema.json`を利用し外部取得不要であることを指示する。

---

## 12. Return path from ChatGPT

operatorはChatGPTの最終回答を **内容を編集せず** `candidate_proposal.json` として保存する。

MVPでは以下を実装しない:

- Markdown fence stripping
- proseからJSONだけ抽出
- field補完
- action/keyword/variant修正

回答全体がJSONとしてparseできなければfailし、ChatGPTへJSON-onlyで再出力させる。

### Important: do not pre-run standalone canonicalization in production procedure

manual production procedureは:

```text
candidate_proposal.json
        ↓
full-update
        ├─ validateProposal()
        ├─ canonicalizeProposal()  # add ID issuance happens here once
        ├─ deterministic evaluation
        └─ publication
```

`canonicalize-proposal` commandを先に実行してchange setを作り、その後`full-update`を実行する手順は禁止。

理由: standalone commandと`full-update`がそれぞれ`canonicalizeProposal()`を呼ぶと、`add`で異なるrandom candidate IDを発行し得る。

command自体はdiagnostic/development用途として残す。

---

## 13. Strengthen request bindings in `prepareFullUpdate()`

既存registry bindingは維持:

```js
contentSha256(registry) === request.base_publication.registry_content_sha256
```

不一致は既存 `STALE_PARENT`。

追加で、proposal canonicalization / publicationに進む前に最低限以下を検証する。

```text
policy.policy_version
== request.evaluation_policy.version

contentSha256(policy)
== request.evaluation_policy.content_sha256

taxonomy.taxonomy_version
== request.taxonomy.version

contentSha256(taxonomy)
== request.taxonomy.content_sha256
```

不一致は既存 `REQUEST_ARTIFACT_MISMATCH` を使用する。

Dataset upstream identityは既存 `evaluateCandidates(... artifactSha256: request.source_dataset.artifact_sha256)` → `validateDataset()` の契約を維持する。

**request.source_dataset.artifact_sha256 とdataset file raw SHAを比較してはいけない。**

---

## 14. `full-update` manual-handoff integrity verification

既存`full-update`利用との後方互換のため、新しいmanifest optionはoptionalとする。

追加option:

```text
--handoff-manifest FILE
```

manual ChatGPT procedureでは必須とREADMEに記載する。

`--handoff-manifest` が指定された場合:

1. manifest JSONをparse。
2. `manifest.request_id == request.request_id`。
3. `manifest.input_fingerprint == request.input_fingerprint`。
4. manifestと同じhandoff directory内の10ファイルがすべて存在し、raw byte SHAがmanifestと一致することを確認。
5. CLIで実際に指定された以下のfile bytesも、対応manifest entryと一致させる。
   - `--request`
   - `--dataset`
   - `--policy`
   - `--taxonomy`
   - `--candidate-view`
   - `--pre-evaluation`
6. manifest付きmanual flowでは`--candidate-view`と`--pre-evaluation`を必須にする。
7. mismatchは `HANDOFF_MANIFEST_MISMATCH`。

proposalはhandoff生成後に作られるためmanifest対象外。`request_id` / `input_fingerprint` と既存proposal validationでbindingする。

registryもmanifest対象外。requestのbase registry hashとpublication時の`STALE_PARENT`でbindingする。

---

## 15. CLI success output

`prepare-handoff` success stdout:

```json
{
  "request_id": "cgr_...",
  "input_fingerprint": "sha256:...",
  "source_dataset": {
    "artifact_ref": "...",
    "artifact_sha256": "sha256:..."
  },
  "outdir": "/absolute/or/resolved/path"
}
```

stdoutにprompt本文やdataset内容を出さない。

---

## 16. Error codes

New MVP codes:

| Code | Condition |
|---|---|
| `HANDOFF_OUTPUT_EXISTS` | `--outdir` が既に存在 |
| `HANDOFF_INPUT_MISMATCH` | base publication / supplied policy/taxonomy cross-binding不一致 |
| `SOURCE_SHA_REQUIRED` | datasetからupstream artifact SHAを確定できず、`--source-sha`もない |
| `SOURCE_REF_REQUIRED` | new source SHAなのに`--source-ref`がない |
| `HANDOFF_MANIFEST_MISMATCH` | manifest構造/ID/fingerprint/file byte SHAが期待と一致しない |

既存validation errorは可能な限りそのまま返す。

---

## 17. Manual operator procedure to document

### A. Generate

```bash
npm run candidate-workflow -- prepare-handoff \
  --publication-root ./candidate-publication \
  --dataset ./three-class.json \
  --policy ./candidateEvaluationPolicy.json \
  --taxonomy ./candidateTaxonomy.json \
  --source-ref upstream://integrated-labeling/three-class \
  --outdir ./handoff
```

`--source-sha` はdataset metadataから確定できない場合のみ追加。

### B. Send to ChatGPT

handoffにはmanifestを除く10個のChatGPT-facing fileがある。実際のUI操作では、`prompt.txt` の内容をチャット本文として貼り付け、残る9ファイルを添付する。`prompt.txt` 自体を添付する必要はない。

manifestはChatGPTへ送らない。

### C. Save answer

ChatGPTのJSON-only回答全体を `candidate_proposal.json` として保存。手編集しない。

### D. Publish through existing full-update

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

handoff作成後に`current`が変わっていれば、registry hash / publication stale-parent境界でrejectされる。自動rebaseしない。

