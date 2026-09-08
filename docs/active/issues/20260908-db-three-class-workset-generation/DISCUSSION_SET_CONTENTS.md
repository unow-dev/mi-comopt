# Comment DB から 3-class 作業セット生成 議論セット

## 目的

`ISSUE_BODY.md` の議論に必要な現行実装の境界を、repository root からの相対パスを保ったまま一つの ZIP に集約する。中心となる論点は、Comment DB にある `comment-batch` を再現可能に選択・5-field 入力へ投影する既存経路と、現行の Stage13 → 3-class single-roundtrip 作業セット生成経路を接続するための入出力契約、成果物構成、検証である。

## 収録範囲

- `ISSUE_BODY.md`
  - 議論対象の issue 本文。discussion set root に配置する。
- `sources/package/package.json`
  - Comment DB CLI と Node.js テストの実行契約。
- `sources/package/contracts/collector-inputs/tiktokCommentBatch-1.0.0.schema.json`
  - 旧5-field `comment-batch` の厳格な入力契約。
- `sources/package/contracts/raw-snapshots/tiktokRawSnapshot-1.0.0.schema.json` と `sources/package/src/raw-snapshot/raw-snapshot-contract.js`
  - 同じ DB 実装が併存して扱う rich raw snapshot の現行入力契約。`comment-batch` との materialization 境界を確認するために収録する。
- `sources/package/db/comment-database/001-init.sql`、`002-raw-snapshots.sql`、`005-comment-batch-materialization.sql`
  - 現行 DB の初期化、スナップショット保持、`comment-batch` materialization の schema migration。
- `sources/package/src/collector/comment-batch/` および `sources/package/scripts/adapters/comment-batch.js`
  - `comment-batch` の検証・バイト保存・スナップショット化の実装。
- `sources/package/src/database/comment-database.js`
  - DB open/migration と raw input の import・materialization。
- `sources/package/src/database/raw-snapshot-repository.js`
  - `payload_sha256:snapshot_index` による選択、順序・整合性検証、DBからの観測取得。
- `sources/package/src/processing/analysis-input/raw-snapshot-projection.js`
  - DB観測を既存3-class入力である厳密な5-field JSONと出典 manifest に投影する処理。
- `sources/package/scripts/comment-database.mjs`
  - 既存の `import-comment-batch` と `export-analysis-input` の CLI 境界。
- `sources/package/tests/comment-batch.test.js` と `sources/package/tests/raw-snapshot-analysis-input.test.js`
  - 重複・順序・出典 manifest・決定的 export の回帰テスト。
- `sources/docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/`
  - 現行の single-roundtrip 実装、入力／出力契約、3-class 仕様、方針、設定、作業者向け prompt、テスト、implementation manifest。
- `sources/docs/active/operations/integrated-labeling-state/`
  - 現行 single-roundtrip が既定で snapshot する golden/P2 adjudication の運用状態。

## 除外範囲

- `docs/archive`、`docs/active` 外の `docs` 配下文書、`package/docs` 配下文書。
- `Integrated_Labeling_Handoff_v1.4` 以前、legacy 5-field import、旧 handoff、過去の議論セット、互換 shim。
- 実データ、DB ファイル、`var/`、`work/`、生成物、UI、候補生成・公開処理。
- 既定の Stage13 reference 実データ。新経路で reference の選択・供給をどう契約化するかは本 issue の検討対象であり、実データを議論セットへ同梱しない。

## 配置規則

discussion set root には `ISSUE_BODY.md` とこの目録を置く。実装・設定・テストは `sources/` 以下に repository root からの相対パスを維持して収録する。`sources/docs/` に収録する文書はすべて `docs/active` 配下の現行 v1.5.0 または現行運用状態に限る。
