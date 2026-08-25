# Patch Map

## 変更対象ファイル

### A. Integrated Labeling

#### `docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py`

変更箇所:

- `cmd_prepare_stage13`
- Stage13 adjudication loading周辺（必要ならdirectory loader helperを追加）
- `cmd_finalize_stage13`
- argparse `finalize-stage13`

実装内容:

1. `pending_batches` の安全な再生成。
2. `batch_NNN_context.json` 生成。
3. `batch_NNN_adjudications.csv` template生成。
4. `--adjudications-dir` 追加（`--adjudications` とXOR）。
5. workspace batch JSONからexpected response file setを導出。
6. batch CSV union後、既存Stage13 finalizationへ渡す。
7. directory modeで非空noteを強制。

注意:

- `load_stage13_adjudications()` のsingle-file既存挙動を壊さない。
- exact reuse / bound reference / input SHA / row SHA checksを弱めない。
- Stage13 labelsやsemantic policyを変更しない。

#### `.../prompts/THREE_CLASS_REVIEW_PROMPT.md`

変更内容:

- JSON-only response (`reason_code`, `rationale`) を削除。
- `manual_overrides.csv` completionを正規返却形式にする。
- columns: `record_key,label,note`。
- record_keyを変更しない旨を明記。

#### `.../tests/run_all_tests.py`

追加テスト:

- per-batch context/template生成。
- directory mode正常統合。
- missing/unknown batch response reject。
- duplicate source index reject。
- SHA mismatch reject。
- missing coverage reject。
- blank note reject（directory mode）。
- legacy single-file finalization regression。

---

### B. Candidate workflow

#### `package/scripts/candidate-workflow.mjs`

変更箇所:

- CLI usage/help `prepare-handoff`。
- `prepareHandoff(args)` orchestration。
- private helper `verifyLabelingEvidence(...)` を追加可。

新規args:

```text
--labeling-summary FILE
--labeling-validation FILE
```

helperの成功returnは最小でよいです。

```js
{ sourceSha: "sha256:..." }
```

必須検証は `IMPLEMENTATION_SPEC.md` の6/7節を参照。

禁止:

- `resolveDatasetSourceSha()` の一般仕様変更。
- `src/lib/candidate-workflow.js` のcandidate domain logic変更。
- candidate schema v2。
- handoff manifest/file set変更。

#### `package/scripts/README.md`

Manual ChatGPT handoffにIntegrated Labeling evidence modeの例を追加。

既存manual modeは残す。

#### `package/tests/handoff.test.js` または既存candidate handoff testの適切な場所

追加ケース:

- valid evidence pairで成功。
- evidence片方だけfail。
- unsupported pipeline version fail。
- `final_published=false` fail。
- mandatory unresolved fail。
- validation failure fail。
- Stage13 SHA linkage mismatch fail。
- final dataset SHA mismatch fail。
- evidenceなし既存mode regression。

---

### C. Issue/Docs

#### Issue body

`UPDATED_ISSUE_BODY.md` を採択内容として反映。

新しいarchitecture document/schema/manifestは作らない。

---

## 原則として触らないファイル

- candidate-generation-request schema v1。
- candidate-proposal schema v1。
- candidate `src/lib/candidate-workflow.js` の評価仕様。
- publication implementation。
- Integrated Labeling configs/registries。
- Stage13 / 3-Class labeling policy。
- P2 semantics。
