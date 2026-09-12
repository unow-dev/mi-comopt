# Implementation Handoff: Optimicom React + Tailwind UIをComment DB正本へ移行

## Status

- Implementation readiness: **100%**
- Scope: `docs/active/temp/optimicom-react-tailwind` のPhase 1 production化
- Authoritative implementation contract: **`IMPLEMENTATION_SPEC.md`**
- Completion contract: **`ACCEPTANCE_TESTS.md`**

このhandoffは、discussion setに対する設計議論を実装可能な単一仕様へ統合したものです。設計判断は閉じています。現行リポジトリがこのhandoffの明示的前提と矛盾する場合を除き、アーキテクチャやbusiness ruleを再設計しないでください。

## 読む順序

1. `IMPLEMENTATION_SPEC.md` — 実装動作の唯一の正本
2. `ACCEPTANCE_TESTS.md` — 完了判定
3. `WORK_TASK_SEQUENCE.md` — 4 PRの依存順
4. `SOURCE_MAP.md` — 再利用する既存コードと変更箇所
5. `DECISIONS.md` — 採択理由・不採択案・旧決定の上書き
6. `references/` — 調査・議論履歴。**非正本**

## Authority order

実装時の優先順位は次です。

1. `IMPLEMENTATION_SPEC.md`
2. `ACCEPTANCE_TESTS.md`
3. `WORK_TASK_SEQUENCE.md`
4. `DECISIONS.md`
5. `SOURCE_MAP.md`
6. 上位issue本文
7. feasibility report / implementation policy workset / discussion資料

`IMPLEMENTATION_SPEC.md` と `ACCEPTANCE_TESTS.md` が矛盾した場合はコードで補完せず、仕様欠陥として両文書を同じ変更で修正してください。

## Architectural invariant

Phase 1のデータ鎖は一本です。

```text
Comment DB schema v8
        ↓
DB-current keyword publication
        ↓ snapshot_id
single read-only SQLite transaction
        ↓
deterministic 3-class source_dataset
        ↓ exact byte SHA verification
        ├─ source_dataset bytes → Comments
        ├─ deterministic aggregate → Overview
        ├─ DB-current keyword JSON → Keywords
        └─ source_dataset.records projection
             ↓
           existing buildAccountCandidates(policy 1.0.0)
             ↓
           Accounts
        ↓
optimicom-ui-release.json
        ↓
content-addressed artifacts
        ↓
optimicom-react-tailwind
```

UI runtimeはSQLiteへ直接接続しません。DBはauthoritative source、公開JSONは検証可能なread modelです。

## 最重要禁止事項

- production UIで `src/data.js` のsample値へfallbackしない。
- 3分類を6分類へ推測変換しない。
- 欠測日を0件として表示しない。
- `Score`, `GOOD`, AI総評, Priority A-C, account riskを新設しない。
- Clipboard成功を「追加済み」「TikTok上でブロック済み」と扱わない。
- account候補件数60、keyword候補件数86、コメント24,622件を仕様値としてhard-codeしない。
- UI exportのためにDBをmigration/writeしない。
- 既存 `data-release.json` schema v1 / `publish:joint-data` の契約を今回のUI都合で変更しない。

## Reference values only

調査時点の現行DBでは、current keyword publicationが参照するsnapshotは24,622観測・86 keyword candidatesを持ち、既存account policyで60 candidatesが再生成されます。snapshotの最新 `posted_date` は2026-08-26です。

これらは**現在の入力から得られる回帰確認値**であり、プロダクト契約ではありません。Acceptance testで固定件数としてassertしないでください。
