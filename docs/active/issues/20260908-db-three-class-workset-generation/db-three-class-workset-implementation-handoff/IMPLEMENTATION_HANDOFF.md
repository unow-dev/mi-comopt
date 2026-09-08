# Implementation Handoff

## 1. 目的

`ISSUE_BODY_CANONICAL.md` を満たす最小の実装差分を作る。

この機能は **Comment DB → 既存analysis projection → 既存v1.5 single-roundtrip → workset packaging** のcompositionであり、分類意味論の新規実装ではない。

## 2. 現行コードで確認済みの事実

discussion setのソース断片から以下を確認済み。

### Comment DB

- `package/scripts/comment-database.mjs`
  - `export-analysis-input` / `verify-raw-inputs` は `--snapshot-ref` とlegacy `--snapshot-sha`を受ける。
  - `--snapshot-sha` は0件で `SNAPSHOT_NOT_FOUND`、複数snapshotで `SNAPSHOT_SELECTION_AMBIGUOUS`、1件ならexact refへ解決する。
  - npm経由では `INIT_CWD` を使う `resolveInvocationPath()` が既存path contract。
- `package/src/database/raw-snapshot-repository.js`
  - `readSelectedSnapshots(db, refs)` がsnapshot存在・DB integrity・source_index連続性をfail-closedで検証する。
  - DB query結果は `payload_sha256 ASC, snapshot_index ASC`。
- `package/src/processing/analysis-input/raw-snapshot-projection.js`
  - `buildAnalysisArtifacts()` が5-field JSONとmanifestを生成する。
  - snapshotは `payloadSha256`, `snapshotIndex` 順、observationsは `sourceIndex` 順。
  - output JSONは2-space pretty JSON + trailing newline。
  - manifestには `output_sha256`, `output_record_count`, snapshot provenance/rangeが入る。

### v1.5 single-roundtrip

- `prepare-single-roundtrip`
  - `input_json`, required `--reference`, required `--workspace`, optional `--state-dir`。
  - success stdoutはJSON object。
  - expected operational/input errorsはpipeline mainでexit 3。
  - workspaceをtempで作り、成功時にtargetへrenameする。
- request identity
  - `request_id`はinput/reference/golden/P2/config/implementation bindings + semantic requestから生成される。
- workspace
  - `snapshot/input.json` を作る。
  - `request/manifest.json` の `bindings.input_sha256` がinput snapshot hashを拘束する。
  - `prepare_receipt.json` とrequest manifestのrequest_idがfinalize時に照合される。
  - `finalize-single-roundtrip` はsnapshot manifestのfile path/hash/bytesを検証するが、snapshot entryの`source` absolute pathが現在存在することは要求しない。
- zero-handoff
  - human taskが0件の場合は `FINALIZED_NO_HANDOFF` までprepare内で確定する。
  - この場合、既存 `classification_handoff_<request_id>.zip` は作られない。

## 3. 推奨変更箇所

規範仕様が要求する成果物を満たす限り内部構成は実装裁量だが、現行構造との整合性が高い推奨案は以下。

### 変更

- `package/scripts/comment-database.mjs`
  - `generate-three-class-workset` commandを追加。
  - `--reference`, `--workspace`, `--state-dir`をparse。
  - user pathを既存`resolveInvocationPath()`でabsolute化してorchestrationへ渡す。
- `package/src/database/raw-snapshot-repository.js`
  - 現在CLI privateになっている`--snapshot-sha`→exact refs解決を共通化する場合の配置候補。
  - `export-analysis-input`と新commandでselector semanticsを分岐させない。

### 新規候補

- `package/src/processing/workset/three-class-workset.js`
  - orchestration本体。
- `package/scripts/pack-three-class-workset.py`
  - transport member列挙、hash、manifest、ZIP生成・再検証を一箇所に閉じる場合の推奨配置。
- `package/templates/three-class-workset/README_FIRST.md`
  - transport ZIP内のclassification/provenance境界を説明する固定文書。
- `package/tests/three-class-workset.test.js`
  - `package.json` が `node --test tests/*.test.js` のため、テストは`tests/`直下に置く。

## 4. 推奨programmatic boundary

CLIをparse/dispatchに限定するなら、orchestration側の入口は概念的に次で十分。

