# Candidate Keyword Update Handoff v1.0.0

このパッケージは、候補キーワード更新フローを実装作業者へ引き渡すための **normative handoff** です。

作成時点: `2026-08-24T15:54:00Z`  
実装仕様の到達率: **100%**

## 最初に読む順序

1. `ARCHITECTURE.md`
2. `issues/PARENT.md`
3. `issues/CHILD_1_DETERMINISTIC_EVALUATION.md`
4. `issues/CHILD_2_REGISTRY_BOOTSTRAP_PUBLICATION_UI.md`
5. `issues/CHILD_3_EXTERNAL_LLM_BOUNDARY.md`
6. `IMPLEMENTATION_CHECKLIST.md`

機械契約は `schemas/`、評価条件は `policy/evaluation/1.0.0.json`、カテゴリは `policy/taxonomy/1.0.0.json` を正とします。

## 責務境界

```text
Integrated Labeling publication (3-class)
        ↓
consumer validation
        ↓
existing candidates pre-evaluation
        ↓
candidate_generation_request.json
        ↓
[ external LLM : implementation is OUT OF SCOPE ]
        ↓
candidate_proposal.json
        ↓
local schema/lifecycle validation
        ↓
candidate_change_set.json
        ↓
registry transition
        ↓
all-active deterministic evaluation
        ↓
review + stale-parent validation
        ↓
atomic publication
        ├─ candidate_registry.json
        ├─ candidate_evaluation.json (run artifact)
        ├─ filterKeywordCandidates.json
        ├─ filterKeywordCandidates.meta.json
        └─ run_manifest.json
        ↓
App
```

## 重要なNon-goals

- LLM provider / model / 呼び出し実装
- LLM内部の候補発見方法、chunking、retrieval、rationale
- ローカルseed / n-gram候補生成
- 自動semantic duplicate判定
- 自動retire / 自動rebase
- rollback framework / 汎用schema migration framework

## Source of truth

- Issue: なぜ・何を保証するか
- JSON Schema / policy / taxonomy: 機械検証可能な契約
- `runs/<run_id>/`: immutable run history
- `candidate_registry.json`: current candidate semantic/lifecycle state
- `filterKeywordCandidates.json`: current UI向け派生成果物（手編集禁止）
