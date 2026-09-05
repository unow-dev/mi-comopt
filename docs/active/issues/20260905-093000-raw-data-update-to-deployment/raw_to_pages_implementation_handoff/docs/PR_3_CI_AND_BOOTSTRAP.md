# PR 3 — CI / GitHub Pages / production bootstrap

## 目的

新しい継続workflowを実際の最新full raw snapshotで一度通し、GitHub Pagesまで公開して次回runへ接続する。

## 1. deploy-pages.yml

現状:
`push main -> npm ci -> build -> deploy`

変更後:

### pull_request
- checkout
- Node 24
- `npm ci`
- Integrated Labeling Python tests
- `npm test`
- `npm run verify:release`
- `npm run build`
- deployなし

### push main / workflow_dispatch
同じvalidation/build後のみ:
- configure Pages
- upload artifact
- deploy
- deployed `data-release.json` verification

### Python tests

議論セットのbaseline command:

```bash
python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/tests/run_all_tests.py'
```

repository実体に合わせてpathを使う。

## 2. deployed data-release verification

deploy stepのpage URLから`data-release.json`をHTTP GETする。

リトライを入れる:
- deploy直後の反映遅延を考慮
- bounded retry
- 最終的に200でなければfail

取得bytesがbuild inputの
`package/public/data-release.json`
とbyte一致すること。

HTML asset path検査だけを主判定にしない。data release identityの一致を主判定にする。

## 3. bootstrap production run

### Step 0: raw

Collector/integrationが最新authoritative full snapshotを:
`work/<run>/current_raw.json`
として用意。

scope/sourceをoperatorが記録。

### Step 1: Stage13 bootstrap reference

検証済みlegacy accepted Stage13が回収できる場合のみ利用可。

回収できない場合:
immutable baseline
`reference/stage13_labeled_REFERENCE.json`

をreferenceにする。

### Step 2: Stage13

prepare -> human review -> finalize。

最終validateまで同じreferenceを指定。

### Step 3: 3-Class

bootstrap operational registriesを使用。

first pass -> human mandatory review -> promotion -> overrideなしstrict final。

### Step 4: integrated validate

必須:
- require-resolved
- three-class audit
- all_checks_passed
- unresolved mandatory 0
- final_published true

### Step 5: keyword

current public keyword publicationをbaseにhandoff/proposal/full-update。

親manifest lineageを記録。

### Step 6: account

同じthree-class finalから生成。
今回のkeyword metaを渡す。

### Step 7: release record

actual raw/Stage13/reference/three-class + staging 8artifactから
`package/public/data-release.json`
を生成。

### Step 8: local verification

- `npm test`
- `npm run verify:data`
- `npm run verify:release`
- `npm run build`
- Integrated Labeling tests

### Step 9: Git / CI / Pages

公開8artifact + operational registries + `data-release.json` +必要な運用文書のみcommit。

raw/work filesはcommitしない。

CI green後mainへmerge/pushしPages deploy。

deployed `data-release.json`一致確認。

### Step 10: Stage13 reference promotion

公開成功後だけ今回Stage13 outputを
`var/integrated-labeling/stage13_reference.json`
へpromotion。

### Step 11: next-run smoke

次回run用の`prepare-stage13`をdry/smokeで起動し、
private operational referenceが読めることを確認。

ここまででbootstrap acceptance完了。

## 4. recurring runbook update

既存
`RECURRING_UPDATE_WORK_TASK_SEQUENCE.md`
を更新する。

必須修正:
- fixed Stage13 baseline -> previous accepted reference
- mandatory review CSV -> `record_key,label,reason_code,note`
- review後registry promotion
- account candidate updateをkeyword後に追加
- same dataset SHA gate
- UI import境界を`package/src/ui/candidate-data.js`へ修正
- `data-release.json`生成/verify
- CI tests/verify/build/deploy
- Pages `data-release.json`確認
- deploy成功後Stage13 reference promotion