```js
await generateThreeClassWorkset({
  dbPath,          // absolute or undefined
  snapshotRefs,
  snapshotShas,
  referencePath,   // absolute
  workspacePath,   // absolute
  stateDir,        // absolute or undefined
});
```

返却値はCLI成功表示に必要な最小限でよい。

```js
{
  requestId,
  worksetId,
  state,
  workspacePath,
  zipPath,
}
```

これは推奨APIであり、canonical contractではない。成果物・CLI挙動・受け入れ条件が同じなら内部API変更は可。

## 5. 推奨処理順序

### 5.1 preflight

1. final workspaceが存在しないことを確認する。
2. snapshot selectorsを既存semanticsでresolved refsへ解決する。
3. `readSelectedSnapshots()`を実行する。
4. `buildAnalysisArtifacts()`を実行する。
5. `outputJson`と`manifestJson`を**再parse/re-serializeせず、そのbytesをそのまま保持**する。

### 5.2 outer staging

既存`prepare-single-roundtrip`もatomicだが、その後にprovenance/workset ZIPを追加するため、新command全体にはouter stagingが必要。

概念例:

```text
<final-parent>/.<workspace>.workset-XXXXXX/
  analysis_input.json
  analysis_input.manifest.json
  workspace/          # pipelineの--workspace。開始時には存在させない
```

final workspaceは全工程成功まで作らない。

### 5.3 existing pipeline

同じPython executableで少なくとも以下を起動する。

```bash
python docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py \
  prepare-single-roundtrip <temp-analysis-input.json> \
  --reference <reference> \
  --workspace <staging-workspace> \
  [--state-dir <state-dir>]
```

Python runtimeを差し替える必要がある場合は、CLI surfaceを増やすより環境変数利用が適切。具体実装はrepository conventionsに従う。

pipeline success stdoutはJSON objectとしてstrictに扱う。non-zeroはworkset生成失敗。

### 5.4 integration integrity verification

最低限、以下をbyte/hashで照合する。

```text
analysis projection bytes
=
workspace/snapshot/input.json bytes
```

```text
SHA256(analysis projection bytes)
=
analysis_input.manifest.json.output_sha256
=
request/manifest.json.bindings.input_sha256
```

request identityは少なくとも、

```text
pipeline result.request_id
=
prepare_receipt.json.request_id
=
request/manifest.json.request_id
```

を要求する。

既存pipeline artifactを書き換えて一致させてはならない。不一致ならfail。

### 5.5 provenance addition

staging workspaceへ追加する。

```text
provenance/analysis_input.json
provenance/analysis_input.manifest.json
README_FIRST.md
```

`provenance/analysis_input.json`はpipelineへ渡したanalysis projectionと同一bytesにする。

`analysis_input.manifest.json`は既存`buildAnalysisArtifacts().manifestJson`と同一bytesにする。

### 5.6 workset packaging

transport対象は厳密に以下。

```text
README_FIRST.md
provenance/analysis_input.json
provenance/analysis_input.manifest.json
request/** の全regular file
```

`workset_manifest.json`自身はmember listの対象外。

member listはrelative POSIX path lexical orderで、各entryに少なくとも:

```json
{
  "path": "request/manifest.json",
  "sha256": "...",
  "bytes": 123
}
```

を持つ。

workset preimageは少なくとも:

```json
{
  "schema_version": 1,
  "protocol_version": "db-three-class-workset-v1",
  "request_id": "...",
  "members": []
}
```

とし、そのcanonical JSON SHA-256を`workset_id`にする。

完成manifestはpreimage + `workset_id`。

ZIP名:

```text
three_class_workset_<workset_id>.zip
```

ZIP container SHAはidentityにしない。

### 5.7 packaging safety

packagerは少なくとも以下をfail-closedにする。

- symlinkをtransport memberとして受理しない。
- absolute archive path禁止。
- `..` path traversal禁止。
- duplicate archive member禁止。
- extra/missing member禁止。
- ZIP生成後に再openし、member path・bytes/hash・sizeをworkspaceのsource filesと照合する。

既存v1.5 ZIPとserialization規則を合わせられるなら、fixed timestamp / fixed mode / sorted paths / `ZIP_DEFLATED`が適切。ただしZIP byte identity自体はacceptance contractではない。

