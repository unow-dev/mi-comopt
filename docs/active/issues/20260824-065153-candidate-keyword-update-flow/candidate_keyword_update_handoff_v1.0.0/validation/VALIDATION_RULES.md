# Validation Rules

## 実行方式

各pure validation stage内では検出可能なエラーを全件収集する。stageがinvalidなら次stageへ進まない。invalid proposalをbest-effort適用しない。

## Consumer dataset validation

候補側はIntegrated Labelingの判定ロジックを再実装しない。consumerとして以下だけを検証する。

- source artifact SHA一致
- upstream publication済みであること
- supported schema/pipeline version
- top-level record構造
- `comment` がstring
- `label` が `direct_nuisance/reactive/normal`
- record count / label count整合
- `D_total > 0`, `N_total > 0`

## Candidate invariants

- candidate ID一意
- category IDはtaxonomy内
- keyword raw exact値がvariantsに存在
- normalize後空禁止
- candidate内normalized variant重複禁止
- active candidates間の**新規**normalized variant完全衝突禁止。bootstrap既存conflictはgrandfatherし、増加のみ禁止

## Lifecycle

- add: external proposalではcandidate IDなし。canonical change set生成時にローカルUUIDv4を一度発行。
- update: active IDのみ、full semantic state必須、no-op禁止。
- retire: active IDのみ。
- reactivate: retired IDのみ、full semantic state必須。
- 同じcandidate IDを1proposal内で複数actionが触ることを禁止。

## Derived output

published IDsは厳密に `{ active candidate | D >= 1 }`。semantic fieldsはregistry、metricsはevaluation、category labelはtaxonomy、introduced_atはregistryと一致しなければならない。
