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

## v1.1 publication note

上記deterministic件数は `three_class_candidate.json` のbaseline互換値である。P0/P1が124件未解決のため、overrideなしbaseline runでは `three_class_labeled.json` は公開しない。

## v1.2 / v1.3 / v1.4 adjudication note

v1.2.0ではP0/P1 124行をexact-record goldenとして確定し、mandatory未解決を0にした。

v1.3.0ではP2 346行を全件確認し、高信頼338行のみexact-caseで確定した。

- normal維持: 239
- reactive: 82
- direct_nuisance: 17
- unresolved P2: 8

v1.3.0 final:

- direct_nuisance: 546
- reactive: 1,224
- normal: 19,663
- SHA-256: `ac324e85b67bcfd2b73a934214db027076cb38e5a39002b097f64813ed1398f2`

`--term-only` は上記adjudicationを適用せず、復元42語のみのdeterministic baselineを再現する。


### v1.4.0 boundary pass

v1.3.0で残した8件を再評価し、7件をexact-caseで追加確定した。

- normal維持: 3
- reactive: 1
- direct_nuisance: 3
- unresolved P2: 1

v1.4.0 final:

- direct_nuisance: 549
- reactive: 1,225
- normal: 19,659

残る1件は件数合わせで確定せず、文面単独では身体的痛み/cringe評価を区別不能な境界例として保持する。