### 5.8 commit

全検証成功後にのみ、outer stagingのworkspaceをrequested final workspaceへrenameする。

成功後のCLIではfinal pathのみ表示し、temporary/staging pathを漏らさない。

## 6. transport `README_FIRST.md` の責務

薄く保つ。分類規則を再定義しない。

最低限伝える内容:

1. classificationのcanonical packageは`request/`。
2. 最初に`request/REVIEW_INSTRUCTIONS.md`を読む。
3. `provenance/`はlineage確認専用で、追加のclassification evidenceにしない。
4. S/T task JSONが存在しないzero-handoff worksetではclassification response不要。

Stage13/Three-Class label definition、reason code、作業手順は既存`request/`へ委譲する。

## 7. selector共通化について

現在`--snapshot-sha`の一意解決は`comment-database.mjs`内のprivate helper。

新commandへSQLをコピーするのは不可。最低条件は`export-analysis-input`と新commandが同じ解決semanticsを共有すること。

推奨はrepository層へ共通化。ただし、既存CLIから共通helperを呼ぶ別構成でもcanonical contractを満たすなら可。

注意:

- explicit selection helperで「selectorなし」を拒否してもよいが、`verify-raw-inputs`の既存「selectorなし＝全体検証」semanticsを壊さないこと。
- selector表記自体はworkset identityへ入れない。

## 8. zero-handoff

human decision 0件でも外側workset ZIPを生成する。

既存pipelineが作ったfinalized workspaceを壊さない。

S/T directoryの存在自体をcontractにしない。task JSON file数が0であることを確認する。

## 9. 既存artifactの扱い

### 保持する

- `request/`
- `snapshot/`
- `prepare_receipt.json`
- `classification_handoff_<request_id>.zip`（存在する場合）
- zero-handoffで生成されたfinal artifacts

### transport ZIPに入れない

- `snapshot/`
- `prepare_receipt.json`
- reference/registry/config/implementation snapshots
- inner `classification_handoff_*.zip`
- finalization artifacts

既存artifactを削除・書換えして新worksetとの整合を取らない。

## 10. エラー設計

canonical specは具体code名を固定していない。既存`CommentDatabaseError` conventionsに沿うこと。

推奨分類:

- pipeline invocation failure
- integration integrity mismatch
- packaging failure
- workspace/filesystem commit failure

CLI argument errorは既存通りexit 2、runtime failureは既存Comment DB CLIと同じfailure conventionを維持するのが適切。

pipelineの内部exit 3をComment DB CLIの公開exit codeとしてそのまま漏らす必要はない。

## 11. 推奨実装順序

1. **selector resolution共通化**
   - user-visible behaviorを変えず既存testsを通す。
2. **workset packager単体**
   - synthetic workspaceでmember/hash/manifest/ZIP/anti-symlinkを検証。
3. **orchestration module**
   - temporary DB + isolated state-dir + explicit referenceで実pipelineへ接続。
4. **CLI wiring**
   - command/help/options/path resolution追加。
5. **regression/E2E**
   - Comment DB tests + v1.5 tests + generated workspace finalize compatibility。

## 12. 実装者が自由に決めてよいこと

- private function名
- internal module分割
- temp directory basename
- helper class/functionの形
- subprocess wrapperの実装方法
- packagerをNode/Pythonのどちらへ置くか（ただし追加依存・二重実装を避け、canonical contractを満たすこと）
- commitの分け方

## 13. 設計へ戻る条件

以下のいずれかが判明した場合は、実装者判断で仕様を変えずissueへ戻す。

1. 既存`pipeline.py` / `single_roundtrip.py`の**意味変更**が必要。
2. 既存5-field projectionの意味変更が必要。
3. `request/`以外のpipeline snapshot情報をChatGPTへ渡さないと分類できない。
4. outer staging後のworkspaceを既存`finalize-single-roundtrip`で利用できない。
5. resolved snapshot setと既存provenance manifestだけではDB lineageを一意に表現できない。
6. canonical ZIP境界を破らないと必要な作業が成立しない。

これら以外の内部実装問題は、canonical contractの範囲内で実装者が解決する。
