# PR 2 — keyword/account joint publication + release record

## 目的

同じthree-class datasetからkeyword/account両artifactを生成し、公開8artifactを一つの更新単位として検証する。

## A. runtime contract relocation

追加:

```text
package/contracts/keyword-candidates/evaluation-policy-1.0.0.json
package/contracts/keyword-candidates/taxonomy-1.0.0.json
package/contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json
```

`reference_snapshot/sources/runtime-contracts/`の内容をsourceとして使う。

active issue pathを参照しているtests/scripts/READMEを新pathへ変更。

## B. keyword parent manifest lineage

変更対象:

- `package/scripts/candidate-workflow.mjs`
- `package/src/processing/keyword-candidates/update-flow.js`
- 必要に応じて`candidate-workflow.js`
- tests

production `full-update`へ親manifest入力を追加。

推奨CLI:
`--parent-manifest FILE`

検証:
- parent `run_id` == request base run ID
- parent `registry_after_content_sha256` == request base registry SHA

new run manifest:
`parent_manifest_content_sha256`をnullではなく実際の親manifest content SHAへ設定。

LLM proposal contractには変更を加えない。

## C. keyword staging

現在の`package/src/data`公開5artifactを作業用base publicationへ複製する。

`package/src/data`をpublication rootとして直接使わない。

full-update後、current publicationから公開5artifactをrelease stagingへ取り出す。

## D. account staging

同じthree-class finalとsummaryを使用。

`--keyword-meta`は今回のkeyword stagingで生成された
`filterKeywordCandidates.meta.json`を渡す。

空のstaging directoryへ生成。

## E. shared dataset gate

必須:

```text
keyword meta.dataset_artifact_sha256
==
account meta.dataset_artifact_sha256
==
"sha256:" + three_class summary.final_output_sha256
```

不一致なら公開artifactを`package/src/data`へ反映しない。

## F. public 8artifact

staging検証成功後のみ8artifactを`package/src/data`へコピーする。

exact allowlist:

- keyword 5
- account 3

他の`src/data`は変更しない。

## G. data-release.json generator

新規script推奨:
`package/scripts/create-data-release.mjs`

入力:
- `--raw`
- `--stage13`
- `--stage13-reference`
- `--three-class`
- `--scope-id`
- `--source-ref`
- `--data-dir`（公開8artifact stagingまたはrepository）
- `--out`

動作:
- raw JSON array parse + count
- SHA-256を実bytesから計算
- Stage13/three-class SHA計算
- keyword/account artifactをread
- shared dataset gateを検証
- `data-release.json`を生成

SHAは新release record内ではすべて`sha256:<64hex>`へnormalization。

## H. verify:release

新規:
`package/scripts/verify-release.mjs`

package script:
`"verify:release": "node scripts/verify-release.mjs"`

検証対象:
- `package/src/data`公開8artifact
- `package/public/data-release.json`
- canonical runtime contracts

keyword:
既存artifact validation functionを利用。

account:
既存`validateArtifactBindings()`を利用。

release record:
- schema
- run IDs
- per-side published_at
- shared dataset SHA
- three_class SHAとの一致
- SHA format

raw/Stage13 bytesはCIにないのでpublic verifierでは再hashしない。

## I. package/public/data-release.json

bootstrap PRで初めて生成する。実装PRで架空値を作らないこと。

## J. package scripts

package/package.json:
- `verify:release`
- 必要なら`create:data-release`

root package.json:
- rootから`npm run verify:release`可能にする。

既存`verify:data`は削除しない。account単体strict diagnosticとして維持。

## K. tests

1. current public 8artifact + correct release record pass。
2. keyword/account dataset SHA差し替えでfail。
3. keyword run ID差し替えでfail。
4. account run ID差し替えでfail。
5. release three-class SHA差し替えでfail。
6. parent manifest mismatchでfull-update fail。
7. canonical contract pathでtestsが動作。
8. runtime code/testにactive issue policy pathの残存がない（historical docsは除外可）。
