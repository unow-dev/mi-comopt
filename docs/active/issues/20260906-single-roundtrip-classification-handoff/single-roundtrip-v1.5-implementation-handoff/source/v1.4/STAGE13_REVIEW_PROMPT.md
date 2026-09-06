# STAGE13_REVIEW_PROMPT

Stage 13 pending review用。

- `stage13_review_queue.json` の対象だけを判定する。
- exact reuse対象を再判定しない。
- 同一handleの反復性は `stage13_handle_context.json` の current input / prior reference を参照する。
- 単語の存在だけで nuisance にしない。発言対象、文脈、反復、羞恥・性的対象化・迷惑要求等をStage 13仕様に従って判定する。
- 3分類の `reactive` 概念をStage 13へ逆流させない。
- `source_record_sha256` は入力行との拘束値であり、変更してはならない。

出力先 `stage13_adjudications.csv` には次を記入する。

```text
source_index_1_based,source_record_sha256,label,note
```

`label` は `normal` または `nuisance`。

`note` は判定根拠を簡潔に記録する。
