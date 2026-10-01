# Child Issue: Work Orchestrator Compatibility

## Parent

- Parent handoff: [Comment DB State Management / Workflow Handoff v2](../../README.md)
- Gap analysis: [Work Orchestrator 互換性ギャップの切り分け](../../WORK_ORCHESTRATOR_COMPATIBILITY_GAP.md)

## Purpose

`tiktok-filter-keywords` と `/home/uya/Workspace/work-orchestrator/package` の間にある互換性ギャップを、Consumer と Provider の相互依存を保った1つの子Issueで解消する。業務意味を静的な相関値や暗黙の終端へ置き換えず、両側の契約・実装・検証を同じ作業単位で完了させる。

## Problem Boundary

問題はConsumer側とProvider側の両方にあるが、分離すると次の相互依存を失う。

- Consumer の Definition builder は Provider の公開型・validator に適合する必要がある。
- Provider は Consumer が要求する動的 deployment event 相関と terminal semantics を表現できる必要がある。
- Choice の decision、branch input、Agent outcome の意味は両側で同時に確定する必要がある。
- Definition revision、canonical hash、配布対象 `dist`、Consumer の登録テストは同じ変更単位で更新する必要がある。

## Scope

### Consumer側

- `package/src/workflow/definitions.js` の WorkDefinition builder
- Task input、routing outcome、retry/intervention、terminal branch
- `package/src/workflow/compatibility.js` の検証・登録境界
- canonical hash、snapshot、immutable revision

### Provider側

- `work-orchestrator` の公開型、validator、runtime
- 動的 deployment event correlation と immutable wait state
- terminal branch の即時完了意味論
- Choice decision と branch input visibility
- public root export、型宣言、package build/test、配布対象 `dist`

### 統合検証

- 2つの WorkDefinition の公開 root 検証・登録
- deployment request ごとの event isolation
- duplicate event、failed/cancelled event、already-deployed、recovery
- 既存 A01〜A32 と Consumer／Provider の回帰検証

## Acceptance Criteria

- Consumer の公開型不整合が解消されている。
- Provider が Session または先行 Task の値から deployment event correlation を解決し、wait の存続中に変更しない。
- terminal branch が不要な Task、Human Task、外部処理を実行せずに完了する。
- Choice の decision outcome と branch 内入力参照の意味が型・validator・runtime で一致する。
- Agent result と Workflow routing outcome の対応が一貫している。
- canonical hash、snapshot、immutable revision が確定している。
- `WorkOrchestrator.registerDefinition()` で `comment-data-update` と `deploy-promoted-release` を登録できる。
- deployment event の誤相関・重複消費がなく、recovery が同じ意味で動作する。
- Consumer と Provider の build/test、および A01〜A32 の必須検証が成功する。

## Coordination Rules

- Consumer 側で固定値・ワイルドカード・共通 request ID による近似を行わない。
- Provider の API変更時は、型宣言・validator・runtime・dist・package versionを一括で確認する。
- Consumer の Definition hash が変わる場合は、同じ revision を上書きせず新しい revision として扱う。
- 仕様判断が必要な Choice／terminal／correlation の契約は、人間の決定後に実装する。

## Out of Scope

- Comment DB State Control Plane の新規設計
- Classification / Keyword Selection の人間による cutover 判断
- Work Orchestrator Registry に Comment DB の business state を保存すること
