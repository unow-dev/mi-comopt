# Candidate Generation Prompt Contract v1

この文書は **実際のLLM prompt本文ではない**。外部LLM境界が満たすべき意味契約だけを定義する。

## Inputs

`candidate_generation_request.json` が次をbindingする。

- current base publication (`run_id`, registry hash)
- publication済み3-class source dataset
- active + retiredを含む `candidate_view.json`
- active candidatesの `pre_evaluation.json`
- evaluation policy version/hash
- taxonomy version/hash
- expected proposal schema version

## Required semantic instructions

外部LLMには、以下の意味を満たすよう指示する。

- 必要なcandidate semantic deltaだけを返す。
- actionは `add / update / retire / reactivate` のみ。
- 既存candidateについてactionを返さないことは「維持」を意味する。`keep`は出さない。
- 同一candidateへ1request内で複数actionを返さない。
- 既存またはretired candidateと同一概念なら、新規`add`ではなく`update`/`reactivate`を使う。
- `add`ではcandidate IDを生成しない。
- `update`/`reactivate`はpartial patchではなく変更後の `keyword / variants / category_id` 全量を返す。
- taxonomyにないcategory IDを作らない。
- D/R/N、metrics、recommendation、introduced_at等を出力しない。
- rationale、evidence、元comment、username、handle、confidence等をproposalへ含めない。
- `candidate-proposal.schema.json` へ厳密に従う。

## Output

`candidate_proposal.json` は `request_id` と `input_fingerprint` を入力からそのままechoする。

空の `actions: []` は有効であり、「semantic変更不要」を表す。

LLM provider/model、呼び出し回数、chunking/retrieval、実prompt文面は本Issueの範囲外。
