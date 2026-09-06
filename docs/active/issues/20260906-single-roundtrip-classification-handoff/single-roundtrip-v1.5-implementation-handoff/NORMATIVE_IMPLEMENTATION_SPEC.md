# Normative implementation specification — v1.5 single-roundtrip classification

## 1. Scope

### 1.1 Goal

現在の意味上の直列処理

`raw -> Stage13 -> Three-Class -> downstream`

を維持したまま、人間との分類作業を

`handoff package 1回送付 -> response JSON 1回取得`

で完結させる。

**single-roundtrip は human transaction の制約であり、reviewer内部のmodel invocation / batch / pass数の制約ではない。**

### 1.2 Out of scope

以下はv1.5 MVPでは実装しない。

- Stage13自動判定rule追加
- Stage13 exact 5-fieldを超えたhuman dedupe
- 3-classを`comment`単位等へ一般化するsemantic bulk review
- 過去golden decisionの別`record_key`への伝播
- P2をmandatory reviewにする変更
- Web UI / reviewer専用CLI
- handle alias化 / handle-affinity sharding
- 新reason code
- Three-Class policyの分類意味論変更
- v1.4/v1.5共通coreへの大規模refactor
- bootstrap flowのsingle-roundtrip化
- candidate意味review以降までの1往復化

## 2. Versioning and freeze

- v1.4 treeをcutover完了まで変更しない。
- v1.5をv1.4からsibling copyとして作る。
- `VERSION`: `1.5.0`
- `config/integrated_policy.json` の `pipeline_version`: `1.5.0`
- `config/three_class_policy.json` の `policy_version`: **`1.4.0`のまま**。分類policy自体は変えない。
- v1.5 root `manifest.json`はv1.5実ファイルに対して再生成し、integrityが通ること。

## 3. Public CLI

MVPで追加するpublic commandは2つだけ。

```bash
python3 src/pipeline.py prepare-single-roundtrip \
  INPUT.json \
  --reference STAGE13_REFERENCE.json \
  --workspace WORKSPACE \
  [--state-dir STATE_DIR] \
  [--batch-size 500]
```

```bash
python3 src/pipeline.py finalize-single-roundtrip \
  --workspace WORKSPACE \
  --response classification_response.json \
  [--state-dir STATE_DIR]
```

制約:

- v1.5 single-roundtripでは`--bootstrap`, `--term-only`, `--no-golden`, `--no-p2-adjudications`等の診断/初期構築surfaceを追加しない。
- bootstrap/diagnostic/rollback用のv1.4 commandは残す。
- `prepare-single-roundtrip`のworkspaceは既存ならfail。MVPに`--force`を入れない。
- prepare時に解決したoperational state directoryをreceiptに記録する。finalizeの`--state-dir`が指定された場合、prepare時のresolved stateと同一でなければfail-closed。

### 3.1 Exit/stdout contract

新2コマンド:

- success: exit `0`
- expected input/contract/conflict failure: exit `3`
- exit `2`はlegacy `three-class --strict-final`用に予約し、新2コマンドでは通常使わない。

成功時stdoutは**単一JSON object**のみ。内部helperから途中summaryをstdoutへ出さない。
失敗時は原則stdout空、stderrへ`ERROR: ...`、exit 3。

## 4. Prepare semantics

### 4.1 Snapshot inputs

prepare開始時点で以下をworkspace temp treeへraw bytes snapshotしSHA-256を固定する。

- raw input
- Stage13 reference
- current operational P0/P1 golden registry
- current operational P2 registry
- `config/reactive_terms.json`
- `config/review_cues.json`
- `config/three_class_policy.json`
- その他、既存3-class実行が意味上参照するconfig
- v1.5 root `manifest.json`のraw SHA-256 (`implementation_manifest_sha256`)

classification再現は常にsnapshotを使う。finalize途中にlive P2等へ追従しない。

### 4.2 Stage13

既存v1.4 semantics/helperを再利用する。

- exact reference reuseはhuman reviewしない。
- pendingだけreview対象。
- **5-fieldがraw bytes/valueとして完全一致するpending行は1 human decisionへdedupe可能**。
- dedupeしてもsource row、順序、同一handle context内の重複出現を削除しない。
- exact 5-fieldより広いdedupeは禁止。

