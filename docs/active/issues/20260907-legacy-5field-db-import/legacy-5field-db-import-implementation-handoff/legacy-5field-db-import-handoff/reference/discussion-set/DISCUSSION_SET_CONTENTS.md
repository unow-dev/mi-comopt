# Discussion Set Contents: legacy 5-field DB import

## 目的

旧5-field raw JSONを、出所・取得時刻など元データで表現されない値を推測せずに、現行のgeneric raw input境界からComment DBへ原子的に取り込む契約を議論するための、現行実装の最小限の参照断面を固定する。

## 構成

```text
legacy-5field-db-import-discussion-set/
├── ISSUE_BODY.md
├── DISCUSSION_SET_CONTENTS.md
└── sources/
    ├── docs/active/issues/
    │   ├── 20260907-new-comments-dto-adapter/ISSUE_BODY.md
    │   └── 20260907-rich-raw-database-source-of-truth/ISSUE_BODY.md
    └── package/
        ├── ARCHITECTURE.md
        ├── package.json
        ├── contracts/{collector-inputs,raw-snapshots}/
        ├── db/comment-database/
        ├── docs/comment-database.md
        ├── scripts/{adapters,}/
        ├── src/{collector,database,processing,raw-snapshot}/
        └── tests/
```

`ISSUE_BODY.md` は依頼対象 issue 本文の同一コピーであり、議論セットの root に置く。

## 含めたもの

- 現行のレイヤー境界。Collector固有の形式を generic `{ payloadBytes, inputFormat, snapshots }` へ変換し、Database/Processingへ形式固有parserを持ち込まない責務分離。
- raw snapshot と `new-comments` wrapper の契約・adapter。5-field専用入力契約を追加する際の、入力bytes保持、厳格な検証、DTO変換の比較対象。
- Comment DB v4のgeneric import、materialization比較、トランザクション、raw BLOB、snapshot index、観測順序、読取り・analysis projection、およびCLI経路。
- 現行スキーマを構成する全migrationと、入力検証・冪等性・重複保持・原子性・境界を確認するテスト。
- 関連する当日付のactive issue本文。rich rawをsource of truthとする前提と、既存wrapper adapterの設計判断を確認する用途に限定する。

## 含めていないもの

- `/home/uya/Workspace/tiktok-filter-keywords/work/` の実データ、および旧5-field JSON本体。個人情報を含み得る入力を複製しない。
- `docs/active` 以外の`docs`配下の文書。`docs/archive/` は含めない。
- 過去issueのhandoff、source snapshot、生成済みdiscussion set、旧版implementation artifactなどのレガシー資料。
- DB、raw payload、fixture以外の生成データ、cache、`var/`、秘密情報。

現行のproduction source・migration・test内には、既存DB移行との互換性を保つための`legacy`という識別子が残る箇所がある。これらは議論対象となる現行実装であり、過去の資料や実データを同梱したものではない。

## 参照順

1. rootの`ISSUE_BODY.md`で目的と未決の契約条件を確認する。
2. `sources/package/ARCHITECTURE.md`、Collector contract/adapter、`comment-database.js`で、5-field入力を接続すべき境界を確認する。
3. schema・migration・`raw-snapshot-repository.js`・projectionで、保存可能な値、順序、provenance、既存の読取りモデルを確認する。
4. `sources/package/tests/`で、追加契約が維持すべき検証・原子性・重複保持のテスト様式を確認する。
