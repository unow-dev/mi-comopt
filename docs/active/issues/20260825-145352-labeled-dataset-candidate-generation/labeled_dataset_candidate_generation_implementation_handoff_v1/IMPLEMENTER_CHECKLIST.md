# Implementer Checklist

## Before coding

- [ ] `README_FIRST.md` を読む。
- [ ] `IMPLEMENTATION_SPEC.md` を読む。
- [ ] `DECISIONS_AND_NON_GOALS.md` のscope guardを確認する。
- [ ] `BASELINE.md` の既知candidate test failureを確認する。

## Integrated Labeling

- [ ] `prepare-stage13` がbatch JSON/context/CSV templateを生成する。
- [ ] prepare再実行時にstale batch artifactsを残さない。
- [ ] ChatGPT response保存先をworkspaceのgenerated template directoryと混ぜない。
- [ ] `--adjudications` と `--adjudications-dir` をmutually exclusiveにする。
- [ ] directory modeでexpected batch response setを検証する。
- [ ] directory modeでblank noteをrejectする。
- [ ] 既存single-file modeを変更しない。
- [ ] THREE_CLASS review promptをCSV completionへ変更する。

## Candidate

- [ ] `--labeling-summary` / `--labeling-validation` はpair扱い。
- [ ] evidenceなし既存modeを維持する。
- [ ] pipeline version 1.4.0を検証する。
- [ ] final publication / mandatory resolution / validation successを検証する。
- [ ] Stage13 SHA linkageを検証する。
- [ ] actual final dataset byte SHAをsummary/validationと照合する。
- [ ] verified SHAを既存request generationへ渡す。
- [ ] `resolveDatasetSourceSha()` の一般仕様を変更しない。
- [ ] 11-file handoffを変更しない。

## Tests

- [ ] `ACCEPTANCE_TESTS.md` の必須caseを追加する。
- [ ] Integrated Labeling既存20 test groupsに新規failureなし。
- [ ] Candidateに今回変更起因の新規failureなし。
- [ ] known missing fixtureを推測復元しない。

## Final review

- [ ] candidate schema version bumpなし。
- [ ] labeling manifest新設なし。
- [ ] ChatGPT API integrationなし。
- [ ] P2 semantics変更なし。
- [ ] classification/evaluation/publication rule変更なし。
- [ ] `RUNBOOK.md` のE2Eを実行可能。
