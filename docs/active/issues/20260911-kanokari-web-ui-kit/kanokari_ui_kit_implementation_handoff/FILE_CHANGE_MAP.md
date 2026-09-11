# ファイル変更マップ

以下のパスは実リポジトリのpackage root基準。`reference/discussion_set/sources/package/` はhandoff内の現行snapshot参照用。

## 必須変更

### `src/ui/App.jsx`

主変更箇所。

- Y2K/shadcn UI component importを撤去
- Sonner撤去
- fixed/hide header scroll logic撤去
- SPAの3view stateは維持
- Radix Tabs primitiveを装飾なしで利用するか、同等のaccessible tabsを最小実装
- reference DOM/class構造へ再構築
- recommendation/NEW filter state維持
- all keyword cards mount + hidden filteringへ変更
- singleton toast state/timer実装
- copy成功/失敗とcard-local copied state実装
- document.title同期
- keyword detail / account detail / label summaryを確定仕様へ変更
- 旧footer撤去（labelsはreference data-noteを使用）

### `src/ui/globals.css`

全面的に新デザイン基盤へ置換してよい。

- Tailwind/shadcn imports削除
- Y2K variables削除
- UI Kit tokens追加
- body/system font/background/dot overlay等

### `src/ui/styles.css`

適用済みHTML3画面のCSSを統合する。

推奨手順:

1. 3画面に共通するdeclarationsを共通selectorへ抽出
2. screen-specific declarationsを後段へ置く
3. reference数値を変更しない
4. 640 / 390 breakpointを保持
5. reduced-motion rule追加

抽象化のためのCSS値変更はしない。

### `index.html`

viewportへ`viewport-fit=cover`追加。初期titleは`フィルターキーワード候補`のままでよい。

### `vite.config.js`

UI側からTailwindを完全に外した後、repo-wideで不要なら`@tailwindcss/vite` import/pluginを削除。React pluginとbase/alias設定は維持。

### `package.json` / `package-lock.json`

必須:

- `y2k-ui-lib`削除
- `shadcn` / Tailwind関連はrepo-wide参照0なら削除
- 旧UI component削除により不要になった依存はrepo-wide参照0を確認して削除
- `radix-ui`はTabs primitive用に維持
- `clsx` / `tailwind-merge`は`src/lib/utils.js`を今回の目的だけで書き換えないため維持

想定削除候補（**実リポジトリ全体で参照0を確認してから**）:

- `@radix-ui/react-slot`
- `class-variance-authority`
- `lucide-react`
- `sonner`
- `@tailwindcss/vite`
- `tailwindcss`
- `tw-animate-css`
- `shadcn`

### `components.json`

新UIでshadcn/Y2K registry基盤を使わないため削除する。

## 期待される削除対象

現行snapshotでは以下はY2K/shadcn前提。新Appから参照0になったら削除する。

- `src/components/ui/badge.jsx`
- `src/components/ui/button.jsx`
- `src/components/ui/card.jsx`
- `src/components/ui/checkbox.jsx`
- `src/components/ui/collapsible.jsx`
- `src/components/ui/empty.jsx`
- `src/components/ui/label.jsx`
- `src/components/ui/progress.jsx`
- `src/components/ui/sonner.jsx`
- `src/components/ui/tabs.jsx`
- `src/components/ui/toggle-group.jsx`
- `src/components/ui/toggle.jsx`

実リポジトリに議論セット外のconsumerが存在した場合は、consumerを新基盤へ移行した上で削除する。consumerを壊したまま削除してはいけない。

## 原則変更しない

### `src/ui/candidate-data.js`
生成JSONをUIへ渡す唯一の入口というarchitecture boundaryを維持。

### `src/ui/candidate-data-adapter.js`
UI modelのshapeを今回のtheme変更理由で変えない。必要な表示情報はすでに含まれている。

### `src/ui/new-badge.js`
NEW判定ロジック/境界を維持。

### `src/data/*.json`
UIをreferenceへ合わせる目的でデータ内容を加工・削減しない。

### `src/lib/utils.js`
今回の依存cleanupのためだけに書き換えない。

### processing / database / collector / scripts
このissueのpresentation変更スコープ外。UIが必要とする既存data contractを変更しない。

## 旧Y2K issue

`docs/active/issues/20260910-y2k-ui/ISSUE_BODY.md` は今回のUI kit適用と要求が競合する。新UI merge時に「本issueでsupersedeされた」状態へし、active requirementとして併存させない。リポジトリ運用に応じてarchive/close処理する。
