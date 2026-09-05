# raw snapshot拡張とDB起点分析 — 実装handoff

Status: **implementation-ready / specification frozen**  
Handoff version: **1.0.0**  
Prepared: **2026-09-05 (Asia/Tokyo)**  
Target repository: `unow-dev/mi-comopt`

## 使い方

実装作業者は、まず `00_IMPLEMENTATION_HANDOFF.md` を読み、その後に担当PRに応じて以下を参照する。

- PR1: `checklists/PR1_WRITE_BOUNDARY.md`
- PR2: `checklists/PR2_READ_BOUNDARY.md`
- DB契約: `contracts/DB_V2_CONTRACT.md`
- CLI契約: `contracts/CLI_CONTRACT.md`
- export/manifest契約: `contracts/ANALYSIS_EXPORT_CONTRACT.md`
- テスト: `TEST_PLAN.md`
- 変更ファイル: `FILE_CHANGE_PLAN.md`
- 完成後のissue本文案: `ISSUE_BODY_IMPLEMENTATION_READY.md`
- 撤回済み案: `REJECTED_DECISIONS.md`

`proposed/` には実装の起点として使えるDDL案、raw schema契約、manifest例を置いている。DDLはhandoffの契約をそのままSQLへ落としたドラフトであり、意味変更をせずに実装する。

## 最重要の境界

このissueが所有するのは以下まで。

```text
TikTok rich raw snapshot
  -> exact-byte raw canonical store
  -> Comment DB v2 normalization
  -> explicit snapshot selection
  -> exact 5-field JSON + manifest
```

以下は **別issue** の責務であり、この実装で行わない。

```text
既存5-field datasetとの統合
cross-snapshot dedupe
全履歴dataset構築
Stage13 reference reuse
ラベル・候補生成・UI・deploy
```

## 完了定義

PR1とPR2がmergeされ、既存v1 `comment-db import`の契約を壊さず、fixtureで

```text
rich raw -> raw store -> SQLite -> 5-field JSON + manifest
```

を決定的に再現できれば本issueは完了。
