# File Change Map

## PR 1

### Modify
- `docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py`
  - raw string contract hardening
  - 必要なら4-column review template support
  - classification semanticsは変更しない

### Add
- `docs/active/operations/integrated-labeling-state/three_class_golden_adjudications.json`
- `docs/active/operations/integrated-labeling-state/three_class_p2_adjudications.json`
- promotion helper（配置は実装者裁量。ただしPython側既存constants/loaderを再利用することを推奨）
- Stage13 reference promotion helper
- tests

### Modify docs
- `RECURRING_UPDATE_WORK_TASK_SEQUENCE.md`
- review template類（必要箇所）

### Ignore
- `var/integrated-labeling/`

## PR 2

### Add canonical runtime contracts
- `package/contracts/keyword-candidates/evaluation-policy-1.0.0.json`
- `package/contracts/keyword-candidates/taxonomy-1.0.0.json`
- `package/contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json`

### Modify
- `package/scripts/candidate-workflow.mjs`
- `package/src/processing/keyword-candidates/update-flow.js`
- 必要に応じて `candidate-workflow.js`
- `package/scripts/verify-data.mjs`
- `package/tests/handoff.test.js`
- `package/tests/candidate-workflow.test.js`
- `package/tests/full-update.test.js`
- `package/tests/account-block-candidate-workflow.test.js`
- `package/scripts/README.md`

### Add
- `package/scripts/create-data-release.mjs`
- `package/scripts/verify-release.mjs`
- tests
- `package/public/data-release.json`はproduction bootstrap時に生成。実装PRで架空値をcommitしない。

### Modify package scripts
- `package/package.json`
- root `package.json`

## PR 3

### Modify
- `.github/workflows/deploy-pages.yml`
- `RECURRING_UPDATE_WORK_TASK_SEQUENCE.md`
- 必要なREADME

### Production data update
- exact 8 files under `package/src/data`
- operational 3-Class registries
- `package/public/data-release.json`

### Do not commit
- `work/**`
- raw
- Stage13 full output
- three-class full output
- review CSVs
- handoff/proposal/intermediate publication

## Explicit non-targets

- `package/src/data/candidateWorkflowConfig.json`
- `package/src/data/bootstrap_candidate_id_map.json`
- `package/src/data/filterKeywordCandidates.txt`
- `package/src/data/accountBlockCandidates.txt`
- UI schema
- account evidence schema
- comment database
