# Implementation Contract — Y2K UI適用

## 1. 目的

既存UIの情報設計・データ・判定ロジックを維持したまま、`y2k-ui-lib` の公式component visualに可能な限り寄せる。

今回のY2K表現は、公式componentの共通文法である「太いoutline、フラットなパステルsurface、小さめradius、明確なhover/focus/active」を基準とする。独自のchrome/glass/neon系表現は採用しない。

## 2. Scope

対象:

- `src/ui/App.jsx`
- `src/ui/styles.css`
- `src/ui/globals.css`
- `src/components/ui/*`
- `src/lib/utils.js`
- `vite.config.js`
- `package.json`
- 新規 `package-lock.json`
- 新規 `components.json`
- 新規 `jsconfig.json`

原則非対象:

- `src/data/*`
- `src/ui/candidate-data.js`
- `src/ui/candidate-data-adapter.js`
- `src/ui/new-badge.js`
- 候補抽出・分類・NEW判定のロジック
- architecture testの既存欠損ディレクトリ問題

## 3. 現在のスナップショット状態

現状には `src/components/ui/button.jsx`, `badge.jsx`, `card.jsx`, `progress.jsx` と `src/lib/utils.js` が既に存在するが、これらは公式registry componentの完全な導入状態ではない。

特に `src/lib/utils.js` は単純な文字列joinであり、公式が使う `clsx + tailwind-merge` と異なる。既存の部分実装を完成扱いしないこと。

`src/ui/App.jsx` は独自classベースのButton/Badge/summary/progress/toast/detail toggleを使用している。今回の実装では公式componentのcompositionへ置換する。

## 4. 導入方式

### 採択

- `y2k-ui-lib` は `0.0.3` にexact pinする。
- `components.json` をVite/JavaScript向けに先に配置する。
- `jsconfig.json` とVite aliasを先に設定する。
- 公式Y2K registryのcomponent取得は、設定済みregistryを使って `shadcn` から行う。
- `package-lock.json` を生成してcommitする。

### 不採択

- `npx y2k-ui-lib@latest init`
- `latest` に依存する手順
- CLIにVite/JS向け構成を自動推測させること
- Next.js/RSC前提の `app/globals.css`, `rsc:true`, `tsx:true` を生成させること

### 理由

`y2k-ui-lib` 0.0.3 のCLIは初回setupで `app/globals.css`, `lib/utils.ts`, `rsc:true`, `tsx:true` を既定生成する。現行はVite + JavaScript構成なので、その自動setupを採用しない。

またCLIはcore dependency確認時に `@tailwindcss/postcss` も対象とするが、本プロジェクトは `@tailwindcss/vite` を利用している。不要なsetup副作用を避け、registryはshadcnから直接取得する。

## 5. 設定ファイル

`implementation/components.json` と `implementation/jsconfig.json` をそのままプロジェクトrootへ配置する。

`vite.config.js` には `@` が `./src` を解決するaliasを追加する。既存の `plugins` と `base` は維持する。

意図する形:

```js
import { fileURLToPath, URL } from "node:url";

resolve: {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  },
},
```

## 6. 取得する公式component

必要なcomponentだけを追加する。

- button
- badge
- card
- tabs
- checkbox
- label
- collapsible
- progress
- sonner
- empty
- toggle
- toggle-group

想定コマンド:

```sh
npx shadcn add \
  @y2k/button \
  @y2k/badge \
  @y2k/card \
  @y2k/tabs \
  @y2k/checkbox \
  @y2k/label \
  @y2k/collapsible \
  @y2k/progress \
  @y2k/sonner \
  @y2k/empty \
  @y2k/toggle \
  @y2k/toggle-group
```

registry出力が固定参照commitと異なる場合、`references/UPSTREAM_REFERENCE.md` の固定commitを優先する。

## 7. 公式componentに許可する変更

許可:

1. TypeScript -> JavaScript/JSXへの適合
2. import/pathのVite構成への適合
3. 公式の固定HEXを指定theme token utilityへ置換

原則禁止:

- DOM構造の独自変更
- spacingの独自再設計
- border幅の変更
- radius体系の変更
- hover/focus/active stateの削除
- animationの削除または追加演出への置換
- variant APIの独自再設計

## 8. Theme / 色

`inputs/globals.css` の内容を `src/ui/globals.css` の正とする。

Y2K色をFeature側へHEX直書きしない。`globals.css` 以外への新規色HEX追加は禁止。

公式component内の例:

- `#1b1b3a` -> `y2k-ink`
- blue -> `y2k-blue`
- pink -> `y2k-pink`
- lilac -> `y2k-lilac`
- mint -> `y2k-mint`
- lemon -> `y2k-lemon`
- gray panel -> `y2k-panel`

システムエラー/invalidはdomain色と混同せず `destructive` semantic tokenを使う。

詳細は `implementation/semantic-color-map.md` を参照。

## 9. `cn()`

`src/lib/utils.js` は `clsx + tailwind-merge` に置換する。

意図:

```js
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
```

公式componentの呼び出し側 `className` が既定utilityと競合しても、後段overrideが正しく解決される状態にする。

## 10. 画面構成

### 10.1 上段ビュー切替

3ビュー:

- フィルターキーワード
- ブロックアカウント
- コメントラベル集計

`Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` を使う。

これは「同一画面内の表示領域切替」なので `ToggleGroup` ではなくTabsとする。

### 10.2 Hero

各ビューのHeroは `Card` composition。

- `CardHeader`: eyebrow + h1
- `CardContent`: 説明文

偽の最小化/最大化/close buttonは置かない。Window Controlsは操作できない装飾になるため使用禁止。

### 10.3 Keyword filter

推奨度:

- `ToggleGroup type="single"`
- 値: `all`, `high`, `medium`, `optional`
- 表示: `すべて`, `高推奨`, `中推奨`, `任意`

内部の既存state値へ変換してよいが、既存filter結果を変えないこと。

単一選択解除によって空値になるイベントは無視し、常に1項目が選択された状態を維持する。

NEW:

- `Checkbox + Label`
- boolean filterとして推奨度ToggleGroupとは独立

### 10.4 Keyword candidate

1候補 = 1 `Card`。

Card内:

- 候補文字列
- recommendation `Badge`
- category `Badge`
- NEW時 `Badge`
- copy `Button`
- detail `Collapsible`

詳細内の既存情報を削除しない:

- direct hits
- reactive hits
- normal hits
- precision excluding reactive
- variants
- match type

`Item` は使用しない。公式Itemは短い選択行向けで、この情報密度ではoverrideが増えるため。

### 10.5 Account candidate

1候補 = 1 `Card`。

Card内:

- handle
- direct_nuisance count
- copy `Button`
- evidence `Collapsible`

根拠例の件数、日付、時刻、コメント本文を維持する。

### 10.6 Label summary

`Card + Badge + Progress` を使用。

CardHeader:

- 総件数
- snapshot ref

CardContent:

3分類を各1行:

- Badge
- count
- percentage
- Progress

分類色はsemantic color mapどおり。

### 10.7 Empty state

候補0件時は公式 `Empty` を使う。現行の自作 `.empty-state` visualは廃止する。

### 10.8 Copy toast

現行の `toast` state / timer / `.toast` CSSを削除し、公式 `Sonner` を使用する。

clipboard API -> document fallbackの既存処理は維持する。

成功時:

`「<value>」をコピーしました`

両方のcopy方式が失敗した場合だけerror toastを出す。errorは `destructive` semanticを使用する。

## 11. Responsive

確認viewport:

- 1280px
- 768px
- 320px

原則:

- document全体には横overflowを出さない。
- 上段3-view Tabsと4-option recommendation ToggleGroupは、狭幅で必要な場合のみ局所的horizontal scrollを許可する。
- 320pxで候補文字列、Badge、Buttonが重ならない。
- candidate action群は狭幅で縦積み可。
- detail metricsは320pxで1列。
- 長いhandle/keyword/commentはbox外へ突き抜けない。

## 12. CSS責務

`src/ui/styles.css` に残すのはグローバルresetと、公式componentでは表現しない業務固有layoutのみ。

削除対象の例:

- `.view-switcher__button*`
- `.recommendation-tab*`
- `.badge*`
- `.copy-button`
- `.detail-toggle*`
- `.label-summary__bar*`
- `.empty-state*` のvisual
- `.toast*`

Button/Badge/Card/Tabs/Checkbox/Collapsible/Progress/Empty/Sonnerのborder/background/radius/hover/focusを `styles.css` で再実装しない。

禁止visual:

- gradient
- glassmorphism
- neon glow
- 大きなdrop shadow
- chrome風独自装飾

## 13. Accessibility

最低条件:

- Tabsはkeyboardで切替可能
- ToggleGroupはkeyboard操作可能
- CheckboxはLabelで名称を持つ
- Collapsible triggerはopen stateを伝える
- Copy Buttonは対象が分かるaccessible nameを維持
- focus-visibleを消さない
- Progressに分類名が分かるaccessible labelを与える
- toastはSonnerの標準a11yを利用

## 14. テスト / 完了条件

ソーススナップショットで `npm test` は14件中11件成功・3件失敗。

既知failure:

1. `src/lib contains only the account compatibility shim`
2. `processing does not import outer layers or cross feature modules` (`src/processing` 不在)
3. `database and processing do not import collector-specific modules` (`src/database` 不在)

これらを今回のY2K Issueで直さない。ただし変更によってfailure数を増やさない。

必須:

- UI/data adapter/new-badge/smoke関連の既存成功テストを失敗させない
- `npm test` の新規failureなし
- dependency install後に `npm run build` 成功
- `validation/ACCEPTANCE_CHECKLIST.md` 全項目を満たす

## 15. Upstream freeze

公式visual/APIの比較基準:

`MuhamadZafarSyah/y2k-ui`

commit:

`d64a99e451cf67aa249d98dcc333cf1bf972cfcf`

実装中にupstreamやregistryが更新されても追従しない。更新追従は別Issue。

## 16. Scope guard

実装中に「ついで」のリファクタリングを行わない。

禁止例:

- candidate-data adapterの再設計
- JSON schema変更
- NEW判定仕様変更
- wordingの意味変更
- architecture test修復
- visual regression infrastructureの新規導入

公式componentで不足する場合は、まずcompositionで解決する。仕様外の独自componentを新設する前に別Issue化する。
