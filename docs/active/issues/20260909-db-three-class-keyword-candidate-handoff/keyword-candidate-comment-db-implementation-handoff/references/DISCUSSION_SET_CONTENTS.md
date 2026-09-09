# Discussion Set Contents: Comment DB 3分類ラベルからのフィルターキーワード候補 handoff

## 目的

Comment DB上の3分類ラベル付き観測データを起点に、候補提案用workset-handoffの生成、ChatGPT返却物のDB反映、DBからUI用JSONへの反映を議論するため、現在の実装境界・契約・検証を1つの参照セットへ固定する。

## 構成

```text
db-three-class-keyword-candidate-handoff-discussion-set/
├── ISSUE_BODY.md
├── DISCUSSION_SET_CONTENTS.md
└── sources/
    ├── package/
    │   ├── package.json
    │   ├── ARCHITECTURE.md
    │   ├── contracts/
    │   ├── db/comment-database/
    │   ├── scripts/
    │   ├── src/
    │   ├── templates/three-class-workset/
    │   └── tests/
    └── docs/active/
        ├── issues/20260908-db-three-class-workset-generation/ISSUE_BODY.md
        └── operations/
            ├── Integrated_Labeling_Handoff_v1.5.0/
            └── integrated-labeling-state/three_class_history.json
```

## 含めたもの

- Comment DBの全migration、DB起動・raw snapshot読出し・3分類ラベル永続化を担う実装。対象snapshot、観測ID、workset provenance、3分類ラベルを結び付ける既存データモデルを確認できる。
- `export-analysis-input` と既存の3-class workset生成・応答反映を担うCLI/adapter/protocol。現在の5-field投影と、DBからラベルを含む候補用入力を生成する場合に拡張対象となる境界を確認できる。
- フィルターキーワード候補のhandoff生成、返却proposal検証、評価、更新、atomic publicationを担うProcessing/CLI/契約。workset-handoffと既存候補更新フローを追跡可能に接続する条件を確認できる。
- UIが参照する候補JSONの読み込み・変換実装。DB確定値から生成するJSONの出力契約とUI側の利用範囲を確認できる。
- 上記境界を検証するDB、3-class workset、handoff、候補更新、UI adapterのテストと、handoffテスト用の匿名fixture。
- `docs/active` にある現行v1.5の3分類仕様・変更管理・パイプライン契約および直前のDB workset生成issue。3分類の確定条件、データ同一性・hashの扱い、既存実装の導入背景を確認できる。

## 収録ファイル

```text
sources/package/
├── package.json
├── ARCHITECTURE.md
├── contracts/
│   ├── candidate-handoff/v1/
│   │   ├── PROMPT_CONTRACT_v1.md
│   │   ├── candidate-proposal.schema.json
│   │   ├── common.schema.json
│   │   └── prompt.txt
│   ├── collector-inputs/tiktokCommentBatch-1.0.0.schema.json
│   ├── keyword-candidates/
│   │   ├── evaluation-policy-1.0.0.json
│   │   └── taxonomy-1.0.0.json
│   └── raw-snapshots/tiktokRawSnapshot-1.0.0.schema.json
├── db/comment-database/
│   ├── 001-init.sql
│   ├── 002-raw-snapshots.sql
│   ├── 003-rich-raw-inputs.sql
│   ├── 004-nullable-rich-metadata.sql
│   ├── 005-comment-batch-materialization.sql
│   └── 006-three-class-label-application.sql
├── scripts/
│   ├── adapters/keyword-publication.js
│   ├── adapters/three-class-workset.js
│   ├── candidate-workflow.mjs
│   ├── comment-database.mjs
│   ├── migrate-three-class-history.mjs
│   └── pack-three-class-workset.py
├── src/
│   ├── database/comment-database.js
│   ├── database/raw-snapshot-repository.js
│   ├── database/three-class-label-repository.js
│   ├── processing/analysis-input/raw-snapshot-projection.js
│   ├── processing/keyword-candidates/artifact-validation.js
│   ├── processing/keyword-candidates/candidate-workflow.js
│   ├── processing/keyword-candidates/handoff-workflow.js
│   ├── processing/keyword-candidates/update-flow.js
│   ├── processing/shared/workflow-validation-error.js
│   ├── three-class-workset/protocol.js
│   ├── ui/candidate-data-adapter.js
│   └── ui/candidate-data.js
├── templates/three-class-workset/
│   ├── PROMPT.md
│   ├── RULES.md
│   └── response.schema.template.json
└── tests/
    ├── candidate-data-adapter.test.js
    ├── candidate-workflow.test.js
    ├── comment-database.test.js
    ├── fixtures/e2e-dataset.json
    ├── full-update.test.js
    ├── handoff.test.js
    ├── publication.test.js
    ├── raw-snapshot-analysis-input.test.js
    └── three-class-workset.test.js

sources/docs/active/
├── issues/20260908-db-three-class-workset-generation/ISSUE_BODY.md
└── operations/
    ├── Integrated_Labeling_Handoff_v1.5.0/
    │   ├── README_FIRST.md
    │   ├── config/three_class_policy.json
    │   ├── docs/DESIGN_DECISIONS.md
    │   ├── docs/PIPELINE_CONTRACT.md
    │   ├── policy/04_THREE_CLASS_CHANGE_CONTROL.md
    │   └── specs/03_THREE_CLASS_LABELING_SPEC.md
    └── integrated-labeling-state/three_class_history.json
```

## 含めていないもの

- `docs/archive/` 配下のすべての文書。
- `docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/`、旧5-field DB import issue、およびそれらのhandoff・discussion set。これらは旧運用またはレガシー移行の資料であるため収録しない。
- `package/docs/` を含む `docs/active` 外の文書。
- 実DB、`work/`、`var/`、cache、生成済み公開データ、実運用の候補JSON、秘密情報。
- account block候補の実装。候補の表示構造は共通するが、本issueのDB→キーワード候補経路の実装範囲外である。

## 参照関係

- DB側はsnapshotと観測IDを正として3分類ラベルを保持し、3-class worksetの既存実装はworksetとsnapshotの対応を登録・検証する。
- 候補handoff側は、ラベル済みデータセットのbyte hash、入力fingerprint、候補提案、既存publicationを検証して更新する。
- UI側は生成済みの`filterKeywordCandidates.json`だけを読込むため、DBからUI用JSONを生成する新経路はこの出力契約を維持する必要がある。
