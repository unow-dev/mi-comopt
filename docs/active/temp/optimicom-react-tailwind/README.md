# Optimicom React + Tailwind

元の単一HTML版を React + Tailwind CSS + Vite に移植したものです。

## 構成

- React 18
- Tailwind CSS 3
- Vite
- DOM直操作をReact stateへ置換
- レスポンシブUI対応
- コメント分類切替・検索
- キーワード候補検索 / リスク絞り込み / new絞り込み
- コピー + 追加済み / ブロック済みマーク
- アカウント履歴モーダル
- 集計期間トースト

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
- `src/data.js` サンプルデータ
- `src/components/Icon.jsx` SVGアイコン
- `src/index.css` Tailwindエントリと最小限のグローバルCSS
- `tailwind.config.js` 色・フォント・シャドウ定義
