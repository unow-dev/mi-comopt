# Optimicom React + Tailwind

Comment DBから公開されたrelease artifactを読む、React + Tailwind CSS + Vite製のread-only UIです。

## 構成

- React 18
- Tailwind CSS 3
- Vite
- release rootをpage lifetimeで固定
- 画面別artifactのlazy loadとmemory cache
- 3分類の集計・コメント検索・50件pagination
- キーワード推奨度・NEW・構造化根拠
- copy事実とbrowser-local markの分離
- アカウント候補判定の根拠モーダル

## 起動

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## 主なファイル

- `src/App.jsx` UI・状態管理
- `src/release-client.js` release rootとartifact loader
- `src/local-state.js` versioned browser-local state
- `src/data-model.js` 3分類・検索・pagination・NEWのpure logic
- `src/components/Icon.jsx` SVGアイコン
- `src/index.css` Tailwindエントリと最小限のグローバルCSS

## 公開データ

デプロイ先の同一originに `optimicom-ui-release.json` と、manifestが指す `artifacts/` 配下の4 artifactを配置します。DBからの生成・検証はrepository rootのpackageで行います。
- `tailwind.config.js` 色・フォント・シャドウ定義
