# 最終実装仕様

## 1. 問題定義

現状は個別の処理が存在しますが、継続更新として次の3点が閉じていません。

1. Stage 13の過去人手判断が次回runへ継続されない。
2. 3-Classのmandatory reviewが一時override CSVに留まり、次回runで再レビューになる。
3. keyword候補だけが既存継続手順に明示されており、account候補を同じdataset snapshotから同時に更新するrelease gateがない。

さらにPages workflowは現在 `npm ci -> npm run build -> deploy` のみで、公開artifactの整合性をdeploy前に検証していません。

## 2. raw snapshot contract

### 採択

Stage 13へ渡す`current_raw.json`は**差分ファイルではなく、今回の候補評価母集団となるauthoritative full snapshot**です。

Collector実装は今回out of scopeです。Collector/integration側がfull snapshotを作った後からこのworkflowが開始します。

### raw record

各recordのキーは既存契約どおりexactに次の5つです。

- `username`
- `handle`
- `comment`
- `postedAt`
- `postedDate`

5値はすべてJSON stringでなければなりません。

同一5-field rowを自動dedupしません。同一内容の複数出現が取得重複か実イベント重複かを5-fieldだけから判別できないためです。

### release record用raw metadata

`data-release.json`生成時にoperatorが次を渡します。

- raw file
- `scope_id`: 同一collection semanticsを表すstable opaque string
- `source_ref`: 取得元・snapshotを識別できる文字列

`data-release.json`にはraw SHAとrecord countを必ず記録します。

## 3. Stage 13 continuity

### bootstrap

優先順位:

1. 現行公開three-class datasetへ検証可能にbindされた直近Stage 13出力が回収できる場合は、それをbootstrap referenceに使ってよい。
2. 回収・検証できなければimmutable baseline:
   `reference/stage13_labeled_REFERENCE.json`
   を使う。

公開candidateからStage 13 labelを逆算・推測してはいけません。

### 2回目以降

standard reference:

`var/integrated-labeling/stage13_reference.json`

このファイルはGitへcommitしません。

公開成功後のみ今回の`stage13_labeled.json`をここへpromotionします。run途中・CI失敗・deploy失敗の結果はpromotionしません。

### standard commands

`prepare-stage13`、`finalize-stage13`、最終`validate`の3箇所すべてに**同じreference pathを明示**します。

`validate`で`--reference`を省略するとimmutable baselineへ戻るため、継続runでは禁止です。

## 4. 3-Class operational registries

### 配置

Git管理する継続state:

- `docs/active/operations/integrated-labeling-state/three_class_golden_adjudications.json`
- `docs/active/operations/integrated-labeling-state/three_class_p2_adjudications.json`

immutable baselineは従来の`reference/`配下に残します。

### operational registry form

既存loaderが必要とする最小形式を使います。

```json
{
  "schema_version": 1,
  "registry_version": "operational",
  "decision_count": 123,
  "decisions": [
    {
      "record_key": "24hex...",
      "stage13_label": "normal",
      "label": "reactive",
      "reason_code": "quoted_attack",
      "rationale": "Reviewed exact case: quoted or referenced attack context."
    }
  ]
}
```

baseline固有の`source_stage13_sha256`、baseline source indices等を新operational registryのtop-level provenanceとしてコピーしないでください。複数runのdecisionを累積したstateに単一baseline runのmetadataを残すと意味が不正確になるためです。

decisionsは`record_key`昇順でserializeします。

### review CSV

mandatory review templateは:

`record_key,label,reason_code,note`

とします。

既存`load_three_overrides()`は追加columnを許容するため、必要なら暫定的にstrict-finalへ渡せますが、標準運用は次です。

1. first pass
2. 人間review
3. operational registryへpromotion
4. overrideなしでstrict final再実行

### golden mapping

- `direct_target` -> `direct_nuisance`
- `mixed_target` -> `direct_nuisance`
- `spam` -> `direct_nuisance`
- `anti_target` -> `reactive`
- `support_reaction` -> `reactive`
- `meta_reaction` -> `reactive`
- `quoted_attack` -> `reactive`
- `normal_context` -> `normal`

### P2 mapping

既存pipeline contractをそのまま使います。

- `confirm_normal` -> `normal`
- `reactive_context` -> `reactive`
- `direct_target` -> `direct_nuisance`
- `spam_or_inappropriate_request` -> `direct_nuisance`

P2 registryへpromotionできるのは、current audit上でpriority 2かつP2 exact-case review対象として成立するrecordだけです。`empty_comment`等の別理由priority-2をP2 registryへ入れてはいけません。

### overwrite

通常updateでは既存`record_key`のdecisionを別decisionへ上書きしません。競合した場合はfailしてください。decision correction frameworkは今回out of scopeです。

### public/private note

人間の自由記述`note`はoperational registryの`rationale`へ直接コピーしません。`rationale`は`reason_code`から定型化された安全な文言を生成します。

## 5. keyword publication

既存keyword workflowを維持します。

更新時は現在の公開5artifactを作業用publication rootのbaseとして使い、`package/src/data`を直接publication rootにはしません。

公開projection:

- `candidate_registry.json`
- `candidate_evaluation.json`
- `filterKeywordCandidates.json`
- `filterKeywordCandidates.meta.json`
- `run_manifest.json`

### parent manifest

現行`run_manifest.json`には`parent_manifest_content_sha256` fieldがある一方、現行production runではnullです。

低コストでlineageを改善できるため、production full-updateには親`run_manifest.json`を入力させ、以下を検証してください。

