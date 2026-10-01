# Design Classification

この文書は設計側の分類メタ情報であり、実装契約そのものは `IMPLEMENTATION_HANDOFF.md` を正とする。

## 1. 入力の分類

### 要求・非交渉制約

`reference/ISSUE_BODY.md` から直接成立する要求。

- UI のデータ読み込み中に、デザイン正本に基づく専用ローディング画面を表示する。
- 利用者が読み込み状態を把握できること。
- 待機中の体験をアプリのブランド表現と整合させること。
- 対象となる既存の読み込みは、release root と各画面の公開データ取得である。

### 設計制約

今回提供された Issue 本文には、DB・ライブラリ・ファイル構成・特定 API 名などを人間が固定した技術制約は明示されていない。

`reference/design-master/` は、Issue が指定したデザイン正本として扱う。したがって視覚・モーション・アクセシビリティ上の外部結果は正本に整合させる必要があるが、アプリ内部の DOM、React component 分割、hook 名、ファイル配置まで正本が固定するものではない。

### 設計案

前版 handoff に含まれていた次の内容は、有力な実装案ではあるが、人間固定事項ではない。

- `LoadingScreen` を props なし component にする。
- `src/ui/loading/` に専用ファイル群を配置する。
- `getCachedArtifact(key)` という同期 getter を追加する。
- `useArtifact` を lazy initializer で cache-aware にする。
- `ArtifactRoute` を設ける。
- `key={screen}` で artifact state を remount する。
- 通常 UI を `AppShell` にまとめる。
- toast を top-level view selection の外側へ置く。
- 正本 JSX/CSS をできるだけ機械的に移植する。
- 新規 dependency を追加しない。

これらは `IMPLEMENTATION_HANDOFF.md` の確定設計を満たす限り、実コード上の具体的事実に応じて変更してよい。

### 参考情報

`reference/current-code/` から得た事実。

- artifact cache は release session 内の `Map` で保持される。
- artifact in-flight request も `Map` で共有される。
- `loadArtifact()` は cache hit と in-flight hit を既に処理する。
- 現状の artifact hook は `idle` から開始し、effect 内で loading へ遷移する。
- artifact hook は複数画面分が常設されている。
- loading 表示は通常 shell 内のカード型 UI である。
- toast は通常 shell より高い z-index を持ち、timer で消える。
- React StrictMode が有効である。

これらは設計判断の根拠には使うが、参照スナップショット自体を実リポジトリの固定状態とはみなさない。

## 2. 設計判断の再分類

### 不変仕様へ残したもの

- 正本準拠の loading experience。
- release root と artifact の実データ待機を対象とすること。
- cache 済み artifact 再訪で不要な loading を発生させないこと。
- failure で loader が残留せず既存 error flow へ戻ること。
- retry、navigation、cache、in-flight request、toast など既存の意味を loading UI 導入の副作用で変えないこと。
- loading 中に通常 UI を利用可能な状態で露出しないこと。
- accessibility と reduced-motion の意味を正本に合わせること。
- 要求されていない timeout、progress、cancel 等の外部意味を追加しないこと。

### 確定設計へ残したもの

- loading view と通常 application view の排他的な表示境界。
- design master と application-global styling の責務境界。
- UI が初回 render 時点で artifact の同期利用可否を判断できる契約。
- cache / in-flight request の所有をデータ取得層へ集約する境界。
- component lifecycle と request lifecycle を同一視しないこと。
- artifact ごとの一時 UI state を artifact identity にスコープすること。
- system toast を loading view と通常 view の双方から利用可能に保つこと。

### 実装仮説へ下げたもの

- component 名、hook 名、getter 名。
- props の有無。
- JSX の span 個数や exact DOM shape。
- `key={screen}` による remount。
- `AppShell` / `ArtifactRoute` という component 分割。
- file path と local component 化。
- lazy initializer、attempt counter 等の hook 実装形状。
- Tailwind を使わず CSS をコピーするなどの局所的な実装手段。

## 3. 所有権

- Issue 本文に由来する要求と、Issue が指定したデザイン正本は人間側の固定事項として扱う。
- 今回の確定設計・完了条件は設計側の判断であり、実装中に具体的なコード事実と衝突した場合は、実装側で独自に変更せず設計へ差し戻す。
- 実装仮説は、確定設計と不変仕様を維持できる限り実装側で変更してよい。
