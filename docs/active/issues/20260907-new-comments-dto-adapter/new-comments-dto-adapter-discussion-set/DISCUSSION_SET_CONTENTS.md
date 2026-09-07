# Discussion Set Contents: `new-comments.json` DTO adapter

## 目的

`new-comments.json` のwrapper固有parserをcollector側へ追加する議論に必要な、現在のraw snapshot契約、generic import境界、DB materialization、analysis input投影、CLI、テストの実装断面を、リポジトリルート相対の構成で固定する。

## 構成

```text
new-comments-dto-adapter-discussion-set/
├── ISSUE_BODY.md
├── DISCUSSION_SET_CONTENTS.md
└── sources/
    └── package/
        ├── ARCHITECTURE.md
        ├── package.json
        ├── contracts/raw-snapshots/tiktokRawSnapshot-1.0.0.schema.json
        ├── db/comment-database/001-init.sql
        ├── db/comment-database/002-raw-snapshots.sql
        ├── db/comment-database/003-rich-raw-inputs.sql
        ├── src/raw-snapshot/raw-snapshot-contract.js
        ├── src/database/comment-database.js
        ├── src/database/raw-snapshot-repository.js
        ├── src/processing/analysis-input/raw-snapshot-projection.js
        ├── scripts/comment-database.mjs
        ├── tests/comment-database.test.js
        ├── tests/raw-snapshot-database.test.js
        ├── tests/raw-snapshot-analysis-input.test.js
        └── docs/comment-database.md
```

## 含めたもの

- 現行のlayer boundaryと、wrapper parserをDatabase/Processingへ置かないための設計方針。
- 単一TikTok raw snapshotのschema、契約parser、既存互換adapter。
- rich raw inputのbytes保存、複数snapshot DTO受け入れ、snapshot index、冪等性・整合性を扱うDB実装。
- raw snapshotからanalysis inputを生成する実装。adapterの出力が既存の後段へ渡る経路を確認するために含める。
- `import-raw-snapshot`、generic import、backfill、export、verifyのCLI実装。
- DTO契約、DB materialization、analysis inputの既存テスト。
- adapter作成後に追加すべき実データ形状fixture・変換テストの配置を検討するための既存ドキュメント。

## 含めていないもの

- `/home/uya/Workspace/tiktok-filter-keywords/work/` 配下の作業データおよび実際の `new-comments.json` 本体。
- `docs/archive/` 配下の文書。
- collector固有の取得実装、legacy rawとのmerge、Stage13 dataset、label・candidate・publicationの実装。
- 本番DB、var、cache、生成物、環境依存の秘密情報。

実データ本体を含めない代わりに、issue本文へ確認済みのwrapper形状（rootの `items` 配列、確認時点で8 item、item内の `source`・`video`・`stats`・`author`・`comments` 等）と、null・欠落値がDTO変換条件に影響する点を記載している。議論セットで再現性が必要になった場合は、実データを複製せず、必要最小限の匿名化fixtureを別途作成する。

## 参照関係

- rich raw databaseのsource-of-truthとgeneric input境界は、関連issueの実装を前提とする。
- `new-comments.json` をlegacy rawと統合してStage13へ渡す責務は、current incoming raw dataset integration issueの範囲に残す。
- 本議論セットはwrapperからDTOへの境界に限定し、後段のDatabase/Processingへwrapper形式を漏らさないことを確認対象とする。