各unique pending decisionへrequest-scoped `S000001`, ...を割り当てる。
S-taskは1つ以上のsource rowsへbindする。

### 4.3 Three-Class potential state precomputation

Stage13が既にexact reuseされたrecordは、その確定Stage13 labelで3-classを事前計算する。

Stage13 pending recordは、**同じ5 fieldsに対し `label=normal` と `label=nuisance` の2仮定をそれぞれ構築して既存`classify_three()`相当を実行**する。

各仮定について:

1. `record_key`を既存定義（5 fields + Stage13 label、SHA-256先頭24hex）で生成。
2. snapshot goldenをexact keyで適用。
3. snapshot P2を既存exact-case contractで適用。
4. unresolved mandatory P0/P1かを判断。
5. unresolved optional P2だけならhuman taskを作らない。

### 4.4 T-task generation

T-taskは**exact `record_key`単位**。

- 同じ`record_key`がdataset内に複数行存在する場合だけ1 T-taskへdedupe。
- 異なる`record_key`をcomment類似等でまとめない。
- existing golden/P2で解決済みならT-taskにしない。
- unresolved mandatory P0/P1のみpotential T-taskにする。

各unique potential mandatory exact keyに`T000001`, ...を割り当てる。

T-taskにはactivationをbindする:

- `unconditional`: Stage13 exact reuse等ですでにactive
- `stage13_branch`: 特定S-taskが`normal`または`nuisance`のときだけactive

同じexact `record_key`に複数source rows / activation pathsが到達した場合、1 T-taskに統合し、内部状態（provisional label, priority, review reasons等）が一致することをassertする。不一致ならprepare fail。

## 5. Handoff request package

### 5.1 Canonical request vs transport

canonical requestは`WORKSPACE/request/`。
ZIPはtransport artifactでありclassification identityではない。
finalizerは返却ZIPを入力にせず、workspace canonical request + responseだけを使う。

推奨構造:

```text
WORKSPACE/
  prepare_receipt.json
  snapshot/
  request/
    manifest.json
    REVIEW_INSTRUCTIONS.md
    prompts/
      STAGE13_REVIEW_PROMPT.md
      THREE_CLASS_REVIEW_PROMPT.md
    stage13/
      ... task/context shards ...
    three_class/
      ... potential task shards ...
    response.schema.json
    response_template.json
  classification_handoff_<request_id>.zip
```

既存Stage13/Three-Class promptの意味規則を新promptへコピーしない。`REVIEW_INSTRUCTIONS.md`はorchestrationだけを書く。

### 5.2 Reviewer orchestration

同一package内で:

1. Stage13 S-taskを既存Stage13 prompt/specで全て判断。
2. そのStage13結果からactive T-taskを算出。
3. active T-taskだけを既存Three-Class prompt/specで判断。
4. 中間回答を人間へ返さず、complete response JSONを1個だけ返す。

reviewer内部のmulti-pass/batchingは許可。

## 6. Request identity / manifest

per-run manifestは`request/manifest.json` 1個。

最低限:

```json
{
  "schema_version": 1,
  "protocol_version": "single-roundtrip-v1",
  "pipeline_version": "1.5.0",
  "request_id": "...",
  "bindings": { "...": "..." },
  "semantic": { "files": ["..."] },
  "derived": { "files": ["..."] }
}
```

`semantic.files`には、reviewerの判断内容/判断ルールを変えるrequestファイルのpath, raw SHA-256, byte sizeをdeterministic順序で含める。最低限:

- `REVIEW_INSTRUCTIONS.md`
- copied Stage13/Three-Class prompts
- Stage13 task/context shards
- Three-Class potential task shards

`derived.files`にはrequest_idから派生可能な補助物を置く。最低限:

- `response_template.json`
- `response.schema.json`

### 6.1 request_id

```text
request_id = SHA256(canonical_json({
  schema_version,
  protocol_version,
  pipeline_version,
  bindings,
  semantic
}))
```

canonical JSON:

