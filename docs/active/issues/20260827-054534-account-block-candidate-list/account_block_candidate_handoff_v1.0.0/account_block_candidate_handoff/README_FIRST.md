# Account Block Candidate List — Implementation Handoff

## Status

仕様到達率: **100%**（実装作業者に任せられるレベルに閉じた状態）

このhandoffは、アカウントブロック候補リストissueについて、議論中の中間案を整理し、**最終採択された仕様だけ**を実装者向けにまとめた正本セットです。

> このzip内の `UPDATED_ISSUE_BODY.md`、`docs/ACCOUNT_BLOCK_CANDIDATE_CONTRACT.md`、`config/accountBlockCandidatePolicy.json` が、会話中の途中提案・撤回済み案より優先されます。途中の会話を実装仕様として参照しないでください。

## 最終仕様の一文要約

公開済み `three_class_labeled.json` から、**exact `handle` ごとに distinct な `direct_nuisance` behavior event が2件以上あるアカウント**を、手動レビュー用候補としてstatelessに生成する。UIではhandle、全direct件数、決定的に選んだ根拠例2件を表示し、handleをコピーできるようにする。自動ブロック、状態管理、危険度score、期間window、subtype推定は行わない。

## 読む順序

1. `UPDATED_ISSUE_BODY.md` — product scope / MVP / acceptance criteria
2. `docs/ACCOUNT_BLOCK_CANDIDATE_CONTRACT.md` — 実装上の正本契約
3. `config/accountBlockCandidatePolicy.json` — 現行policy値
4. `docs/IMPLEMENTATION_PLAN.md` — 実装順序と変更対象
5. `docs/TEST_MATRIX.md` — 必須fixture / test cases
6. `docs/PR_REVIEW_CHECKLIST.md` — PRレビュー・CI・release gate
7. `docs/DECISION_LOG.md` — 採択案と却下案の理由
8. `docs/BASELINE_NOTES.md` — 添付セットで確認できた既存構成と非契約情報

## 実装時の重要な禁止事項

- `username` をアカウントidentityやbehavior event identityに使わない。
- `handle` をtrim/lowercase/`@`除去などでnormalizationしない。
- `reactive` / `normal` を候補scoreや相殺評価に使わない。
- 30日/90日などの期間windowを入れない。
- `audit_three_class.json` やStage13 rawをaccount candidate generatorの入力にしない。
- browser/build時にraw 3-Class datasetから候補を生成しない。
- `[]` を「未生成」のplaceholderとしてcommitしない。正式generatorの結果が0件の場合だけ `[]` を許可する。
- 候補を「危険」「高推奨」等のscore/rankとして表示しない。
- evidence sampleを「最新」「代表」「最悪」と表現しない。

## データ前提

元のdiscussion setには、正式な `three_class_labeled.json` 本体は含まれていません。したがって、software implementation / fixture testsは直ちに進められますが、**実artifact生成とend-to-end publication確認には、対応するpublished `three_class_labeled.json` と `summary.json` が必要**です。

この不足はaccount candidate software実装のhard blockerではありません。feature PRをmergeする前のE2E gateです。
