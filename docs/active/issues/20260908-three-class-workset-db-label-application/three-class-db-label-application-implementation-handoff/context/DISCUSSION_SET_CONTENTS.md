# v1 three-class 判定結果の Comment DB 反映 議論セット

## 目的

`ISSUE_BODY.md` の検討に必要な現行実装を、repository root からの相対パスを保ったまま一つのセットに集約する。対象は、選択済み Comment DB snapshot から comment を完全一致で重複排除して workset を作る経路、検証済み response の契約、および snapshot 内の観測を保持する DB schema とその回帰テストである。

## 収録範囲

- `ISSUE_BODY.md`
  - 本議論セットの対象 issue 本文。セット root に配置する。
- `sources/package/package.json`
  - Comment DB CLI と回帰テストの実行契約。
- `sources/package/db/comment-database/001-init.sql` から `005-comment-batch-materialization.sql`
  - 現行 Comment DB の migration 履歴。`snapshot_comment_observations`、raw input／snapshot の同一性、観測の順序・重複保持、`comment-batch` の materialization 境界を確認する。
- `sources/package/src/database/comment-database.js`
  - DB open・migration・raw input と snapshot 観測の保存を担う現在の DB 境界。
- `sources/package/src/database/raw-snapshot-repository.js`
  - `payload_sha256:snapshot_index` による対象 snapshot の明示選択、観測取得、整合性検証の実装。
- `sources/package/src/processing/analysis-input/raw-snapshot-projection.js`
  - 選択 snapshot の観測を先頭出現順の 5-field record へ投影する処理。
- `sources/package/src/collector/comment-batch/`、`sources/package/scripts/adapters/comment-batch.js`、`sources/package/contracts/collector-inputs/tiktokCommentBatch-1.0.0.schema.json`
  - 本件の DB 入力となる `comment-batch` を、観測の順序・重複を保って取り込む現行経路。
- `sources/package/src/three-class-workset/protocol.js`、`sources/package/scripts/adapters/three-class-workset.js`、`sources/package/scripts/comment-database.mjs`、`sources/package/scripts/pack-three-class-workset.py`
  - v1 workset の生成、ZIP 境界、response の workset ID・item ID・label 完全性検証、CLI 境界。
- `sources/package/templates/three-class-workset/`
  - validator が byte 完全一致を確認する prompt・rules と response schema template。
- `sources/package/tests/comment-batch.test.js`、`raw-snapshot-analysis-input.test.js`、`raw-snapshot-database.test.js`、`three-class-workset.test.js`
  - DB 観測の重複・順序・snapshot 選択、workset の comment-only 重複排除、response 完全性を確認する現行回帰テスト。
- `sources/docs/active/issues/20260908-db-three-class-workset-generation/ISSUE_BODY.md`
  - DB snapshot から workset を直接生成した直前の要求。
- `sources/docs/active/issues/20260908-three-class-workset-simple-chatgpt-handoff/`
  - v1 handoff の採択済み決定、プロトコル、検証契約、受入条件。本 issue で追加する反映経路との境界（DB 反映・HISTORY 自動更新が v1 の対象外だったことを含む）を確認する。

## 除外範囲

- `docs/archive` および `docs/active` 外にある `docs` 配下の文書。
- 旧 handoff、legacy 5-field import、過去の議論セット、互換用の実行経路。
- 実データ、SQLite DB、`var/`、`work/`、生成済み workset／response、既存 ZIP、`node_modules/`、`dist/`。
- UI、候補キーワード生成・公開など、判定結果を Comment DB へ反映する本件に直接関係しない実装。

## 配置規則

セット root には `ISSUE_BODY.md` とこの目録を置く。収録した実装・契約・テストは `sources/` 以下に repository root からの相対パスを維持して配置する。`sources/docs/` に含める文書はすべて `docs/active` 配下の現行 20260908 の資料に限定する。
