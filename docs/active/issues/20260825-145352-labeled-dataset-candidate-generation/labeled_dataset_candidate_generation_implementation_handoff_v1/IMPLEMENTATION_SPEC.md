# Implementation Spec

## 1. 採択する責務境界

### ChatGPT

- Stage13でexact reuseできないpending recordのsemantic adjudication。
- 3-Classで未解決のmandatory P0/P1 recordのsemantic adjudication。
- publication可能な3-Class datasetを基にcandidate keyword proposalを生成。

### Local implementation

- exact/reference reuse。
- deterministic/provisional classification。
- review対象抽出。
- source index / record SHA / record key binding。
- final dataset assembly。
- mandatory review gate。
- quality validation。
- candidate deterministic evaluation。
- publication。

「ChatGPTが3-classラベリングを担当」は、raw全件をLLMで再分類する意味ではありません。

---

## 2. 標準E2Eフロー

```text
raw 5-field JSON
  ↓
local prepare-stage13
  ↓ pending > 0 の場合のみ
ChatGPT Stage13 review
  ↓
local finalize-stage13
  ↓
local three-class first pass（strict-finalなし）
  ↓ unresolved P0/P1 > 0 の場合のみ
ChatGPT 3-Class review
  ↓
local three-class --strict-final
  ↓
local validate --three-class-audit ... --require-resolved
  ↓
local candidate prepare-handoff（labeling evidence mode）
  ↓
ChatGPT candidate proposal
  ↓
local full-update
  ↓
publication
```

semantic reviewが0件の場合はChatGPT工程だけskipし、local finalizationは通常どおり実行します。

---

## 3. Integrated Labeling — prepare-stage13

現行 `pending_batches/batch_NNN.json` に加え、各batchについて以下を生成してください。

```text
pending_batches/
├── batch_001.json
├── batch_001_context.json
├── batch_001_adjudications.csv
├── batch_002.json
├── batch_002_context.json
├── batch_002_adjudications.csv
└── ...
```

### `batch_NNN_context.json`

そのbatchに含まれるhandleのみを対象に、現行 `stage13_handle_context.json` と同じ構造で以下を含めます。

- `current_input`: 現行raw input内の同handle全コメント。
- `prior_reference`: bound Stage13 reference内の同handle全コメント。

新しいsemantic情報を作らず、global contextの部分集合としてください。

### `batch_NNN_adjudications.csv`

ヘッダ:

```csv
source_index_1_based,source_record_sha256,label,note
```

各pending rowについて `source_index_1_based` と `source_record_sha256` をローカル側で事前入力し、`label`,`note` は空欄とします。ChatGPTが変更するのは `label`,`note` だけです。

### 再実行安全性

`prepare-stage13` の再実行時に旧batch JSON/context/CSVが混在しないことが必須です。

採択方針:

- `pending_batches` はローカル生成handoff artifact専用。
- prepare開始時に `pending_batches` をクリーンに再生成する。
- ChatGPT回答は別directory（標準: `work/chatgpt-stage13/`）に保存する。
- global `stage13_adjudications.csv` / `stage13_handle_context.json` は既存互換のため残す。

---

## 4. Integrated Labeling — finalize-stage13

既存:

```text
--adjudications FILE
```

を維持し、新規に:

```text
--adjudications-dir DIR
```

を追加します。両者はmutually exclusiveです。

### directory modeのexpected file set

workspaceの `pending_batches/batch_NNN.json` を正本として、対応する回答ファイル:

```text
batch_NNN_adjudications.csv
```

を `--adjudications-dir` 内に要求してください。

以下はfail:

- expected batch CSV不足。
- unknown `batch_*_adjudications.csv` が存在。
- duplicate source index。
- non-pending source index。
- invalid Stage13 label。
- invalid source SHA format。
- current raw rowとのSHA mismatch。
- pending decision coverage不足。
- directory modeで `note.trim() == ""`。

batch番号順で読み込んで構いませんが、意味的には順序非依存です。

重要: 最終authorityは既存 `cmd_finalize_stage13` のbinding/reuse検証です。新規directory layerで分類ロジックを再実装しないでください。

既存single-file modeは挙動変更しません。空note必須化は今回のChatGPT directory modeだけです。

### pending 0件

