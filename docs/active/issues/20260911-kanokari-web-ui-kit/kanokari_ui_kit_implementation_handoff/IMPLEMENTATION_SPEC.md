# 実装仕様

## 1. 目的と優先順位

既存React UI全体を、同梱された「彼女、お借りします。 inspired Web UI Kit」適用済み3画面の外観へ置換する。

優先順位は次の通り。

1. **現行機能の意味を維持する**
2. **適用済みHTMLの外観へ一致させる**
3. 実装内部の再利用・抽象化・既存Y2Kコンポーネントへの互換性

「機能保持」は現行DOMや操作手順の固定を意味しない。ユーザーが得られる情報・操作能力・結果の意味が保たれていれば、UI構造や操作位置は適用例へ合わせて変更してよい。

## 2. 参照実装

package rootから見て以下をvisual referenceとする。

- フィルターキーワード: `reference/discussion_set/sources/docs/active/temp/filter_keyword_ui_kit_applied.html`
- ブロックアカウント: `reference/discussion_set/sources/docs/active/temp/block_account_ui_kit_applied.html`
- コメントラベル集計: `reference/discussion_set/sources/docs/active/temp/comment_label_summary_ui_kit_applied.html`
- 未定義状態の補助: `reference/discussion_set/sources/docs/active/temp/kanokari_web_ui_kit_expanded.html`

参考HTMLのダミー詳細文・画面遷移デモは製品仕様ではない。視覚・レイアウト・interaction styleの正本として扱う。

## 3. アプリ全体

### 3.1 SPAを維持

- 現行どおり単一React SPAの3タブ構成を維持する。
- React Router等のroutingは導入しない。
- URL、history、hash/queryへのactive view同期も追加しない。
- タブはRadix Tabs primitiveのkeyboard/focus機能を利用してよい。既存Y2K装飾wrapperは再利用しない。

タブ名は必ず次の3つ。

1. `フィルターキーワード`
2. `ブロックアカウント`
3. `コメントラベル集計`

`filter_keyword_ui_kit_applied.html` にある `判定ログ` は採用しない。

### 3.2 document.title

active viewに合わせて変更する。

- keywords: `フィルターキーワード候補`
- accounts: `アカウントブロック候補`
- labels: `コメントラベル集計`

初期viewはkeywords。

### 3.3 タブの外観・配置

参考HTMLの `.top-tabs` / `.top-tab` を視覚上の正本とする。

- 通常フローに置く。
- fixed/stickyにしない。
- 現行のスクロール方向による自動hideを削除する。
- 640px以下では横スクロール可能。
- active tabは青gradient。

## 4. デザイン基盤

### 4.1 token

適用済みHTMLのtoken値をそのまま使う。別のTailwind/shadcn tokenへ意味変換しない。

```css
--navy:#1E2A56;
--blue:#4FC3F7;
--blue-strong:#29A9E8;
--cyan:#00C3D6;
--pink-soft:#FF8FB3;
--pink:#FF6B98;
--yellow:#FFC845;
--paper:#F8FAFF;
--mist:#EAF1F8;
--line:#D8E3F0;
--text:#20325E;
--muted:#7483A0;
--success:#2DBE89;
--danger:#F05A7E;
--shadow:0 14px 34px rgba(63,104,151,.16),0 2px 8px rgba(63,104,151,.10);
--shadow-soft:0 8px 20px rgba(63,104,151,.14);
```

フィルター適用例に定義されるradiusも共通tokenとして採用してよい。

```css
--radius-sm:10px;
--radius-md:16px;
--radius-lg:24px;
```

### 4.2 font/background

参考HTMLと同じsystem font stackを使う。外部Web fontを導入しない。

```css
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif;
```

body背景、dot overlay、gradient、shadow、backdrop blur等は適用済みHTMLから値を直接移植する。Tailwind utilityへ翻訳して近似しない。

### 4.3 共通骨格

3画面とも基本骨格は以下。

```text
.app-shell
  .top-tabs
  .page-card
    .hero
    .intro
    .content
```

通常幅は参考HTMLどおり `width:min(920px,calc(100% - 28px))`、`margin:20px auto 48px`。

### 4.4 responsive

参考HTMLのbreakpointをそのまま採用する。

- `max-width: 640px`
- `max-width: 390px`（keyword/account cardのみ）

旧920px/600px breakpointは新UIの基準として残さない。

640px以下:

- `.app-shell{width:min(100% - 16px,620px);margin:8px auto 28px}`
- top tabs横スクロール
- `.top-tab` は `min-width:148px`, `min-height:44px`
- page-card radius 22px
- hero / intro / content / card padding等は各referenceをそのまま移植

