# 最新raw-dataからGitHub Pagesデプロイまでの更新運用: 議論セット

## このセットの目的

`ISSUE_BODY.md` の運用設計を議論するために、現在の実装、現在の公開artifact、およびそれらが参照する現行の運用契約を一箇所に集約する。

## 読み始める順序

1. `ISSUE_BODY.md` — 議論対象。
2. `sources/docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/RECURRING_UPDATE_WORK_TASK_SEQUENCE.md` — raw入力からラベリング、候補更新、公開確認までの既存運用。
3. `sources/package/ARCHITECTURE.md` と `sources/package/src/processing/` — 処理責務と生成・検証ロジック。
4. `sources/package/src/data/` — 現在GitHub Pages UIが取り込む公開artifactとprovenance。
5. `sources/.github/workflows/deploy-pages.yml` と `sources/package/vite.config.js` — ビルド／GitHub Pages公開設定。

## 収録範囲

- `sources/docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/` は、現行のraw-data統合・ラベリング工程を再現する実装、設定、契約、参照snapshot、テストを完全収録した。
- `sources/package/` は、候補キーワード・アカウント候補の生成、artifact検証、UI取り込み、現在の公開artifact、テスト、ビルド定義を収録した。
- `sources/runtime-contracts/` は、現行CLIと公開artifactが使用する候補生成policy／taxonomyおよびアカウント候補policyだけを、元のactive文書から内容を変えずに複製した。元の場所は次のとおり。
  - keyword evaluation policy: `docs/active/issues/20260824-065153-candidate-keyword-update-flow/candidate_keyword_update_handoff_v1.0.0/policy/evaluation/1.0.0.json`
  - keyword taxonomy: `docs/active/issues/20260824-065153-candidate-keyword-update-flow/candidate_keyword_update_handoff_v1.0.0/policy/taxonomy/1.0.0.json`
  - account candidate policy: `docs/active/issues/20260827-054534-account-block-candidate-list/account_block_candidate_handoff_v1.0.0/account_block_candidate_handoff/config/accountBlockCandidatePolicy.json`

## 意図的な除外

- `docs/archive` を含む `docs/active` 外の文書は一切収録していない。
- 過去のissue handoff、source snapshot、旧実装、生成済みbrowser build、依存パッケージ、およびraw-dataや更新runの作業成果物は収録していない。
- `package/src/lib/account-block-candidate-workflow.js` の互換shimは、現行の生成処理ではなく履歴provenance維持専用のため収録していない。現行の実装本体は `sources/package/src/processing/account-block-candidates/` にある。

## 現在の対応関係

```text
raw 5-field input
  -> Integrated_Labeling pipeline
  -> three_class dataset SHA
  -> keyword candidate workflow / account candidate workflow
  -> package/src/data の公開artifact
  -> React UI build (Vite)
  -> .github/workflows/deploy-pages.yml
  -> GitHub Pages
```

`sources/package/src/data/filterKeywordCandidates.meta.json` と
`sources/package/src/data/accountBlockCandidates.meta.json` は、いずれも上流three-class dataset SHAを記録する。更新運用を決める際は、両artifactのdataset SHAと各run manifestの整合性を確認する。
