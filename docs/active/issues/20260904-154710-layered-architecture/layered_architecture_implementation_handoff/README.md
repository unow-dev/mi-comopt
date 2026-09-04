# Layered Architecture Refactor — Implementation Handoff

このhandoffは、`レイヤーモデルによるアーキテクチャ整理` issueを実装作業者へ引き渡すための確定仕様です。

## 読む順序

1. `IMPLEMENTATION_HANDOFF.md` — 実装方針・最終構造・責務境界
2. `DECISIONS.md` — 採択済み分岐の決定記録
3. `FILE_CHANGE_MAP.md` — 既存ファイルから新配置への対応
4. `WORK_TASK_SEQUENCE.md` — 推奨作業順序
5. `ACCEPTANCE_CRITERIA.md` — 完了条件
6. `REVIEW_CHECKLIST.md` — レビュー時の確認項目
7. `ACCOUNT_GENERATOR_PROVENANCE_EXCEPTION.md` — account系だけ残す互換shimの理由
8. `BASELINE_TEST_STATUS.md` — supplied discussion set上のテスト基準
9. `SOURCE_FACTS.md` — 実コード照合で確認した事実
10. `source_context/ISSUE_BODY.md` — 元issue本文

## 一文での実装目標

責務を `processing` / `database` / `ui` に分離し、keyword handoffの意味ロジックをProcessingへ移し、UIではartifact schemaをUI modelへ変換する。一方、account generator provenanceを壊さないため `scripts/account-block-candidate-workflow.mjs` はbyte-for-byte変更せず、旧import pathにre-export shimを1つだけ残す。

## 重要な非目標

このissueではpure-core化、UUID生成方式変更、Comment DB API再設計、SQLite schema変更、artifact schema/hash変更、account generator provenance再設計、generated artifact再生成を行わない。
