# MVP Runbook

パスは例です。実repoの配置に合わせて置換してください。

## 0. 前提

人間が5-field raw JSONを準備する。

以降、意味判断はChatGPT、決定的処理とpublication authorityはlocalです。

---

## 1. Stage13 prepare

```bash
python src/pipeline.py prepare-stage13 raw-data.json \
  --outdir work/stage13
```

`work/stage13/stage13_prepare_report.json` の `pending_records` を確認。

### pending > 0

各batchについてChatGPTへ以下を渡す。

```text
STAGE13_REVIEW_PROMPT.md
01_STAGE13_LABELING_SPEC.md
02_STAGE13_WORK_RULES.md
02_STAGE13_DECISION_BOUNDARIES.md
pending_batches/batch_NNN.json
pending_batches/batch_NNN_context.json
pending_batches/batch_NNN_adjudications.csv
```

ChatGPTは `batch_NNN_adjudications.csv` の `label`,`note` を完成させる。

回答を:

```text
work/chatgpt-stage13/batch_NNN_adjudications.csv
```

へ保存。

finalize:

```bash
python src/pipeline.py finalize-stage13 raw-data.json \
  --workspace work/stage13 \
  --adjudications-dir work/chatgpt-stage13 \
  --output work/stage13_labeled.json
```

### pending == 0

ChatGPTをskip。

```bash
python src/pipeline.py finalize-stage13 raw-data.json \
  --workspace work/stage13 \
  --adjudications work/stage13/stage13_adjudications.csv \
  --output work/stage13_labeled.json
```

---

## 2. 3-Class first pass

```bash
python src/pipeline.py three-class work/stage13_labeled.json \
  --outdir work/three_class
```

ここでは `--strict-final` を付けない。

`work/three_class/summary.json.unresolved_mandatory_reviews` を確認。

### unresolved > 0

ChatGPTへ:

```text
THREE_CLASS_REVIEW_PROMPT.md
03_THREE_CLASS_LABELING_SPEC.md
04_THREE_CLASS_CHANGE_CONTROL.md
work/three_class/review_queue.csv
work/three_class/manual_overrides.csv
```

を渡す。

ChatGPTは `record_key,label,note` CSVを完成させ、例えば:

```text
work/chatgpt-three-class/manual_overrides.csv
```

へ保存。

```bash
python src/pipeline.py three-class work/stage13_labeled.json \
  --outdir work/three_class_final \
  --overrides work/chatgpt-three-class/manual_overrides.csv \
  --strict-final
```

### unresolved == 0

ChatGPTをskipし、final pathを統一する。

```bash
python src/pipeline.py three-class work/stage13_labeled.json \
  --outdir work/three_class_final \
  --strict-final
```

---

## 3. Validation

```bash
python src/pipeline.py validate \
  --input raw-data.json \
  --stage13 work/stage13_labeled.json \
  --three-class work/three_class_final/three_class_labeled.json \
  --reference reference/stage13_labeled_REFERENCE.json \
  --three-class-audit work/three_class_final/audit_three_class.json \
  --require-resolved \
  --report work/validation_report.json
```

candidateへ進むのはvalidate成功時だけ。

---

## 4. Candidate handoff

```bash
npm run candidate-workflow -- prepare-handoff \
  --publication-root ./candidate-publication \
  --dataset work/three_class_final/three_class_labeled.json \
  --labeling-summary work/three_class_final/summary.json \
  --labeling-validation work/validation_report.json \
  --policy ./candidateEvaluationPolicy.json \
  --taxonomy ./candidateTaxonomy.json \
  --source-ref upstream://integrated-labeling/three-class \
  --outdir ./handoff
```

このmodeではdataset SHAをsummary/validation/actual bytesでlocal検証し、そのverified SHAをcandidate requestへ使用する。

---

## 5. ChatGPT candidate proposal

既存Manual ChatGPT handoffどおり:

- `prompt.txt` をチャットメッセージとして使用。
- `handoff_manifest.json` 以外の9ファイルを添付。
- ChatGPTのJSON-only回答を未編集で `candidate_proposal.json` として保存。

---

## 6. Local full-update / publication

```bash
npm run candidate-workflow -- full-update \
  --registry ./candidate-publication/current/candidate_registry.json \
  --request ./handoff/candidate_generation_request.json \
  --proposal ./candidate_proposal.json \
  --dataset ./handoff/source_dataset.json \
  --policy ./handoff/evaluation_policy.json \
  --taxonomy ./handoff/taxonomy.json \
  --candidate-view ./handoff/candidate_view.json \
  --pre-evaluation ./handoff/pre_evaluation.json \
  --handoff-manifest ./handoff/handoff_manifest.json \
  --outdir ./candidate-publication
```

production flowで `canonicalize-proposal` を事前実行しない。