390px以下:

- keyword/account headを1カラム化
- copy buttonを左寄せで次段へ送る

境界破綻確認用に641pxと391pxも確認する。

### 4.5 reduced motion

本番CSSに以下相当を入れる。

```css
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;transition:none!important}
}
```

### 4.6 viewport

`index.html` のviewportを以下相当にする。

```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
```

## 5. フィルターキーワード画面

### 5.1 reference

通常状態は `filter_keyword_ui_kit_applied.html` を正本とする。

hero/intro文言は参考HTMLと現行Reactの内容が一致しているため、そのまま使用する。

### 5.2 データ

- `candidate-data.js` / adapter経由の全候補を表示対象とする。
- handoff snapshotでは86件。
- 参考HTMLの4件に切り詰めない。
- pagination / virtualization / infinite scrollを新設しない。
- source arrayの順序を維持する。

### 5.3 filtering

推奨度filterは必ずexactly one active。

- `all` → すべて
- `high` → 高推奨
- `medium` → 中推奨
- `optional` → 任意

active pillを再クリックして「選択なし」にしてはいけない。初期値は`all`。

`NEWのみ` はnative checkboxでよい。推奨度filterとAND条件。

**カードはfilter時にReact treeからunmountしない。** 全件をmountした状態で対象外カードを`hidden`等で非表示にする。これにより、filterで一時的に隠れたカードのdetail/copy local stateを保持する。

表示件数0の場合のみempty stateを表示する。文言は:

`条件に一致する候補はありません。`

旧文言の「検索語または…」は使わない。

### 5.4 NEW

- `workflowConfig.newKeywordDisplayDays`（現状14日）と`isNewCandidate`を維持。
- `now`はApp/session mount時に1回取得し、session中固定する現行意味を維持。
- NEW用の更新timerを追加しない。
- reload時に再評価される。

### 5.5 recommendation / badge色

旧Y2K mappingを引き継がない。

Filter pill:

- all: blue
- high: green
- medium: yellow
- optional: pink

Candidate badge:

- 高推奨: `#2DBE89`
- 中推奨: `#FFC143`
- 任意: `#98A8BB`
- category: `#41B9EF`
- NEW: `#FF648F`

### 5.6 card/detail

card本体、keyword、badges、copy button、detail toggleはreference HTMLのDOM/class構造とCSSに極力合わせる。

詳細はダミー文章へ置換せず、現行情報を保持する。`.detail-panel` 内を`.detail-row` patternで次の順に表示する。

1. `direct（命中）` → `{directNuisanceHits}件`
2. `reactive（参考）` → `{reactiveHits}件`
3. `normal（誤爆）` → `{normalHits}件`
4. `精度（reactive除外）` → `precisionExcludingReactive`を1桁%表示（現行`formatPercent`相当）
5. `表記揺れ` → `variants`からkeyword自身を除いた残りを` / `区切りで表示。0件なら行ごと省略。
6. `マッチ方式` → `matchType`。値なしなら行ごと省略。

各カードのdetail open状態は独立。複数カードを同時に開ける。accordion化しない。

### 5.7 copy

Clipboard API → `document.execCommand("copy")` fallbackという現行機能を維持し、成功/失敗を判定する。

成功時:

- 押したbuttonだけ`コピー済み` + `.copied`
- 1300ms後に元へ戻す
- 他buttonのcopied状態とは独立
- toast: `「{keyword}」をコピーしました`

失敗時:

- buttonを`コピー済み`へ変更しない
- failure toast: `「{keyword}」をコピーできませんでした`

独立footerは削除する。

## 6. ブロックアカウント画面

### 6.1 reference/data

通常状態は `block_account_ui_kit_applied.html` を正本とする。

- 全アカウントを表示する。
- handoff snapshotでは54件。
- referenceの5件へ切り詰めない。
- source array順序を維持。
- pagination等は追加しない。

### 6.2 card/detail

card head、account name/meta、copy、detail toggleはreferenceに合わせる。

詳細の先頭3行は必ず:

1. `判定ラベル` → `direct_nuisance`
2. `該当コメント数` → `{directNuisanceCount}件`
3. `候補条件` → `2件以上`

その下に現行evidence機能を追加する。同じ`.detail-panel`内でUI Kitのline/typographyを使う。

- heading: `根拠例 {evidence.length}件`
- 各evidenceに`postedDate`、`postedAt`、`comment`全文
- commentはclampしない
- internal scroll boxに閉じ込めない
- `white-space:pre-wrap` / `overflow-wrap:anywhere`等で横破綻を防ぐ
- 長文に応じてpanel/pageが縦に伸びることを許容する

