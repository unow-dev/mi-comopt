# 「彼女、お借りします。 inspired Web UI Kit」議論セット収録一覧

## 収録方針

- root直下の `ISSUE_BODY.md` は、議論対象のissue本文を収録する。
- `sources/` 以下は、現行UIの実装、UIコンポーネント、UIが直接参照する表示データ、関連するUIテスト、および適用対象のUIキットを収録する。
- `docs` 内の文書は `docs/active` 配下の現行資料だけを収録する。
- `docs/archive`、`package/docs`、レガシー資料、レガシー名称を持つファイルは収録しない。
- ソースファイルは議論セット作成時点の作業ツリーからコピーし、既存の作業ツリーは変更しない。

## 収録ファイル

### Issue

- `ISSUE_BODY.md`

### 適用対象のUIキット

- `sources/docs/active/temp/kanokari_web_ui_kit_expanded.html`

### 参考UIキット適用例

- `sources/docs/active/temp/block_account_ui_kit_applied.html`
- `sources/docs/active/temp/comment_label_summary_ui_kit_applied.html`
- `sources/docs/active/temp/filter_keyword_ui_kit_applied.html`

### 現行UI実装とビルド設定

- `sources/package/index.html`
- `sources/package/package.json`
- `sources/package-lock.json`
- `sources/package/vite.config.js`
- `sources/package/components.json`
- `sources/package/jsconfig.json`
- `sources/package/src/main.jsx`
- `sources/package/src/ui/App.jsx`
- `sources/package/src/ui/globals.css`
- `sources/package/src/ui/styles.css`
- `sources/package/src/ui/candidate-data.js`
- `sources/package/src/ui/candidate-data-adapter.js`
- `sources/package/src/ui/new-badge.js`
- `sources/package/src/lib/utils.js`

### 現行UIコンポーネント

- `sources/package/src/components/ui/badge.jsx`
- `sources/package/src/components/ui/button.jsx`
- `sources/package/src/components/ui/card.jsx`
- `sources/package/src/components/ui/checkbox.jsx`
- `sources/package/src/components/ui/collapsible.jsx`
- `sources/package/src/components/ui/empty.jsx`
- `sources/package/src/components/ui/label.jsx`
- `sources/package/src/components/ui/progress.jsx`
- `sources/package/src/components/ui/sonner.jsx`
- `sources/package/src/components/ui/tabs.jsx`
- `sources/package/src/components/ui/toggle-group.jsx`
- `sources/package/src/components/ui/toggle.jsx`

### UIが直接参照する表示データ

- `sources/package/src/data/filterKeywordCandidates.json`
- `sources/package/src/data/accountBlockCandidates.json`
- `sources/package/src/data/candidateWorkflowConfig.json`
- `sources/package/src/data/threeClassLabelSummary.json`

### UI関連テスト

- `sources/package/tests/architecture-boundaries.test.js`
- `sources/package/tests/candidate-data-adapter.test.js`
- `sources/package/tests/new-badge.test.js`
- `sources/package/tests/smoke.test.js`

### docs/activeの関連issue本文

- `sources/docs/active/issues/20260910-y2k-ui/ISSUE_BODY.md`
- `sources/docs/active/issues/20260824-065153-candidate-keyword-update-flow/ISSUE_BODY.md`
- `sources/docs/active/issues/20260827-054534-account-block-candidate-list/ISSUE_BODY.md`
- `sources/docs/active/issues/20260909-db-three-class-keyword-candidate-handoff/ISSUE_BODY.md`
- `sources/docs/active/issues/20260909-three-class-final-comment-db-label-sync/ISSUE_BODY.md`
