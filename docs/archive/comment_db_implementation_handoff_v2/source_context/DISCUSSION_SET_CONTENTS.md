# データ更新フロー議論セット収録一覧

## 目的

ISSUE_BODY.md の議論を詰めるため、現行の raw 取込、Comment DB、3分類、候補更新、公開用 release、UI、CI に関係する実装・契約・検証ファイルを、作成時点の作業ツリーから集約する。

## 読み始める順序

1. ISSUE_BODY.md — 議論対象。
2. sources/docs/active/issues/20260913-filter-keyword-account-candidate-update/ — 現行の更新タスク列とシーケンス。
3. sources/package/src/database/、sources/package/db/、sources/package/scripts/comment-database.mjs — Comment DB の保存境界と CLI。
4. sources/docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/ の契約・処理 — raw から3分類までの現行経路。
5. sources/package/src/processing/ と sources/package/scripts/ — 候補更新、DB反映、公開 release の生成・検証。
6. sources/package/src/ui/、sources/package/vite.config.js、sources/.github/workflows/deploy-pages.yml — UI の読み込み、build、デプロイ。

## 収録範囲

- sources/package/ は、現行の入力契約、Comment DB、マイグレーション、3分類 workset、候補生成・反映、Optimicom UI release、UI、検証テスト、build 設定を収録する。
- sources/docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/ は、現行 v1.5.0 の処理本体、契約、policy、prompt、template、テストを収録する。大規模な参照 snapshot や adjudication registry は含めない。
- sources/docs/active/temp/optimicom-react-tailwind/ は、現行 UI の release root とその運用 README のみを収録する。release root が指すコメント等の生成 artifact は含めない。
- sources/docs/active/issues/20260913-filter-keyword-account-candidate-update/ は、今回の議論に直接関係する現行タスク列とシーケンスだけを収録する。

## 意図的な除外

- docs/active 外の文書、docs/archive、package/docs は収録していない。
- 旧版、legacy、deprecated と判定できる資料・実装・互換 shim は収録していない。
- raw 入力、Comment DB 実データ、候補 publication の生成物、個別コメントを含む公開 artifact、dist、依存パッケージ、Python bytecode は収録していない。
- 旧静的データ読み込み境界と、その専用テストは収録していない。

## スナップショット注記

- sources/ のファイルは議論セット作成時点の作業ツリーからコピーした。
- 既存の作業ツリー上のファイルは変更していない。生成物はこの zip の作成後に一時領域から破棄する。
