# 実装ガイド

この文書は正本ではなく、議論時点の現行コードへ最短で接続するためのガイドです。内部構造は変更して構いませんが、`dashboard-design-spec.md` の外部挙動を変えないでください。

## 1. 現行コードの主要接続点

参照snapshotでは、主要ロジックは `source_snapshot/package/src/ui/App.jsx` に集中しています。

### 現在の構造

- `App`
  - `screen` stateで画面切替
  - release sessionをロード
  - `dataEndDate` を保持
- `HomeScreen`
  - 現在はサービス紹介
- `OverviewScreen`
  - `periodKey` をローカルstateとして保持
  - 治安指数、一次迷惑率、ゲージを既に実装
- `ArtifactRoute`
  - `useArtifact()` によりoverview/comments/keywords/accountsを画面単位で取得
- `useArtifact()`
  - 既存artifact画面では最低700ms loadingを入れる
- `release-client.js`
  - release manifestに各artifactの `record_count` がある
  - artifact cacheを持つ

## 2. 必須変更

### A. 現行HomeScreenをダッシュボード化

サービス紹介Heroを置き換える。

必要な入力:

- `client.release`
- overviewロード状態
- 共有period
- screen変更関数
- `onDataEndDate`

新しいrouter導入は不要。現行 `screen === 'home'` の切替構造を維持してよい。

### B. period stateを共有可能な階層へ移す

現在 `OverviewScreen` 内:

```js
const [periodKey, setPeriodKey] = useState('7d')
```

これをホームと分析概要が共有できる階層へ持ち上げる。

期待値:

```text
App/shared state: 1d | 7d | 30d
initial: 7d
```

ホーム描画時に `1d` なら `7d` へ正規化する。

localStorageへ保存しない。

### C. ホームではoverviewだけartifact取得

ホームの候補件数:

```js
client.release.artifacts.keywords.record_count
client.release.artifacts.accounts.record_count
```

ホーム表示時に以下を呼ばないこと:

```js
client.loadArtifact('keywords')
client.loadArtifact('accounts')
client.loadArtifact('comments')
```

### D. overview loaderの700ms最低時間をホームには適用しない

実装方法は任意。

例:

- `useArtifact` にminimum loading time optionを追加する
- ホーム専用の小さなloader hookを作る
- 共通loaderを分離する

ただし他画面の現行700ms挙動は今回変更しない。

### E. OverviewScreenは共有periodを受け取る

ローカルstateを削除し、共有periodとsetterをprops/context等で受け取る。

分析概要では1d/7d/30dを表示する。

### F. dataEndDate更新

ホームでoverview取得成功した時点で:

```js
setDataEndDate(overview.data_end_date)
```

または同等の状態更新を行う。

### G. Header / Sidebar / Bottom navigation

- home Header: `ダッシュボード`
- mobile home Header: ロゴではなく `ダッシュボード`
- Sidebar home sublabel: `状態と対応候補`
- Bottom navigation現在地: `aria-current="page"`

## 3. 再利用すべき既存ロジック

以下は変更せず再利用することを推奨。

### 治安指数

`src/ui/public-order-index.js`

- `derivePublicOrderIndex`
- `formatDirectNuisanceRate`
- `formatPublicOrderScore`

閾値をUI側で再定義しない。

### release cache

`release-client.js` のcacheを利用する。

ホームでoverviewロード済みなら、分析概要へ移動した際に同じoverviewを再ダウンロードする必要はない。

### 既存色・カード・focus表現

`App.jsx`, `index.css`, `tailwind.config.js` の既存トークンを優先して使う。

## 4. 推奨する表示ロジック

### index derivation

```js
const period = overview.periods[periodKey]
const index = derivePublicOrderIndex(
  period.counts.direct_nuisance,
  period.observation_count,
)
```

### rate marker

```js
const markerPosition = index.status === 'unavailable'
  ? null
  : Math.min(index.directNuisanceRate / 6, 1) * 100
```

既存OverviewScreenと同じ計算でよい。

### status comment

純粋関数として切り出すことを推奨する。

入力:

- `evaluation`
- formatter済み `rateLabel`

出力:

- 正本記載の固定文言

テストしやすく、LLMやランダム性は不要。

## 5. ホームの状態モデル

release session完了後:

```text
Dashboard
├─ manifest counts: always ready
└─ overview
   ├─ loading
   ├─ ready
   │  ├─ complete
   │  ├─ partial
   │  └─ unavailable (observation_count = 0)
   └─ error
```

`partial` と `unavailable` はHTTP/取得エラーではない。

## 6. ネットワーク期待値

初回起動時:

```text
1. optimicom-ui-release.json
2. overview artifact
```

ホームに留まっている限り、これ以外のartifact取得は不要。

その後:

- 分析概要 → cache済みoverviewを再利用可能
- コメント一覧 → commentsを初回取得
- フィルター候補 → keywordsを初回取得
- ブロック候補 → accountsを初回取得

## 7. 実装中に変更してはいけないこと

- `derivePublicOrderIndex` の算式
- formatterの境界維持ロジック
- release manifest / artifact validation schema
- keywords/accountsの候補定義
- 既存ローカルコピー/ブロックマーク状態の意味

## 8. ビルド・テスト

参照snapshotの `package.json` では:

```bash
npm test
npm run build
```

が利用可能。

bundle内snapshotは議論用の選択ファイルであり、単独ビルドに必要な全ファイル一式ではない。実際のリポジトリ上で実行すること。
