# Discussion Set Contents: Optimicom React + Tailwind DB source-of-truth implementation

## 目的

指定 issue の実装議論を詰める際に、対象 UI と現行 DB 経路の実装境界、契約、検証材料を同じ参照セットから確認できるようにする。

## 構成

```text
optimicom-react-tailwind-db-discussion-set/
├── ISSUE_BODY.md
├── DISCUSSION_SET_CONTENTS.md
└── sources/
    ├── package/
    │   ├── package.json
    │   ├── README.md
    │   ├── ARCHITECTURE.md
    │   ├── contracts/
    │   ├── db/comment-database/
    │   ├── scripts/
    │   ├── src/（ui・data・main.jsx を除く現行実装）
    │   ├── templates/three-class-workset/
    │   └── tests/（除外 UI 依存テストを除く）
    └── docs/active/
        ├── temp/optimicom-react-tailwind/（依存パッケージと dist を除く）
        ├── issues/20260907-rich-raw-database-source-of-truth/
        ├── issues/20260909-db-three-class-keyword-candidate-handoff/
        ├── issues/20260912-225233-optimicom-react-tailwind-db-feasibility/
        └── operations/（現行 Integrated_Labeling_Handoff_v1.5.0 と label state）
```

## 含めたもの

- root の `ISSUE_BODY.md` は、指定された `IMPLEMENTATION_ISSUE_BODY.md` の内容をそのまま収録した。
- 対象 UI の画面・固定値・画面内 state・操作を確認する現行試作一式を収録した。
- Comment DB の migration、raw snapshot 読み書き、3分類ラベル、候補 publication、候補生成、CLI とその契約を収録した。
- DB 正本化、3分類ラベルからのキーワード候補 handoff、DB-current から UI 用出力への既存 active handoff・受入条件・source map を収録した。
- 現行 `Integrated_Labeling_Handoff_v1.5.0` の3分類仕様、変更管理、pipeline contract と、対応する `three_class_history.json` を収録した。
- 実装境界を確認できる現行テストと匿名 fixture を収録した。

## 含めていないもの

- `package/src/ui`、`package/src/data`、`package/src/main.jsx` および、それらを直接参照する UI adapter／NEW badge／候補 DB UI 結合テスト。
- `package/dist`、`docs/active/temp/optimicom-react-tailwind/node_modules`、cache。
- `var/comment-history.sqlite3` 本体、work ディレクトリ、秘密情報および実運用の raw payload。
- `docs/active` 外の文書、`docs/archive`、旧版 `Integrated_Labeling_Handoff_v1.4 (2).0`、legacy issue／handoff／discussion set。
- 対象 UI 以外の `docs/active/temp` にある別 UI 試作。

## 参照関係

- `sources/docs/active/temp/optimicom-react-tailwind` が置換対象 UI の現在の表示構造を示す。
- `sources/package/src/database`、`sources/package/db`、`sources/package/scripts` が DB を正本として UI 用データを導出する実装境界を示す。
- `sources/package/src/processing` と現行 active handoff が、3分類データからキーワード候補・アカウント候補を決定的に導出し、検証・publication へつなぐ契約を示す。
- `package/src/ui` は対象 issue の決定により参照経路から除外しているため、対象 UI の実装議論は `docs/active/temp/optimicom-react-tailwind` を起点に行う。
