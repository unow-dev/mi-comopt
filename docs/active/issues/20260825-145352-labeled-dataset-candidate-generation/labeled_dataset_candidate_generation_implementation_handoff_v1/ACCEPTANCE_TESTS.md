# Acceptance Criteria / Tests

## Product-level Acceptance Criteria

### AC1 — rawからChatGPT semantic labelingへ接続できる

5-field raw JSONからStage13 pending reviewを生成し、ChatGPTが既存Stage13 adjudication契約へ回答できること。

### AC2 — 3-Class mandatory reviewをChatGPTへ接続できる

Stage13確定後の3-Class review queueに対し、ChatGPTが既存 `record_key,label,note` CSVへ回答でき、最終 `three_class_labeled.json` を生成できること。

### AC3 — mandatory labeling未完了ではcandidate handoffを生成しない

最低限:

```text
summary.final_published == true
summary.unresolved_mandatory_reviews == 0
validation.all_checks_passed == true
validation.checks.three_class_mandatory_reviews_resolved == true
validation.three_class_audit.unresolved_mandatory == 0
```

を要求すること。

P2 unresolvedは現行仕様どおりpublicationを阻害しない。

### AC4 — labeling lineage/evidenceをfail-closedで照合する

```text
summary.input_sha256 == validation.sha256.stage13
```

かつ:

```text
actual final dataset byte SHA
== summary.final_output_sha256
== validation.sha256.three_class
```

であること。

### AC5 — candidate source SHAは検証済みupstream identityを使用

evidence modeの `candidate_generation_request.source_dataset.artifact_sha256` は、AC4で検証されたSHAから導出されること。

### AC6 — 既存candidate contractを変更しない

- candidate-generation-request v1。
- candidate-proposal v1。
- 11-file handoff。
- full-update。
- publication contract。

を維持すること。

### AC7 — semantic review 0件を正常処理できる

Stage13または3-Classでレビュー対象が0件の場合、ChatGPT工程のみskipし、local finalization/validationを通常経路で完了できること。

---

## 必須自動テスト

### Integrated Labeling

1. `prepare-stage13` が各batchのJSON/context/adjudication templateを生成する。
2. contextがbatch中handleだけを含み、global contextと意味的に一致する。
3. prepare再実行で旧batch artifactが残らない。
4. `--adjudications-dir` で複数batch回答をfinalizeできる。
5. expected batch response不足をreject。
6. unknown batch responseをreject。
7. duplicate source indexをreject。
8. source SHA mismatchをreject。
9. pending coverage不足をreject。
10. directory modeの空noteをreject。
11. 既存 `--adjudications FILE` modeがregressionしない。
12. pending 0件でsingle-file header-only adjudicationによりfinalizeできる。

### Candidate

13. valid summary + validation + datasetでhandoff生成成功。
14. labeling evidenceが片方だけならreject。
15. pipeline version不一致をreject。
16. `final_published=false` をreject。
17. mandatory unresolvedをreject。
18. `all_checks_passed=false` をreject。
19. `three_class_mandatory_reviews_resolved != true` をreject。
20. summary/validation Stage13 SHA mismatchをreject。
21. summary/validation/final dataset SHA mismatchをreject。
22. evidence modeで不一致 `--source-sha` をreject。
23. evidenceなし既存 `prepare-handoff` がregressionしない。
24. 新handoffが既存 `full-update` でpublicationできる。

---

## Definition of Done

- 上記ACを満たす。
- Integrated Labeling既存test suiteに新規failureなし。
- Candidate既存test suiteに今回変更起因の新規failureなし。
- `BASELINE.md` に記載のdiscussion ZIP固有fixture欠損を勝手に修復・test緩和しない。
- runbookで `raw → ChatGPT labeling → ChatGPT candidate proposal → local publication` を再現できる。
