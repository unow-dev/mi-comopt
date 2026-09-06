# Pipeline Contract

## 5-field identity

以下を原本から変更してはならない。

- username
- handle
- comment
- postedAt
- postedDate

## Stage 13 clean schema

```json
{
  "username": "...",
  "handle": "...",
  "comment": "...",
  "postedAt": "...",
  "postedDate": "...",
  "label": "normal"
}
```

許可ラベル: `normal`, `nuisance`

## Stage 13 workspace binding

`prepare-stage13` は次を固定する。

- input file SHA-256
- reference file SHA-256
- input record count
- 各入力行の5-field SHA-256

`finalize-stage13` はこれらを再検証し、不一致なら出力しない。adjudication CSV の `source_record_sha256` は編集禁止。

## 3-Class candidate / final schema

candidate と final は同じ6フィールド構造で、`label` の許可値だけを以下に変える。

- `direct_nuisance`
- `reactive`
- `normal`

上流Stage 13 labelはclean JSONへ残さず、audit sidecarに保存する。

`three_class_candidate.json` はレビュー途中でも生成可能。

`three_class_labeled.json` はP0/P1未解決件数が0のときだけ公開する。

## record_key

3分類監査用の安定キー。5フィールド + Stage13 label を U+001F で連結し SHA-256、先頭24hexを用いる。分類特徴ではない。

## override contract

- unknown `record_key`: エラー
- duplicate `record_key`: エラー
- provisional labelを変更するoverride: `note`必須
- P0/P1解決: labelを維持する場合も`note`必須
- `normal -> direct_nuisance`: 明示override + `note`必須

## golden adjudication contract

既定registry: `reference/three_class_golden_adjudications.json`

- schema version: 1
- key: 24hex `record_key`
- `stage13_label`, `label`, `reason_code`, 非空`rationale`を必須とする。
- duplicate keyはエラー。
- current inputに存在しないgolden keyは無視する。registryは複数runで再利用するため。
- current recordの`record_key`が一致した場合のみ適用する。
- manual overrideが同じgolden keyを含む場合は、同じlabelでもエラー。
- canonical decisionを変える場合はgolden registryをversion管理して更新する。
- `--no-golden` はP0/P1 goldenだけを無効化する診断用。全adjudication無効のterm-only再現には `--term-only` を使う。

## review template split

- `manual_overrides.csv`: 未解決P0/P1のみ。strict-finalの必須レビュー対象。
- `optional_p2_overrides.csv`: 未解決P2のみ。任意監査対象。
- `review_queue.csv/json`: P0/P1/P2の全flagged itemを監査用に保持し、`review_resolved` / `decision_source`を記録する。


## P2 adjudication contract

既定registry: `reference/three_class_p2_adjudications.json`

- schema version: 1
- key: 24hex `record_key`
- `stage13_label=normal`, `label`, `reason_code`, 非空`rationale`を必須とする。
- duplicate keyはエラー。
- P0/P1 golden registryとのkey重複はエラー。
- current recordでreview reasonsが **exactly** `source_normal_direct_cue`、priority=2の場合だけ適用する。
- policy/cue変更で同じrecordが別review理由を持つ場合、古いP2 decisionを黙って適用せずエラーにする。
- manual overrideが同じP2 keyを含む場合は、同じlabelでもエラー。
- `normal -> direct_nuisance` は自動規則ではなく、P2 exact-case明示review結果としてのみ許可する。
- `--no-p2-adjudications` でP2 registryのみ無効化できる。
- `--term-only` はP0/P1 goldenとP2 registryの両方を無効化する。
