# Y2K UI Implementation Handoff

このパッケージは、Issue「UIに『Y2K UI』を適用する」の実装作業者向けhandoffです。

## まず読むもの

1. `ISSUE_BODY.md` — **唯一のnormative specification（正本）**
2. `IMPLEMENTATION_HANDOFF.md` — 現行コードに対する変更箇所と実装境界
3. `VERIFICATION_CHECKLIST.md` — 実装完了時の検証とPR証跡
4. `reference/current-ui-snapshot/` — 議論時点の参照用ソーススナップショット

## 重要

- 実装対象は `src/ui/styles.css` と `src/ui/App.jsx` のみ。
- `App.jsx` はフィルターボタンへvisual styling用semantic classを追加する変更だけ許可。
- DOM構造、文言、状態管理、イベント処理、データ、adapter、JSON、機能仕様は変更しない。
- `ISSUE_BODY.md` と他資料が矛盾する場合は `ISSUE_BODY.md` を優先する。
- `reference/current-ui-snapshot/` は完全なrepository checkoutではない。実装・最終test/buildは実リポジトリで行う。

## 完了条件の要約

明るいAqua / desktop系Y2K visual systemを、既存の情報設計と操作性を維持したままUI全体へ適用する。意味色もY2K paletteへ変更し、keyboard focus、reduced motion、320px responsiveを含めて検証する。