`stage13_prepare_report.json.pending_records == 0` の場合、ChatGPTをskipし、既存header-only `stage13_adjudications.csv` を使ってsingle-file modeでfinalizeします。

---

## 5. Integrated Labeling — 3-Class ChatGPT review

初回three-class runは `--strict-final` を付けません。目的はreview queue/templateの生成です。

ChatGPTへ渡す標準セット:

- `THREE_CLASS_REVIEW_PROMPT.md`
- `03_THREE_CLASS_LABELING_SPEC.md`
- `04_THREE_CLASS_CHANGE_CONTROL.md`
- `review_queue.csv`
- `manual_overrides.csv`

現行 `THREE_CLASS_REVIEW_PROMPT.md` のJSON返却指定を廃止し、既存pipelineが直接読めるCSV completionへ変更します。

```csv
record_key,label,note
```

ChatGPTは既存templateの `record_key` を維持し、`label`,`note` を完成させます。

- P0/P1: mandatory。
- P2: 現行どおりoptional。このIssueで必須化しない。
- 新しい3-Class batch orchestrationは実装しない。

### mandatory 0件

初回 `summary.json.unresolved_mandatory_reviews == 0` ならChatGPTをskipし、final output pathを統一するため `three-class --strict-final` を `three_class_final/` に対して通常実行します。

---

## 6. Labeling completion evidence

candidate handoffへ進むためのcanonical evidenceは既存2ファイルです。

- final three-class `summary.json`
- `validate --three-class-audit ... --require-resolved --report ...` で生成した `validation_report.json`

新規labeling manifestは作りません。

candidate側で必須確認する項目:

```text
summary.pipeline_version == "1.4.0"
validation.pipeline_version == "1.4.0"

summary.final_published === true
summary.unresolved_mandatory_reviews === 0

validation.all_checks_passed === true
validation.checks.three_class_mandatory_reviews_resolved === true
validation.three_class_audit.unresolved_mandatory === 0

summary.input_sha256 == validation.sha256.stage13
```

final dataset binding:

```text
sha256(actual three_class_labeled.json bytes)
== summary.final_output_sha256
== validation.sha256.three_class
```

Integrated LabelingのSHAはprefixなし64hex、candidate contractは `sha256:<64hex>` です。

---

## 7. Candidate prepare-handoff — labeling evidence mode

`scripts/candidate-workflow.mjs` の既存 `prepare-handoff` にoptional pairを追加します。

```text
--labeling-summary FILE
--labeling-validation FILE
```

挙動:

```text
両方なし → 現行prepare-handoffの挙動を維持
両方あり → labeling evidence mode
片方だけ → fail
```

failure codeはMVPでは `LABELING_EVIDENCE_INVALID` 1種類でよく、messageで原因を区別してください。

### verified source SHA

candidate側の一般的な `resolveDatasetSourceSha()` semanticsは変更しません。

labeling evidence modeの前段でのみ:

```js
const evidenceSha = `sha256:${summary.final_output_sha256}`;
```

を作り、以下を確認します。

```text
evidenceSha == `sha256:${validation.sha256.three_class}`
evidenceSha == byteSha256(datasetInput.bytes)
```

成功した `evidenceSha` を既存candidate処理へ `sourceSha` として渡します。

`--source-sha` がevidence modeで指定された場合はauthorityにせず、verified SHAとの一致assertionとして扱います。不一致はfail。

`--source-ref` の一般仕様、candidate request schema、handoff file setは変更しません。

### candidateへ持ち込まない情報

以下をcandidate schemaへコピーしないでください。

- Stage13 policy hash。
- golden/P2 registry hash。
- ChatGPT review details。
- raw input SHA。
- labeling summary/validation report本体。

candidate側は最終dataset artifact identityだけを保持し、upstream detailsはIntegrated Labeling evidence側の責務です。

---

## 8. Publication

candidate handoff生成後は既存manual ChatGPT handoffと `full-update` をそのまま使用します。

- handoffは11ファイルのまま。
- ChatGPTへ `handoff_manifest.json` は渡さない。
- ChatGPT回答は既存 `candidate-proposal` v1 JSON-only。
- production flowで `canonicalize-proposal` を事前実行しない。
- `full-update` がhandoff byte binding、proposal validation、evaluation、publicationを担当。
