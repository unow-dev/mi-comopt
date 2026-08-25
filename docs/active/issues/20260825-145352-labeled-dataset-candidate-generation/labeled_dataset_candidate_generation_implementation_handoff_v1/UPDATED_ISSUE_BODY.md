# ラベリングを含む候補キーワード生成フロー

## 目的

未ラベルのコメントデータを起点として、ChatGPTによる意味判断を既存のIntegrated Labelingへ組み込み、品質確認済みの3-class datasetを候補キーワードの提案・評価・更新フローへ安全に接続できる状態にする。

ユーザー視点の運用は以下とする。

```text
raw-dataを人間が手動準備
→ ChatGPTがラベル付け
→ ChatGPTがキーワード候補選定
→ ローカル実装で公開処理
```

ラベリング結果について、判定基準、データ契約、品質確認、完了状態および上流データとの対応関係を追跡可能にし、ラベリングから候補キーワードの更新・公開までを一貫した運用として扱えるようにする。

## 背景

現在の候補キーワード更新フローおよびChatGPT手動handoffは、`direct_nuisance`、`reactive`、`normal` のいずれかが付与されたラベリング済みdatasetを入力として想定している。未ラベルのコメントを分類し、ラベリング完了・品質検証済みであることをcandidate handoff側が確認する境界は存在しない。

一方、既存Integrated LabelingにはStage13のexact reuse、semantic adjudication、3-Class provisional classification、mandatory review、publication gate、validationが存在する。このIssueではそれらを置き換えず、ChatGPTを既存semantic reviewの担当として位置付け、最終publication済み3-Class datasetを既存candidate workflowへ接続する。

## 採択する責務境界

### ChatGPT

- Stage13でexact reuseできないpending recordをsemantic adjudicationする。
- 3-Classで未解決のmandatory P0/P1 recordをsemantic adjudicationする。
- publication可能な3-Class datasetを基にkeyword candidateをsemantic proposalする。

### Local

- exact/reference reuse。
- deterministic/provisional classification。
- review queue生成。
- source index / record SHA / record key binding。
- final dataset assembly。
- mandatory review gate。
- quality validation。
- candidate deterministic evaluation。
- publication。

「ChatGPTがラベル付け」はraw全件をLLMで再分類することを意味しない。また「一連のChatGPT作業」は同一workflow上でChatGPTが意味判断を担当することを意味し、単一request/sessionで全工程を処理することは要求しない。

## 対象フロー

```text
raw 5-field JSON
→ local prepare-stage13
→ ChatGPT Stage13 review（pending時のみ）
→ local finalize-stage13
→ local 3-Class first pass
→ ChatGPT 3-Class mandatory review（必要時のみ）
→ local strict finalization + validation
→ local candidate prepare-handoff（labeling evidence検証）
→ ChatGPT candidate proposal
→ local full-update + publication
```

semantic review対象が0件の場合はChatGPT工程だけskipし、local finalization/validationは通常どおり実行する。

## 実装Scope

### Integrated Labeling

- `prepare-stage13` で既存batchごとにhandle contextとadjudication CSV templateを生成する。
- `pending_batches` の再実行時にstale artifactを残さない。
- `finalize-stage13` に複数batch回答を受ける `--adjudications-dir` を追加する。
- directory modeはexpected batch集合、coverage、SHA、label、noteをfail-closedで検証する。
- `THREE_CLASS_REVIEW_PROMPT.md` の返却形式を既存 `record_key,label,note` CSV契約へ合わせる。

### Candidate workflow

- `prepare-handoff` に `--labeling-summary` と `--labeling-validation` のoptional pairを追加する。
- evidence modeではpublication状態、mandatory review解決、validation成功、Stage13 SHA linkage、final dataset SHA bindingを検証する。
- 検証済みfinal dataset SHAを既存candidate requestのsource artifact SHAとして使用する。
- evidenceなしの既存prepare-handoffは後方互換とする。

## Acceptance Criteria

1. 5-field raw dataからStage13/3-Classの必要なsemantic reviewをChatGPTへhandoffできる。
2. ChatGPTの判定を既存Stage13/3-Class CSV contractへ直接戻せる。
3. mandatory review未完了またはlabeling validation失敗時にはcandidate handoffを生成しない。
4. `summary.input_sha256 == validation.sha256.stage13` を要求する。
5. final `three_class_labeled.json` のbyte SHAが `summary.final_output_sha256` および `validation.sha256.three_class` と一致することを要求する。
6. candidate requestのsource SHAは上記検証済みSHAから導出する。
7. candidate-generation-request v1、candidate-proposal v1、11-file handoff、full-update、publication contractを変更しない。

P2 unresolvedは現行仕様どおりoptionalであり、publicationを阻害しない。

## Non-goals

- ChatGPT/OpenAI API integration。
- raw全件LLM再分類。
- candidate schema v2。
- 新規labeling manifest。
- 新規LLM JSON contract。
- 3-Class自動batch orchestration。
- P2 policy変更。
- Stage13/3-Class classification rule変更。
- candidate evaluation rule変更。
- publication contract変更。
- retry/history/confidence機構。

## Definition of Done

- raw-dataからChatGPT Stage13 reviewを実行できる。
- 複数Stage13 batch回答をlocalで安全にfinalizeできる。
- mandatory 3-Class reviewをChatGPTで完了し、strict finalizationできる。
- `validate --three-class-audit ... --require-resolved` が成功する。
- candidate `prepare-handoff` がlabeling evidenceをfail-closedで検証する。
- evidence改変時にはhandoffを生成しない。
- 正常時には既存11-file candidate handoffを生成する。
- ChatGPT candidate proposalを既存 `full-update` でpublicationできる。
- 既存workflowに今回変更起因の新規regressionがない。