各detailは独立し、複数同時open可。

### 6.3 empty

0件時はfilter画面の`.empty` visual patternを流用し、文言:

`該当するアカウント候補はありません。`

### 6.4 copy

成功時:

- 対象buttonのみ`コピー済み` + `.copied`
- 1400ms後に元へ戻す
- toast: `{handle} をコピーしました`

失敗時:

- button状態は変更しない
- toast: `{handle} をコピーできませんでした`

独立footer「手動で判断してください」は削除する。自動ブロック機能を新設しない。

## 7. コメントラベル集計画面

### 7.1 reference

`comment_label_summary_ui_kit_applied.html` をほぼそのままReact化する。

- hero/intro
- summary panel
- blue summary header
- snapshot block
- 3 label cards
- progress line
- data note

旧Y2K Card/Progress/Badgeの見た目は残さない。

### 7.2 data/percentage

既存modelをそのまま使う。

- total: `summary.total`
- direct: `summary.counts.directNuisance`
- reactive: `summary.counts.reactive`
- normal: `summary.counts.normal`
- percentage: `summary.total > 0 ? count / summary.total * 100 : 0`
- 表示は小数1桁

0件時は`0.0%`。reference CSSの`min-width:3px`によって0%でも線が見える状態は避け、**0%のfillだけwidth 0**にする。

progressbarの`aria-valuenow`も実計算値へ合わせる。

### 7.3 data note

referenceのdata noteを採用し、旧footerを削除する。表示データのsourceは引き続き`src/data/threeClassLabelSummary.json`。

## 8. Toast

Sonner queueは使わない。アプリ全体で1つのsingleton toastを実装する。

- `role="status"`
- `aria-live="polite"`
- 通常toastの外観はreference `.toast`
- success背景: `#617ea2`
- failureは同じ寸法/位置/shapeで、背景を`var(--danger)`へ変更
- 表示時間: 1600ms
- 新しいtoast表示時は前のhide timerをclearして1600msを再スタート
- toastをstackしない

複数copy buttonの`コピー済み`状態は各buttonごとに独立する。toastだけ共有。

## 9. State lifetime

- active view: App-level
- recommendation filter: App-level。別タブへ移動して戻っても保持。
- NEW only: App-level。別タブへ移動して戻っても保持。
- keyword/account detail open: card-local。別タブへ移動してunmountされた後の復元は不要。
- copied状態: card/button-local。一時状態。永続化不要。
- toast: app-level singleton。
- reload: 初期状態 `keywords / all / NEW off`。localStorage等を導入しない。

同一keyword view内でfilterによりcardがhiddenになっただけの場合はcardをunmountしないため、そのcardのlocal stateを保持する。

## 10. Accessibility

見た目を変えない範囲で既存以上を維持する。

- Tabsのkeyboard/focus behaviorを維持
- `aria-selected`, 必要に応じ`aria-current="page"`
- filter pillは`aria-pressed`
- detail toggleは`aria-expanded`（必要なら`aria-controls`）
- unique idを使ってよい
- progressbar semanticsを維持
- toastのlive regionを維持

semantic enhancementを理由にreferenceとのレイアウト差を作らない。

## 11. Y2K / UI基盤の扱い

新UIを旧Y2KコンポーネントへCSS上書きして作らない。data/state logicを残し、presentation layerをreference HTML構造へ再構築する。

必須結果:

- runtime/configから`y2k-ui-lib`を撤去
- `@y2k` registry撤去
- `--y2k-*`, `bg-y2k-*`, `border-y2k-*`等のY2K参照を実行対象UIから0件にする
- Tailwind/shadcn/Y2Kのbase styleを`globals.css`から外す
- 旧Y2K `components/ui` wrapperは新Appから参照しない

共通化は外観一致を壊さない範囲だけ。`TopTabs`, `CopyButton`, `DetailToggle`, `Toast`程度は共有可。一方、KeywordCard / AccountCard / LabelCardを1つの「汎用Card」に無理に統合しない。

## 12. 許容されるreferenceとの差分

意図的差分として許可するのは以下だけ。

1. filter referenceの3番目tab `判定ログ` → 製品では`コメントラベル集計`
2. reference掲載件数を超える実データ全件表示によるページ高さ増加
3. keyword detailの実指標表示
4. account detailのevidence全文追加
5. 0% progressを本当に0幅にすること
6. copy failure/empty等、reference未定義状態を同じdesign languageで補完すること
7. SPAとして動くこと（referenceの一部はリンク/デモ）
8. accessibilityを保つための視覚非影響semantic差分

それ以外の「既存componentだから」「Reactだから」「Tailwindの近い値だから」という差は許容しない。
