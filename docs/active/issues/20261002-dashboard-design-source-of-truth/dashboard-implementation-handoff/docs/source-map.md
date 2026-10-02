# 参照ソースマップ

`references/source_snapshot/package/` は議論時に提供された現行実装の選択snapshotです。全リポジトリではありません。

| パス | 実装時の意味 |
| --- | --- |
| `src/ui/App.jsx` | 現行screen構造、HomeScreen、OverviewScreen、Header、Sidebar、bottom nav、loading/error |
| `src/ui/release-client.js` | release manifest / artifact取得、record_count、cache |
| `src/ui/public-order-index.js` | 治安指数算式、評価閾値、境界を壊さないformatter |
| `src/processing/optimicom-ui-release/overview.js` | overviewの期間集計、coverage、data_end_date |
| `src/ui/index.css` | focus-visible等の共通CSS |
| `tailwind.config.js` | 既存色、shadow、font token |
| `src/ui/data-model.js` | 既存候補/UIデータ補助ロジック |
| `src/ui/local-state.js` | 候補画面のローカル操作状態 |
| `src/ui/loading/*` | 初期/コンテンツloading表現 |

## 現行実装で特に注意する定数

`App.jsx`:

```text
INITIAL_LOADING_MINIMUM_MS = 2000
ARTIFACT_LOADING_MINIMUM_MS = 700
```

今回:

- 2000msの初期演出は維持。
- ホームのoverview領域には700ms最低待機を適用しない。
- 既存artifact画面側の700msは変更しない。

## 治安指数境界

`public-order-index.js` が正本。

```text
<= 2%         goal_met
>2% and <3%   goal_unmet
>=3% and <4%  caution
>=4%          warning
```

UI側に別の閾値を重複定義しないこと。
