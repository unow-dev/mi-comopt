# BASELINE_AUDIT

## 基準ファイル

- filename: `merged_array_stage13_labeled (3).json`
- SHA-256: `a46c140b1e979c7c2a5037c8fc4eb0797207bd2a6323ced51bfb7cf74e09ee17`
- records: 21,433
- original normal: 20,810
- original nuisance: 623

## 前回報告された3分類

- direct_nuisance: 521
- reactive: 1,054
- normal: 19,858

## 復元した42語のみを機械適用した場合

- direct_nuisance: 520
- reactive: 1,096
- normal: 19,817

## 差分

reactive候補:

- 元normal: 993
- 元nuisance: 103

前回実移動:

- normal -> reactive: 952
- nuisance -> reactive: 102

したがって:

- 元normal候補のうち41件がreactiveから除外
- 元nuisance候補のうち1件がreactiveから除外

されていた。

完全な例外コードは現在の実行記録から復元できない。

## Handoff 方針

この42件を推測で固定しない。

代わりに:

- deterministic provisional label
- review queue
- explicit override
- regression test

で次回から再現性を確保する。

## 重要

「前回件数を完全一致させるための謎ルール」を追加してはいけない。

基準は件数ではなく LABELING_SPEC の意味定義である。