- UTF-8
- `ensure_ascii=false`
- keys sorted
- separators `(',', ':')`
- floatsをprotocol identityに使わない

`request_id`自身と`derived`はpreimageから除外。

bindingsには少なくとも:

- input SHA
- Stage13 reference SHA
- golden registry SHA
- P2 registry SHA
- relevant config SHA群
- `implementation_manifest_sha256`

## 7. Response contract

responseは1 JSON。human-facing hash/record keyの転記を避け、request-scoped task IDsを使う。

```json
{
  "schema_version": 1,
  "request_id": "...",
  "stage13_decisions": {
    "S000001": {
      "label": "nuisance",
      "note": "簡潔な判定根拠"
    }
  },
  "three_class_decisions": {
    "T000001": {
      "reason_code": "quoted_attack",
      "note": "簡潔な判定根拠"
    },
    "T000002": null
  }
}
```

### 7.1 Stage13 decisions

- exact S-task setを完全coverage。
- labelは`normal|nuisance`。
- `note`はtrim後non-empty。
- unknown/duplicate/missing taskをreject。

### 7.2 Three-Class decisions

全potential T-task keyをresponseに持たせる。

- active T-task: object必須
- inactive T-task: `null`必須
- objectは`reason_code + non-empty note`
- labelはresponseに入力させず、既存mappingから導出

P0/P1 reason mapping（v1.4既存値を変更しない）:

```text
direct_target   -> direct_nuisance
mixed_target    -> direct_nuisance
spam            -> direct_nuisance
anti_target     -> reactive
support_reaction-> reactive
meta_reaction   -> reactive
quoted_attack   -> reactive
normal_context  -> normal
```

reason_codeから既存canonical `OPERATIONAL_RATIONALE`を生成してgoldenへ保存する。reviewer noteはsingle-roundtrip audit/compat evidenceへ保持するが、operational rationaleの代替にしない。

### 7.3 Strict JSON

protocol JSON (`request/manifest.json`, response等) はduplicate object keyをrejectするstrict parserを使う。通常の`json.load()`でlast-winsさせない。

## 8. Response schema / runtime validation

外部dependencyを追加しない。

- runtime authority: stdlib Pythonの明示validator
- public machine-readable contract: prepare時生成`response.schema.json`
- `jsonschema` dependencyは追加しない

per-request schemaはexact S/T key setを`properties/required/additionalProperties:false`として表現する。
S回答によるT activationのcross-field条件はPython semantic validatorで検証する。

validation layers:

1. structural: JSON, duplicate keys, versions, request_id, exact keys, enums, note
2. semantic: bindings, Stage13 branch, active/inactive T, reason mapping, Stage13 final, prospective golden, strict Three-Class, integrated validation

## 9. Acceptance boundary

responseを`accepted`と呼ぶのはschema/coverage通過時ではない。

以下をsnapshotだけで完全に再生し全成功した後:

```text
response validation
-> Stage13 final assembly
-> active P0/P1 resolution
-> prospective golden registry
-> strict Three-Class finalization
-> integrated validation(require resolved)
```

その後だけ:

```text
accepted/response.json   # supplied raw bytesそのもの
accepted/receipt.json
```

をatomic確定する。

accepted後:

- 同じresponse SHAはidempotent retry可
- 別SHA responseへの差し替えは禁止
- change of human decisionはretryではなく新adjudication/change-controlとして扱う
- machine failure/conflictを理由にhuman re-reviewを要求しない

## 10. Operational registry commit

### 10.1 Golden only writable

single-roundtrip transactionで書き込むoperational stateはP0/P1 goldenだけ。
P2 registryはsnapshot/read-onlyであり、途中live updateをcurrent runに取り込まない。

### 10.2 Exact promotion

active reviewed T-taskから、各exact `record_key`へ既存schemaのoperational golden decisionを生成する。
既存`EXPECTED_LABEL_BY_GOLDEN_REASON`, `OPERATIONAL_RATIONALE`, `_operational_decision`等を再利用する。