- parent manifest `run_id` == request `base_publication.run_id`
- parent manifest `registry_after_content_sha256` == request `base_publication.registry_content_sha256`

成功時、新run manifestの`parent_manifest_content_sha256`に親manifestの既存keyword semantic/content hashを記録します。

Prompt Contract v1を変更してLLMへこのSHAを書かせてはいけません。親manifestはlocal deterministic inputです。

## 6. account publication

keyword候補の更新後、**同じthree-class final dataset**からaccount候補を生成します。

account generatorへ渡す`--keyword-meta`は今回新しく生成したkeyword metaです。旧`package/src/data/filterKeywordCandidates.meta.json`を使わないでください。

既存account workflowの`DATASET_SNAPSHOT_MISMATCH` checkを利用します。

公開projection:

- `accountBlockCandidates.json`
- `accountBlockCandidates.meta.json`
- `accountBlockCandidateRunManifest.json`

keyword/accountの`published_at`は同一である必要はありません。独立したgenerator runなので、同一releaseであることはshared dataset SHAと`data-release.json`で表現します。

## 7. 公開8artifact

通常data updateで`package/src/data`の変更対象にするのはexactに次の8個です。

1. `candidate_registry.json`
2. `candidate_evaluation.json`
3. `filterKeywordCandidates.json`
4. `filterKeywordCandidates.meta.json`
5. `run_manifest.json`
6. `accountBlockCandidates.json`
7. `accountBlockCandidates.meta.json`
8. `accountBlockCandidateRunManifest.json`

通常updateで次を変更しません。

- `candidateWorkflowConfig.json`
- `bootstrap_candidate_id_map.json`
- `filterKeywordCandidates.txt`
- `accountBlockCandidates.txt`

## 8. data-release.json

新規:

`package/public/data-release.json`

schema:

```json
{
  "schema_version": 1,
  "updated_at": "RFC3339 UTC",
  "raw": {
    "sha256": "sha256:<64hex>",
    "record_count": 24622,
    "scope_id": "stable opaque id",
    "source_ref": "operator/source snapshot reference"
  },
  "stage13": {
    "sha256": "sha256:<64hex>",
    "reference_sha256": "sha256:<64hex>"
  },
  "three_class": {
    "sha256": "sha256:<64hex>"
  },
  "keyword": {
    "run_id": "run_...",
    "published_at": "...",
    "dataset_sha256": "sha256:<64hex>"
  },
  "account": {
    "run_id": "run_...",
    "published_at": "...",
    "dataset_sha256": "sha256:<64hex>"
  }
}
```

必須不変条件:

`three_class.sha256 == keyword.dataset_sha256 == account.dataset_sha256`

`data-release.json`は手書きせず、raw/Stage13/three-class実ファイルと公開8artifactから生成するscriptを追加してください。

## 9. verify:release

新しい`npm run verify:release`はGit上で検証可能な範囲をfail-closedで確認します。

必須:

- keyword公開5artifactの既存binding validation
- account公開3artifactの既存binding validation
- keyword/account dataset SHA一致
- `data-release.json`のkeyword/account run ID一致
- `data-release.json`のkeyword/account published_at一致（各自のartifactに対して。keywordとaccount同士は一致不要）
- `data-release.json.three_class.sha256` == keyword/account dataset SHA
- SHA format / schema format validation

CIにはraw/Stage13/three-class private filesが存在しないため、CIでそれらのbytesを再hashすることは要求しません。それらのSHAは`data-release.json`生成scriptがlocal production runで実ファイルから計算します。

## 10. runtime contract lifecycle

現行runtime/testの`docs/active/issues/...`依存を恒久contractへ移します。

追加:

- `package/contracts/keyword-candidates/evaluation-policy-1.0.0.json`
- `package/contracts/keyword-candidates/taxonomy-1.0.0.json`
- `package/contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json`

内容は現行contractとbyte/semantic equivalentを維持します。

更新対象:

- `package/scripts/verify-data.mjs` のaccount policy default
- candidate/account testsのcontract path
- `package/scripts/README.md`
- その他runtime/testでactive issue pathを直接参照している箇所

`package/src/lib/account-block-candidate-workflow.js`互換shimはhistorical provenance用なので、今回の理由だけで削除・意味変更しません。

## 11. Pages CI

`.github/workflows/deploy-pages.yml`を拡張します。

pull request:
- checkout
- Node 24
- `npm ci`
- Integrated Labeling tests
- `npm test`
- `npm run verify:release`
- `npm run build`
- deployしない

main push:
- 同じvalidation/build
- Pages deploy
- deploy後`data-release.json`をHTTP取得
- repository/buildに入れた`data-release.json`とbyte一致を確認

`package/public/data-release.json`はVite public assetなので、Pagesではbase配下の`data-release.json`として配信されます。

## 12. Stage13 reference promotion

Pages公開確認が成功した後にのみ、今回の`stage13_labeled.json`を:

`var/integrated-labeling/stage13_reference.json`

へatomic copyします。

promotion helperは以下を検証してください。

- source Stage13 SHA == `package/public/data-release.json.stage13.sha256`
- destination親directory作成
- temp fileへcopy
- SHA再確認
- renameで置換

deploy失敗時はpromotionしません。

## 13. UI

既存UIのgenerated data import境界は:

`package/src/ui/candidate-data.js`

です。

既存継続文書にある`package/src/App.jsx`という記述は修正してください。

UI schema自体は今回変更しません。
