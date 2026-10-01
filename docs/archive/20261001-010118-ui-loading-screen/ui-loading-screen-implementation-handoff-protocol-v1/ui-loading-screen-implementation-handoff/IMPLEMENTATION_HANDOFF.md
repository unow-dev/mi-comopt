# 実装設計

## 目的

release root および各 artifact の実データ待機中に、`reference/design-master/` を正本とする full-screen loading experience を表示する。

loading 表示の導入によって、既存のデータ取得・cache・error・retry・toast・navigation の意味を変更しない。

## 不変仕様

- release root の取得待機中は、デザイン正本に基づく loading 画面を表示する。
- overview / comments / keywords / accounts の artifact が未取得で、取得完了を待つ必要がある間は、同じ loading experience を表示する。
- 既に利用可能な artifact cache がある再訪では、不要な待機状態を作らず内容を表示する。
- artifact の取得失敗時は loading を終了し、既存の artifact error flow を表示する。
- artifact の明示的な retry を開始した場合は、再取得中であることを loading 画面として表現する。
- release root の取得失敗時は既存の release error flow を維持する。
- 画面移動または同じ navigation 操作だけを理由に、明示されていない retry を発生させない。
- 同一 artifact の既存 in-flight request が存在する場合、新たな同一 request を重複発行しない。
- loading view の mount / unmount を request cancellation の意味にしない。既存の cache / in-flight semantics を維持する。
- loading 中は、Sidebar、Header、通常 content、mobile navigation 等の通常 UI を利用可能・操作可能な状態として露出しない。
- 既存 system toast は loading 中も表示可能であり、既存の表示時間・通知意味を変更しない。
- loading 画面の視覚表現、文字、animation、responsive behavior はデザイン正本の意味を維持する。
- loading 状態は assistive technology から「読み込み中」と認識できる。
- 装飾要素および視覚専用ラベルを重複して読み上げさせない。
- reduced-motion 環境では、正本で停止対象となっている animation を停止する。
- loading UI の導入を理由として通常画面の styling や application-global styling を変更しない。
- artificial minimum loading time、progress、timeout、cancel 操作など、Issue にない新しい loading semantics を追加しない。

## 完了条件

### release root

- release root が pending の初回表示で full-screen loading が表示され、通常 UI は利用可能な状態で露出しない。
- release root が成功すると artificial delay なしに通常画面へ遷移する。
- release root が失敗すると loader が残留せず、既存 release error flow が表示される。

### artifact cold load / cache hit

- cache miss の artifact を開くと、古い画面内容や error を先に表示せず loading experience を表示する。
- artifact が成功すると対象画面へ遷移する。
- cache 済み artifact を再訪した場合、loading の視覚的な点滅を挟まず対象画面を表示する。
- cache hit によって追加 HTTP request が発生しない。

### failure / retry

- artifact request が失敗すると loader が終了し、既存 ErrorState 相当の error flow が表示される。
- 明示的 retry の開始後は再取得待機中の loading が表示され、再取得が行われる。
- error 後に別 artifact へ移動して再訪した場合、以前の stale ErrorState を再訪時の初期表示として持ち越さない。
- 現在選択中の artifact 画面を再選択するだけでは暗黙 retry が発生しない。

### in-flight navigation

- artifact A の取得中に別画面へ移動しても A の request は既存 semantics に従って継続する。
- A が離脱中に成功した場合、再訪時は cache から即表示する。
- A がまだ pending の状態で再訪した場合、既存 in-flight request を共有する。
- A が離脱中に失敗した場合、再訪時に以前の component-local error state を stale 表示しない。

### toast / visual / accessibility

- loading 中でも既存 system toast が表示可能である。
- toast timer、通知内容、既存 styling の意味を変更しない。
- desktop と narrow viewport の双方で正本の layout / responsive behavior を維持し、意図しない横スクロールを発生させない。
- accessible loading status が成立する。
- decorative content が不要に読み上げられない。
- reduced-motion behavior が成立する。

### verification

- `reference/design-master/` の正本検証が成功する。
- 実リポジトリで既存 test suite と production build が成功する。
- データ取得層の既存 cache hit、cache miss、in-flight dedupe の契約が壊れていないことを確認する。

## 確定設計

### 1. Loading view と通常 application view の境界

loading view と通常 application view は、利用者に同時に通常操作可能な画面として提示しない。

release root または現在の artifact が実際に待機状態である間は loading view を選択し、Sidebar、Header、通常 content、mobile navigation などの通常 UI を操作可能な状態として残さない。

system toast はこの view 切替とは別の application-level UI として扱い、loading view と通常 view のどちらでも表示可能にする。

