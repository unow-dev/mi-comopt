# ダッシュボードデザイン議論セット

## 内容

- `ISSUE_BODY.md` は指定 issue の本文です。
- `AIコメント分析ダッシュボード.png` は本文から参照されるラフ案です。
- `source/` は、現行の公開 UI とダッシュボードの表示・データ解釈に関わる実装ソースおよび契約です。`source/package/` 以下のパスはリポジトリ内の元のパスを保っています。

## 参照できる実装

| 元のパス | 議論に使える内容 |
| --- | --- |
| `package/index.html`, `package/src/main.jsx`, `package/package.json` | UI のエントリーポイント、ページタイトル、実行環境 |
| `package/src/ui/App.jsx` | 現行ナビゲーション、分析概要、候補一覧、画面幅ごとの構成、読み込み・エラー状態 |
| `package/src/ui/index.css`, `package/tailwind.config.js`, `package/src/ui/components/Icon.jsx`, `package/src/ui/images/logo.png` | 色・書体・間隔、アイコン、ブランド表示 |
| `package/src/ui/data-model.js`, `package/src/ui/public-order-index.js` | 分類名、コメントの絞り込み、治安指数と一次迷惑率の表示値 |
| `package/src/processing/optimicom-ui-release/overview.js`, `source-dataset.js` | 対象日、期間集計、欠測日、分類別観測数の生成と入力データ形状 |
| `package/src/ui/release-client.js` | 公開データの読み込みと画面が消費するデータ形状 |
| `package/src/processing/account-block-candidates/account-block-candidate-workflow.js`, `package/contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json` | ブロック候補の条件と根拠データ |
| `package/contracts/keyword-candidates/evaluation-policy-1.0.0.json`, `taxonomy-1.0.0.json` | フィルター候補の推奨度・分類の定義 |
| `package/src/ui/local-state.js`, `clipboard.js` | 候補画面のブラウザー内状態とコピー操作 |
| `package/src/ui/loading/LoadingScreen.jsx`, `loading-screen.css`, `emblem.webp` | 共通の読み込み表示 |

このセットは議論用の参照資料です。アプリを単独でビルドするための全依存ファイル一式ではありません。

## 範囲

実装ソースは現行の `package/` から選びました。Issue 本文とラフ案以外の `docs` 文書、`docs/active/temp` の試作、旧版・履歴資料、実コメントを含むデータは同梱していません。
