# Y2K UI 議論セット収録一覧

## Purpose

`20260910-y2k-ui` の議論で、現行UIの構造・表示責務・データ境界・既存の操作仕様を参照できる状態にする。

## 収録方針

- root直下の `ISSUE_BODY.md` は、指定されたIssue本文の現在内容を収録する。
- `sources/` 以下は、現在の作業ツリーから取得した現行実装と、その直接の表示データ・UI関連テストを収録する。
- UIで直接参照するJSONだけを表示データとして収録し、未使用の生成物・中間成果物は収録しない。
- 補足文書は `docs/active` 内の現行Issue本文に限定する。
- `docs/archive`、`package/docs`、レガシー資料・レガシー名称を持つファイルは収録しない。

## 収録ファイル

### Issue

- `ISSUE_BODY.md`

### 現行UI実装

- `sources/package/index.html`
- `sources/package/package.json`
- `sources/package/vite.config.js`
- `sources/package/src/main.jsx`
- `sources/package/src/ui/App.jsx`
- `sources/package/src/ui/styles.css`
- `sources/package/src/ui/candidate-data.js`
- `sources/package/src/ui/candidate-data-adapter.js`
- `sources/package/src/ui/new-badge.js`

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

### docs/active の現行Issue本文

- `sources/docs/active/issues/20260824-065153-candidate-keyword-update-flow/ISSUE_BODY.md`
- `sources/docs/active/issues/20260827-054534-account-block-candidate-list/ISSUE_BODY.md`
- `sources/docs/active/issues/20260909-db-three-class-keyword-candidate-handoff/ISSUE_BODY.md`
- `sources/docs/active/issues/20260909-three-class-final-comment-db-label-sync/ISSUE_BODY.md`

## スナップショット注記

- ソースファイルは議論セット作成時点の作業ツリーからコピーする。
- リポジトリ内の既存未コミット変更は変更せず、その時点の内容を収録する。