### 2. デザイン正本との境界

loading 画面は `reference/design-master/` を source of truth とする。

アプリ実装では、正本の以下の外部結果を維持する。

- 視覚結果
- 表示文言
- animation と timing の意味
- responsive behavior
- loading status の accessibility semantics
- decorative content の非読み上げ
- reduced-motion behavior
- 正本 asset / design token の意味

一方、正本の standalone document 用 global rule を application-global rule としてそのまま適用しない。loading 表現に必要な styling は loading view の責務範囲へ閉じ込め、通常 UI へ副作用を広げない。

DOM shape、React component 境界、selector 名、ファイル分割は、それ自体を設計契約にはしない。

### 3. Cache と UI state の境界

cache と in-flight request の所有者はデータ取得層とする。

UI はデータ取得層の内部 `Map` 等を直接操作せず、現在の artifact が初回 render 時点で同期的に利用可能かを判断できる契約を介して状態を決める。

この境界により、外部挙動として次を成立させる。

- cache hit: 初期表示から ready として扱える
- cache miss: 初期表示から waiting として扱える
- 非同期結果: ready または error へ遷移する

同期可用性契約の API 名や返却形状は実装仮説であり、既存コードに適合する形へ変更してよい。

### 4. Request lifecycle

同一 artifact の request dedupe はデータ取得層で一貫して担う。

UI 側に、データ取得層と競合する別系統の request dedupe / ownership mechanism を作らない。

component の unmount は request cancellation を意味しない。既存 request の完了結果は既存 cache semantics に従って扱い、後の再訪で利用可能なら再利用する。

### 5. Artifact ごとの一時 state

artifact の一時 UI state は artifact identity にスコープする。

異なる artifact へ移動した後、以前の artifact の component-local loading / error state を新しい artifact または後の再訪へ stale state として持ち越さない。

一方、同一 artifact が選択されたままの navigation 操作自体は retry の意味を持たない。retry は既存の明示的 retry 操作から開始する。

### 6. 変更範囲

今回の変更は loading experience と、それを正しく成立させるために必要な UI / data-client 間の最小責務境界に限定する。

routing、cache invalidation、request timeout、request cancellation、error UI redesign、汎用 loading framework 化など、Issue の目的とは独立した変更を同時に進めない。

## 実装仮説

以下は有力な探索開始点であり、上記の不変仕様・完了条件・確定設計を維持できるなら、実コード上の具体的事実に応じて変更してよい。

- `LoadingScreen` 相当の専用 component を作り、design master の HTML / CSS / asset を差分追跡しやすい形で移植する。
- loader 用 CSS と token を専用領域へ置き、正本の `*`、`html`、`body` 等の standalone document 用 global selector は導入しない。
- emblem は design master の asset をそのまま利用する。
- release client に同期 cache-read API を追加する。`getCachedArtifact(key)` のような形が候補。
- artifact hook は同期 cache-read を lazy initializer から参照する形が候補。
- cache hit 後に effect 冒頭で無条件に `loading` を再設定しない。
- retry は既存 hook instance から明示的に再取得を開始する。attempt counter 等は候補の一つ。
- 現在表示中の artifact だけが artifact-specific UI state を所有する route/component 境界を設ける方法が候補。
- artifact identity の変更時に local state を切るため、React の `key` による remount を使う方法が候補。
- 通常 UI を `AppShell` 相当へまとめ、system toast を view selection の外側に残す方法が候補。
- 現在の `src/ui/loading/` 相当へ loader 関連ファイルをまとめる構成が候補。
- 現状の stack だけで成立すると見込まれるため、新規 dependency を増やさない実装を第一候補とする。

## 実装判断に必要な決定的事実

同梱 `reference/current-code/` では次を確認している。

- `loadArtifact()` は cache hit を再利用する。
- 同一 artifact の in-flight request は既存の `loading` Map で共有される。
- success / failure 後に in-flight entry は削除される。
- 現行 artifact hook は effect 開始後に loading へ遷移するため、そのままでは cache hit 再訪でも loader flash を作り得る。
- 複数 artifact hook が常設されているため、component-local error state のスコープを artifact identity と明示的に揃える必要がある。
- toast は timer で消えるため、loading view 切替によって toast 表示機会を失わせない境界が必要である。
- React StrictMode が有効であるため、request dedupe は component effect 回数ではなくデータ取得層の契約として維持する必要がある。

`reference/current-code/` は discussion-set snapshot であり、実装時は実リポジトリの最新コード事実を優先する。ただし最新コード事実が確定設計と衝突する場合、実装側だけで設計を変更せず差し戻す。
