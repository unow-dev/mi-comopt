# rich raw DB source of truth 議論セット

## 目的

`ISSUE_BODY.md` の議論に必要な現行実装の境界を、repository root からの相対パスを保ったまま一つの zip に集約する。中心となる論点は、rich raw の完全保持、DBからの再取得、raw 本文を5フィールドへ投影する既存契約、およびその検証である。

## 収録範囲

- `ISSUE_BODY.md`
  - 議論対象の issue 本文。discussion set root に配置する。
- `sources/package/package.json`
  - comment DB CLI とテストの実行契約。
- `sources/package/contracts/raw-snapshots/tiktokRawSnapshot-1.0.0.schema.json`
  - rich raw snapshot の入力契約。
- `sources/package/db/comment-database/002-raw-snapshots.sql`
  - raw snapshot と正規化済み観測を保存する現行 schema migration。
- `sources/package/db/comment-database/001-init.sql`
  - 現行 DB を開く際に `002-raw-snapshots.sql` とともに適用される初期 schema migration。
- `sources/package/src/raw-snapshot/raw-snapshot-contract.js`
  - raw snapshot の検証、SHA、content-addressed raw store の実装。
- `sources/package/src/database/comment-database.js`
  - DB open/migration、rich raw import、正規化テーブルへの保存処理。
- `sources/package/src/database/raw-snapshot-repository.js`
  - DBからのsnapshot選択、分析観測の取得、外部raw store検証。
- `sources/package/src/processing/analysis-input/raw-snapshot-projection.js`
  - DB観測から `username`、`handle`、`comment`、`postedAt`、`postedDate` へ投影する処理。
- `sources/package/scripts/comment-database.mjs`
  - import、DB由来の分析入力 export、raw store verify の CLI 境界。
- `sources/package/tests/raw-snapshot-database.test.js`
  - rich raw import、保持、idempotency、integrity、raw store の回帰テスト。
- `sources/package/tests/raw-snapshot-analysis-input.test.js`
  - DB由来の5フィールド投影、決定的順序、DB-only export の回帰テスト。

## 除外範囲

- `docs/active` にある対象 issue 本文以外の文書。
- `docs/archive` および `docs/active` 以外の `docs` 配下の文書。
- `work/`、`var/`、公開済みデータ、実運用の raw 入力などの実データ。
- 旧 handoff 一式、bootstrap 入力、コンパイル済み cache、legacy shim。
- 今回の rich raw DB source of truth の判断に直接関係しない UI、候補生成、公開処理。

## 配置規則

discussion set root には `ISSUE_BODY.md` とこの目録を置く。実装ファイルは `sources/` 以下に repository root からの相対パスを維持して収録する。
