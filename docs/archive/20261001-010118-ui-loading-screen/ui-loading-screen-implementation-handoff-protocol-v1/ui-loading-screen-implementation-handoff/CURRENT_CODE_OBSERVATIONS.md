# Current Code Observations (discussion-set snapshot)

このファイルは設計判断に必要なコード事実だけを記録する。実装契約は `IMPLEMENTATION_HANDOFF.md` を正とする。

## `src/ui/App.jsx`

同梱 snapshot で確認した事実:

- `LoadingState` は通常 shell 内のカード型表示。
- `useArtifact(client, key, enabled)` は初期 `idle`。
- enabled 時、effect 開始後に `loading` を設定する。
- overview / comments / keywords / accounts の複数 hook instance を常設する。
- release loading と artifact loading は通常 shell 内 content として描画される。
- Sidebar / Header / mobile nav と toast は別 z-index layer を持つ。
- toast は timer で消える。

設計への影響:

- cache hit を初回 render から ready として扱うには、effect 開始後だけではなく初期 render 時点で同期可用性を判断できる境界が必要。
- artifact-specific error/loading state を artifact identity にスコープする必要がある。
- full-screen loading と toast を両立させる view boundary が必要。

## `src/ui/release-client.js`

同梱 snapshot で確認した事実:

- `ARTIFACT_KEYS = ['comments', 'overview', 'keywords', 'accounts']`
- release session ごとに `cache = new Map()` を保持する。
- `loading = new Map()` で同一 artifact の in-flight request を共有する。
- `loadArtifact()` は cache hit を再利用する。
- in-flight hit は既存 Promise を返す。
- success / failure 後に in-flight entry を削除する。

設計への影響:

- dedupe の責務は既に data-client に存在するため、UI に別 dedupe ownership を追加しない。
- UI が初回 render で cache availability を判断できる最小 contract を data-client 境界に用意する案が自然。

## `src/main.jsx`

React StrictMode が有効。

設計への影響:

- request correctness を effect の実行回数に依存させず、data-client の cache / in-flight contract で成立させる。

## 検証境界

`reference/current-code/` は完全な app checkout ではない。tests、import 先、画像、lockfile 等が不足しているため、この snapshot 単体の `npm test` / `npm run build` 成否を implementation completion の根拠にはしない。

実装時は実リポジトリの最新コードを調査する。最新コード事実が上記 snapshot と異なること自体は問題ではない。確定設計と衝突する事実が判明した場合のみ、設計へ差し戻す。
