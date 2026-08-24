# 候補キーワード更新フローの整備

## 目的

Integrated Labelingのpublication済み3-class artifactを起点として、candidate proposal以降の評価・履歴・publicationを追跡可能かつ決定的にし、新規candidateを設定期間 `NEW` 表示できるようにする。

candidate semantic generationそのものは外部LLMの責務であり、本Issueでは **LLMへ渡す入力契約と返却proposal契約のみ** を仕様化する。

## Scope

- 3-class artifact consumer validation
- 外部LLM request/proposal boundary
- persistent candidate ID / registry
- deterministic D/R/N evaluation
- evaluation policy / taxonomy / schemas
- bootstrap 187 migration
- publication history / introduced_at / NEW
- immutable run artifacts / current meta
- optimistic concurrency / atomic publication
- legacy local generator廃止

## Non-goals

- LLM provider/model/API実装
- LLM内部の候補発見workflow
- raw rationale/evidence/chain-of-thought
- local seed/n-gram generation
- automatic semantic duplicate detection
- automatic retirement/rebase
- rollback framework / generic schema migration framework

## Architecture

```text
3-class publication
  -> consumer validation
  -> pre-evaluation
  -> generation request
  -> [external LLM: out of scope]
  -> candidate proposal
  -> local validation/canonical change set
  -> registry transition
  -> all-active deterministic evaluation
  -> review/stale check
  -> atomic publication
  -> App / NEW
```

## 子Issue

1. `CHILD_1_DETERMINISTIC_EVALUATION.md`
2. `CHILD_2_REGISTRY_BOOTSTRAP_PUBLICATION_UI.md` (depends on 1)
3. `CHILD_3_EXTERNAL_LLM_BOUNDARY.md` (depends on 1, 2)

## Parent Acceptance Criteria

- [ ] current published listから入力3-class artifactとhash/versionへ一意に追跡できる。
- [ ] semantic candidate変更がexternal proposal経由に限定され、local generatorがproduction pathに存在しない。
- [ ] 全candidateがpersistent `candidate_id` を持ち、表示変更・retire/reactivateを跨いでidentityを維持する。
- [ ] proposal確定後は同じregistry/dataset/policyから同じevaluationとpublished JSONを再生成できる。
- [ ] registry/evaluation/published JSON/manifestの関係をCIで再構成・検証でき、直接手編集ではpublicationできない。
- [ ] legacy 187候補をsemantic変更なしでbootstrapし、legacy候補をNEW扱いしない。
- [ ] 各published runをparent、dataset、policy、evaluator、proposal/change-set、outputsのhashで追跡できる。
- [ ] 新規candidateだけが設定期間NEWとなり、metrics/variants/category変更やreactivateだけではNEWにならない。

## Implementation discretion

実装言語、ライブラリ、module名、CLI parser、publication lockの具体方式、upstream artifact storage製品、actual LLM/provider/model/prompt文面は実装裁量。
