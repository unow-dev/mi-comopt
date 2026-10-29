# Issue #2 実装 handoff — 手動での個別分類修正経路

- 対象: `unow-dev/mi-comopt` / [Issue #2](https://github.com/unow-dev/mi-comopt/issues/2)
- 作成日: 2026-10-29 (JST)
- 対象実装: `package/` の comment DB v3 / Work Orchestrator / State Control Plane
- 区分: **レビュー修正版の実装指示・設計資料**（本体リポジトリへのパッチ・統合テスト結果ではない）
- 作業原則: **最小構成 / 既存機構再利用 / fail-closed / 既存 Version 不変**

## 最初に読む順序

1. `01_SCOPE_AND_DECISIONS.md` — 合意済み業務規則と対象外
2. `02_ARCHITECTURE_AND_CONTRACTS.md` — データモデル、境界、型、競合条件
3. `03_WORKFLOW_AND_WIRING.md` — WorkDefinition、Task I/O、下流接続
4. `04_IMPLEMENTATION_PLAN.md` — 具体的な実装順とファイル変更表
5. `05_ACCEPTANCE_AND_TESTS.md` — AC-01〜AC-08、必須テスト・証跡
6. `06_OPERATIONS_AND_HANDOFF.md` — 手動実行・production 制約・報告事項
7. `07_REPO_REFERENCES.md` — GitHub の参照先・基準コード・既知の落とし穴
8. `08_CRITICAL_REVIEW_AND_REPAIRS.md` — P0/P1レビュー指摘、修正規約、実装停止条件
9. `reference-implementation/` — 独立した純粋Domain参照実装と実行可能なテスト（本体未統合）

## 一文で表す到達点

分類済み observation を指定して**コメント文字列完全一致グループ**を訂正し、**修正理由と人間のレビューを伴う新 Classification Version** を確定させ、既存の Keyword Selection → Release → Production Promotion → Deployment / Identity Verification に接続する。

## 変更の骨子

- 新規 Domain 関数: `buildCorrectedClassificationState()`（純粋関数）
- 新規 Application Capability: `classification.correction.propose`（必ず review-required）
- 新規 WorkDefinition: `classification-correction`（revision 1 / schemaVersion 2）
- 再利用: `classification.finalize`、Control Plane の Proposal / Assessment / Decision / Version、既存 Keyword/Release/Promotion/Deployment サービス
- 追加 DB テーブル・独自 Stream・独自 Runtime: **不要**
- 予定新規ソース: `package/src/three-class/classification-correction.js`、`package/src/application/v3/correction-service.js`
- 予定新規テスト: `package/tests/v3-classification-correction.test.js`

## 絶対に変更してはいけない意味論

- `worseThreeClassLabel()` の「悪い方のラベルを選ぶ」通常分類ルールを、新旧 Version の Last Write Wins に置き換えない。
- 手動訂正の優先は **承認された新 Classification Version に全対象ラベルを反映し、以後の通常分類がその pinned Version を継承すること**で実現する。
- 既存 `ClassificationVersion` のラベルを UPDATE しない。通常分類の既分類 handoff 排除ガードを緩めない。
- 訂正 Proposal はシステム自動 commit しない。必ず human review を通す。

## 受け渡し状態

この ZIP に **本体リポジトリのソース修正・統合済み機能・production検証結果は含まれない**。純粋Domain処理の独立した参照実装・テストと、検出した設計上のP0欠陥に対する修正指示を含む。`node --test reference-implementation/*.test.mjs` で参照実装のみ確認可能。作業者は現行HEADとの差分を確認して本体へ組み込む。公開系の副作用は明示的な運用承認なしに実行しない。Issueの完了判定は `05_ACCEPTANCE_AND_TESTS.md` に従う。