現行`promote-three-class`がaudit duplicate `record_key`を拒否する問題を避けるため、single-roundtripではまずaudit rowsを`record_key`でgroupし、同一keyのsemantic audit stateが一致することを確認してlogical exact keyを1件化する。旧CSV promotion commandを偽造して通さない。

### 10.3 Concurrency

prepare snapshot goldenとfinalize時live goldenを比較する。
`RUN_KEYS` = current runで生成可能な全potential exact `record_key`。

自動rebase可:

- snapshot以降のlive追加/変更keyが`RUN_KEYS`外だけ
- またはsame-key decisionがaccepted側とoperational fields完全一致

conflict:

- current-run keyに異なるdecision
- prepare時既存golden entryの削除/変更
- same final labelでもreason/provenanceが異なる場合
- live P2とのkey overlap等、既存registry contract違反

operational decision一致は少なくとも:

`record_key, stage13_label, label, reason_code, rationale`

全て一致。

### 10.4 Atomic order

```text
accepted deterministic result
-> live golden conflict check
-> prospective live golden
-> temp write + fsync + atomic replace golden
-> final artifact directory atomic promotion
-> finalization_receipt.json
```

commit後final promotion前にcrashしても、same decisionとしてretryしhuman re-reviewしない。

## 11. Workspace / receipts / atomicity

mutable `workspace_state.json`を状態authorityにしない。
成果物存在で状態を決める。

- `AWAITING_RESPONSE`: prepare receiptあり、acceptedなし
- `ACCEPTED_COMMIT_PENDING`: accepted receiptあり、finalization receiptなし
- `FINALIZED`: finalization receiptあり
- `FINALIZED_NO_HANDOFF`: human decisions 0でprepareから直接finalized
- 矛盾構成は`CORRUPT`としてfail-closed

prepareはsibling temp directoryで全生成後、target workspaceへatomic rename。既存workspaceはfail。
final artifactsもtemp完成後にatomic promotion。

stdoutはconvenience。disk receiptがcanonical provenance。

## 12. Human-decision-zero path

required human decisionsが0ならhandoff ZIP/responseを作らずprepareがそのまま:

`Stage13 final -> strict Three-Class -> integrated validate -> final/ -> finalization receipt`

まで進みexit 0。

P2-only unresolvedはhuman decision数に含めない。

## 13. Provenance compatibility

### Stage13

既存clean schema: 5 fields + `label`を維持。
既存audit `label_source`語彙（例 `exact_reference_reuse`, `explicit_adjudication`）を変更しない。
single-roundtrip固有request/response SHA/task mapping等は新sidecar `single_roundtrip_audit.json`へ保存。

### Three-Class

既存clean schema: 5 fields + final 3-class `label`を維持。
reviewed P0/P1は最終audit上、既存と同様`decision_source=golden_adjudication`として再生する。
P2は既存`p2_adjudication` provenanceを維持。

## 14. v1.4 fallback without re-review

accepted responseから機械的にv1.4互換物を生成可能にする:

- Stage13 adjudication CSV（dedupe decisionを元source rowsへ展開、non-empty note保持）
- accepted decisionsをmergeしたprospective golden registry

fallbackはlive stateへ先にcommitせず、v1.4 CLIへexplicit registry pathを渡してstrict-final/validateを先に行う。
accepted済みhuman decisionsをv1.4 fallbackで再質問してはならない。

## 15. Downstream compatibility

`package/src/processing/keyword-candidates/handoff-workflow.js`の固定version gateのみ必要最小限変更。

```text
summary.pipeline_version == validation.pipeline_version
AND pipeline_version in {"1.4.0", "1.5.0"}
```

未知1.xをsemver rangeで自動許可しない。
account candidate側に同種gateがなければ新設しない。

## 16. Cutover

v1.5実装完了とproduction default化を分ける。

cutover前に:

- v1.4 frozen baseline確認
- v1.5 parity tests
- single-roundtrip acceptance tests
-確定済みv1.4 runからのshadow replayでsemantic parity
- keyword candidate/account/release end-to-end
- accepted-response fallback test

すべてpass後のみ通常runbookのStage13〜strict Three-Class部分をsingle-roundtripへ置換。
v1.4 commands/treeはrollback/diagnostic用に残す。
