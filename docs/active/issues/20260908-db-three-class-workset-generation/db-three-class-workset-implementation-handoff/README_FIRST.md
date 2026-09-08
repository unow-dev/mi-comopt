# Implementation Handoff: Comment DB → 3-class Workset

このZIPは、`Comment DBから3-class作業セットを直接生成する経路` の実装作業者向けhandoffである。

## 読む順序

1. `ISSUE_BODY_CANONICAL.md`
   - **唯一の規範仕様 (canonical implementation contract)**。
   - 実装・レビュー・受け入れ判定はこの文書を基準にする。
2. `IMPLEMENTATION_HANDOFF.md`
   - 現行コードに対する推奨変更箇所、処理順序、境界検証、実装順序。
   - canonical issueと矛盾する場合は `ISSUE_BODY_CANONICAL.md` を優先する。
3. `ACCEPTANCE_CHECKLIST.md`
   - 実装完了前に潰すべき確認項目。
4. `FINAL_DECISIONS.md`
   - 議論で採択された設計判断の要約。撤回済み案を実装しないための索引。
5. `reference/discussion-set/`
   - issue検討時点のソース断片。理由確認・実コード照合用。規範仕様ではない。

## 仕様優先順位

1. `ISSUE_BODY_CANONICAL.md`
2. 既存 v1.5.0 single-roundtrip の公開contract
3. 既存 Comment DB の公開contract
4. `FINAL_DECISIONS.md` / `IMPLEMENTATION_HANDOFF.md`
5. `reference/discussion-set/` と過去の議論内容
6. 実装上の都合

1 を満たすために 2 または 3 の意味変更が必要だと判明した場合、実装者判断で既存contractを変更しない。`IMPLEMENTATION_HANDOFF.md` の「設計へ戻る条件」に従う。

## 実装開始時の要点

- 新経路は **composition layer** であり、Stage13/Three-Class分類ロジックを再実装しない。
- `request/` が classification の canonical package。
- `provenance/` は lineage 確認専用。追加のclassification evidenceにしない。
- 既存 v1.5.0 workspaceを壊さず、既存 `finalize-single-roundtrip` をそのまま使える状態を維持する。
- `workset_id` と既存 `request_id` は別identity。
- 失敗時に指定された最終workspaceを残さない。

このhandoff作成時点で、設計は実装作業者へ渡せるレベルまで閉じている。
