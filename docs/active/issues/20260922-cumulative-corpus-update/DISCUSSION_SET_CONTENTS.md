# Discussion Set Contents: 累積corpus更新

## 目的

指定された issue の議論を詰める際に、現行の Comment DB v3 更新経路を、入力取込から corpus、分類、キーワード候補、release／公開artifactまで同じスナップショットから確認できるようにする。

## スナップショット

- consumer: `tiktok-filter-keywords`
- revision: `HEAD`（作成時点の作業ツリーを収録。未コミット変更を含む）
- 作成日: 2026-09-22

## 構成

```text
20260922-cumulative-corpus-update-discussion-set/
├── ISSUE_BODY.md
├── DISCUSSION_SET_CONTENTS.md
└── sources/
    ├── package.json / package-lock.json
    └── package/
        ├── contracts/（入力・v3 session・handoff・候補生成契約）
        ├── db/comment-database/（現行DB migration）
        ├── scripts/（Comment DB CLI、v3 operator、handoff／export adapter）
        ├── src/（v3 application、state、database、snapshot、processing、release）
        ├── templates/three-class-workset/
        └── tests/（対象経路の回帰テストとfixture）
```

## 含めたもの

- root の `ISSUE_BODY.md` は、指定された issue 本文を内容変更せず収録した。
- Comment batch／rich snapshot の契約・adapter・変換処理、raw snapshot の保存・参照・検証処理を収録した。
- `CorpusApplicationServiceV3`、classification／keyword handoff、state control plane、v3 workflow／runtime／operator を収録した。
- 三分類ラベル、候補生成・publication、source dataset、UI release artifact の生成境界を収録した。
- 現行DB migration、入力・handoff契約、three-class workset template、および対象経路の回帰テストを収録した。
- 作成時点の作業ツリーにある関連する未コミット変更も、対象ファイルの現行内容として収録した。

## 含めていないもの

- `docs/archive` および `docs/active` 外の文書・資料。
- 旧版／superseded な運用資料、過去のdiscussion set、旧版labeling package、legacy boundary実装。
- 実運用のSQLite DB、raw payload、公開済みartifact、静的生成データ、`var/`、`work/`、`node_modules/`、cache。
- UI実装そのもの、旧compatibility経路、今回の累積corpus議論に直接関係しない候補・アカウントの成果物。

## 参照関係

- `package/src/application/v3/domain-services.js` と `package/src/database/raw-snapshot-repository.js` を対応させると、corpusがどのsnapshot参照を状態化するかを確認できる。
- `package/src/processing/optimicom-ui-release/source-dataset.js`、`package/scripts/adapters/keyword-candidate-comment-db.js`、三分類adapterを対応させると、corpus参照が分類・候補生成・source datasetへどう伝播するかを確認できる。
- `package/src/workflow/v3/definitions.js`、`package/src/integration/`、`package/src/application/v3/release-services.js` を対応させると、累積corpusの後段処理とrelease pinの境界を確認できる。
- `package/tests/v3-acceptance-services.test.js`、raw snapshot／DB／UI release／handoff関連テストを対応させると、現在の単一snapshot前提、ラベル継承、artifact整合性の検証点を確認できる。
