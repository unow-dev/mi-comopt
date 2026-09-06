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


## Single-roundtrip contract

v1.5.0のhuman transactionは、`prepare-single-roundtrip`によるhandoff送付1回と、`finalize-single-roundtrip`によるresponse取得1回で完了する。内部の分類処理はStage13からThree-Classの順序を維持し、snapshotしたinput/reference/config/registryだけを参照する。

- request identityは、bindingsとsemantic request filesのcanonical JSON SHA-256で決める。
- Stage13 taskは完全一致する5-fieldのpending行だけをまとめ、source rowと順序は保持する。
- Three-Class taskはexact `record_key`単位で、unresolved P0/P1だけを生成する。P2だけの未解決はtaskにしない。
- responseはS/T task keyを完全coverageし、inactive Tは`null`、active Tは既存reason codeと非空noteを持つ。
- accepted response、golden commit、final artifact、receiptはatomic/fail-closedに扱い、同一responseのretryだけを許可する。
- `request/manifest.json`、snapshot manifest、response schemaはstrict duplicate-key JSONとして検証する。

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
