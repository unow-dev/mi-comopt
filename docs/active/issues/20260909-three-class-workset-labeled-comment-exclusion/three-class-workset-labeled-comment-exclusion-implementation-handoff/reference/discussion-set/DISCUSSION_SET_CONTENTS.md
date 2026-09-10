# three-class workset labeled-comment exclusion 議論セット

## 目的

指定された issue の議論に必要な、現行の three-class workset 生成・Comment DB ラベル保存・最終ラベル同期・検証境界を、リポジトリ相対パスを保ったまま一つの成果物へ集約する。

今回の中心論点は、Comment DB に保存されたラベルを完全一致の comment 文字列で集約し、`direct_nuisance > reactive > normal` の優先順位で採択したラベルを `HISTORY.json` の評価例へ反映し、採択済み comment を `ITEMS.json` から除外する変更範囲である。

## 収録範囲

- `ISSUE_BODY.md`
  - 議論対象の issue 本文。discussion set root に配置する。
- `sources/package/scripts/adapters/three-class-workset.js`
  - 現行 workset の生成・検証・response 適用。現在の `HISTORY.json` 読み込み、exact-string の `ITEMS.json` 重複排除、DB provenance、label 適用境界を確認する中心実装。
- `sources/package/src/database/three-class-label-repository.js`
  - workset provenance、対象 observation、DB 全体の既存 comment label、対象範囲 label の SQL 読み書き。
- `sources/package/scripts/adapters/three-class-final-sync.js`
  - 完全一致 comment の label map と `direct_nuisance > reactive > normal` の採択処理。
- `sources/package/src/three-class-workset/protocol.js`
  - `HISTORY.json`、`ITEMS.json`、response、ZIP member の現行 v1 契約。
- `sources/package/src/database/raw-snapshot-repository.js`、`sources/package/src/processing/analysis-input/raw-snapshot-projection.js`
  - 選択 snapshot の検証・順序・重複保持・5-field projection。生成対象の入力境界を確認するために収録する。
- `sources/package/src/database/comment-database.js` と `sources/package/db/comment-database/001-init.sql` から `006-three-class-label-application.sql`
  - 現行 Comment DB の open/migration と、label/workset provenance が依存する schema 定義。
- `sources/package/scripts/comment-database.mjs`、`sources/package/scripts/pack-three-class-workset.py`、`sources/package/package.json`
  - CLI 境界、workset ZIP の固定 member 構成、実行契約。
- `sources/package/templates/three-class-workset/`
  - 現行の分類ルール、prompt、response schema。`HISTORY.json` が参照例であり規範ではないことを確認するために収録する。
- `sources/package/tests/three-class-workset.test.js`、`three-class-final-sync.test.js`、`raw-snapshot-database.test.js`、`raw-snapshot-analysis-input.test.js`
  - workset、exact-comment label 同期、DB schema、projection の現行回帰テスト。
- `sources/docs/active/issues/20260908-db-three-class-workset-generation/ISSUE_BODY.md`
  - DB からの workset 生成 issue。
- `sources/docs/active/issues/20260908-three-class-workset-db-label-application/ISSUE_BODY.md`
  - response の Comment DB label 保存 issue。
- `sources/docs/active/issues/20260908-three-class-workset-simple-chatgpt-handoff/ISSUE_BODY.md`
  - ChatGPT 向け v1 workset の受け渡し境界を定めた issue。
- `sources/docs/active/issues/20260909-three-class-final-comment-db-label-sync/ISSUE_BODY.md`
  - `three_class_final` と Comment DB label の同期 issue。
- `sources/docs/active/operations/integrated-labeling-state/three_class_history.json`
  - 現行運用で workset の `HISTORY.json` 入力に使われる label history。

## 除外範囲

- `docs/archive` および `docs/active` 以外の `docs` 配下の文書。
- `package/docs`、過去 issue の nested discussion set、旧 handoff の source snapshot、legacy import や legacy pipeline を主題とするファイル。
- `var/`、DB 実体、作業用一時ファイル、生成済み workset/response、候補生成・公開処理など今回の論点に直接関係しない実装。
- 現行実装の動作を検証するために存在する legacy 拒否テストの参照先ファイル自体は収録しない。テストコードは現行 workset の回帰境界として収録する。

## 配置規則

discussion set root には `ISSUE_BODY.md` と本目録を置く。実装・設定・テストは `sources/package/` 以下にリポジトリ相対パスを保って収録し、文書は `sources/docs/active/` 以下に現行の active 文書だけを収録する。

## 作業メモ

- 現行生成処理は `HISTORY.json` を入力として同梱するが、Comment DB の既存 label を `ITEMS.json` 除外や `HISTORY.json` 採択へ利用していない。
- 現行 label repository は comment 文字列ごとの既存 label 群を返却できる。採択順位の実装は最終同期 adapter に存在する。
- raw observation は immutable な入力として扱われ、label は別テーブルに保存される。
- ZIP 作成後に内容を検査するため、discussion set は実行時生成物ではなく、現在のリポジトリ内の実装・契約・テストのスナップショットである。
