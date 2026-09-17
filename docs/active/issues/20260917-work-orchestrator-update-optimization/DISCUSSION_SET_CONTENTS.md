# Discussion Set Contents: Work Orchestrator 更新対応・リポジトリ最適化

## 目的

指定 issue の議論を詰める際に、Work Orchestrator provider の現行公開 API・Workspace-first 実行モデルと、`tiktok-filter-keywords` consumer の WorkDefinition、Application Service、State Control Plane、データ更新・release・deployment 経路を同じスナップショットから確認できるようにする。

## スナップショット

- consumer: `tiktok-filter-keywords` `716b3a2`
- provider: `work-orchestrator` `976aa2f`
- 作成日: 2026-09-17

## 構成

```text
20260917-work-orchestrator-update-optimization-discussion-set/
├── ISSUE_BODY.md
├── DISCUSSION_SET_CONTENTS.md
└── sources/
    ├── consumer/
    │   ├── package.json / package-lock.json / config/
    │   ├── package/
    │   │   ├── workflow/・integration/・application/・state/
    │   │   ├── database/・deployment/・release/・migration/
    │   │   ├── processing/・domain/・collector/・raw-snapshot/
    │   │   ├── contracts/・db/
    │   │   ├── scripts/（現行の state・release・deployment 検証経路）
    │   │   └── tests/（対象経路の回帰検証）
    │   ├── demo/（実 DB を変更しない統合 demo）
    │   └── docs/active/issues/（現行 handoff と契約資料）
    └── provider/
        ├── package/src/（現行公開 API・runtime・Workspace・Temporal 実装）
        ├── package/dist/（公開 package の現行生成物）
        ├── package/reference/（package/docs の現行 API 利用資料）
        ├── package/tests/・config/・package.json・package-lock.json
        └── docs/active/issues/（現行 provider 側 documentation issue の資料）
```

## 含めたもの

- root の `ISSUE_BODY.md` は、指定された issue 本文を内容変更せず収録した。
- consumer 側は、WorkDefinition の revision 2 定義・hash 検証・Session input pinning・routing outcome、Application Service Agent Adapter、State Control Plane、release materialization、Promotion、Deployment ledger/outbox、外部 event 配送を収録した。
- consumer 側の raw snapshot／collector 境界、現行 processing、release artifact builder、migration、CLI と、それらの対象テスト・契約・SQL migration を収録した。
- consumer 側の `demo/` と package 内の comment-data-update demo は、Work Orchestrator の公開 API に対する実行経路を確認するために収録した。
- consumer 側の `docs` は `docs/active` 配下の現行 handoff・契約・受入資料だけを収録した。
- provider 側は、現行の root export、Workspace lifecycle、Registry、ArtifactStore、runtime、domain reducer、validation、Temporal client/worker、outbox、型宣言を含む `src/` と生成済み `dist/` を収録した。
- issue 本文が明示する provider の `package/docs/README.md` と `package/docs/API_REFERENCE.md` は、現行内容を `package/reference/` に収録した。これは provider package の公開利用資料であり、consumer repository の `docs` tree とは別の入力である。
- provider 側の `docs` は `docs/active` 配下の現行 documentation issue 資料だけを収録した。

## 含めていないもの

- `docs/archive` および consumer/provider の `docs/active` 外にある issue・handoff・文書。
- `Integrated_Labeling_Handoff_v1.4 (2).0`、`first-implementation`、`DESIGN_SPEC_V1_SUPERSEDED.md`、旧 child handoff の source snapshot、既存 discussion set zip など、legacy／superseded／過去スナップショット。
- consumer の `src/migration/legacy-boundary.js`、`src/lib/account-block-candidate-workflow.js`、legacy static UI data、UI runtime、実運用 DB、raw payload、`var/`、`node_modules/`、cache。
- consumer の旧候補生成・手動 handoff・旧 publication の成果物・handoff bundle・UI compatibility 経路など、今回の Work Orchestrator 更新の現行実行境界に属さないもの。現行 release 検証に必要な deterministic processing source は対象経路として残している。
- provider の `docs/active` 外の作業資料、旧版生成物、provider repository の既存 archive。

## 参照関係

- `sources/consumer/package/src/workflow/` と `sources/provider/package/src/validation.ts`・`contracts.ts`・`domain.ts`・`runtime.ts` を対応させると、Definition の canonical hash、Task contract、Choice／Wait／Noop、Agent result、Session view の境界を確認できる。
- `sources/consumer/package/src/integration/task-handlers.js` と `sources/provider/package/src/runtime.ts`・`temporal-activities.ts`・`temporal-workflow.ts` を対応させると、Application Service と AgentAdapter、permission、retry、blocked／failed の責務を確認できる。
- `sources/consumer/package/src/application/`・`state/`・`database/`・`release/`・`deployment/` と provider の `registry.ts`・`artifact-store.ts`・`workspace.ts` を対応させると、business authoritative state と Orchestrator execution state、永続 Workspace、artifact、idempotency、external event の分離を確認できる。
- provider の `package/reference/` は、現行公開 API の利用方法と package 配布条件を確認するための一次資料である。behavioral source は `package/src/` と `package/dist/` を正とする。
