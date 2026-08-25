# 実装Handoff — ラベリングを含む候補キーワード生成フロー

## 目的

このhandoffは、以下のMVPフローを既存実装へ最小差分で接続するための実装契約です。

```text
raw-dataを人間が手動準備
→ ChatGPTがラベル付け
→ ChatGPTがキーワード候補選定
→ ローカル実装で公開処理
```

内部では、ChatGPTは**意味判断**のみを担当し、exact/reference reuse、決定的分類、行/hash拘束、dataset組立、品質検証、publication gate、candidate評価・公開はローカル実装が担当します。

## 最初に読む順序

1. `IMPLEMENTATION_SPEC.md`
2. `PATCH_MAP.md`
3. `ACCEPTANCE_TESTS.md`
4. `RUNBOOK.md`
5. `DECISIONS_AND_NON_GOALS.md`
6. `UPDATED_ISSUE_BODY.md`
7. 必要に応じて `reference/current_snapshot/`

## 実装の中心

変更は次の4点に限定します。

1. Integrated Labeling `prepare-stage13`
   - Stage13 batch-local context生成
   - batch-local adjudication CSV template生成
   - stale batch handoff artifactを残さない再生成
2. Integrated Labeling `finalize-stage13`
   - `--adjudications-dir` 追加
   - 複数batch回答を既存finalizerへ安全に統合
3. `THREE_CLASS_REVIEW_PROMPT.md`
   - ChatGPT返却を既存 `record_key,label,note` CSV契約へ合わせる
4. Candidate `prepare-handoff`
   - `--labeling-summary` / `--labeling-validation`
   - upstream labeling evidenceをfail-closedで検証
   - 検証済みfinal dataset SHAをcandidate requestへ使用

## 変更しないもの

candidate request/proposal schema v1、11-file handoff、full-update、publication contract、Stage13/3-Class分類ルール、P0/P1/P2 semanticsは変更しません。ChatGPT/OpenAI API integrationもこのIssueには含めません。

## 完了判定

`ACCEPTANCE_TESTS.md` の必須ケースが通り、既存candidate workflowに新規regressionがないこと。添付スナップショットではcandidate testに既知の欠損fixture由来failureが1件あるため、`BASELINE.md` を参照してください。
