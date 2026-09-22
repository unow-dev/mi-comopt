# Acceptance Tests

全項目必須。実装者判断で省略しない。

## A. Corpus / Projection

| Case | Expected |
|---|---|
| old A + new B、重複なし | projection = A then B |
| A/B間で5項目完全一致 | A側のみsurvive |
| B内で同一キーが2件 | source_indexが小さい方のみsurvive |
| comment同一だが他4項目の1つが違う | 両方survive |
| 空白だけ違う | 両方survive |
| caseだけ違う | 両方survive |
| Unicode表現だけ違う | 両方survive |
| 同じsnapshot refをv2 headへ再投入 | corpus unchanged / 新versionなし |
| v1 headへnormal update | `CORPUS_BOOTSTRAP_REQUIRED` |
| refs=[B,A]のv2 | projection order=[B,A]。SHA sortしない |

## B. Classification

| Case | Expected |
|---|---|
| 同一observationIdにprior labelあり | label維持、ChatGPT対象外 |
| observationId新規、同一comment textにprior labelあり | label自動継承、ChatGPT対象外 |
| exact/comment textともprior labelなし | ChatGPT対象 |
| dedupe loser observation | classification stateに含めない |
| survivorにlabel不足 | commit/release拒否 |
| classificationにsurvivor外observationあり | commit/release拒否 |
| human decision 0件、全てderived、policy許可 | system commit可 |
| human decision >=1 | review required |

### Mandatory handoff assertion

filter不具合を模擬してresolved itemをhandoff候補へ混入させる。

Expected:

```text
CLASSIFICATION_WORKSET_CONTAINS_PREVIOUSLY_RESOLVED_ITEM
```

ChatGPT artifactは生成されないこと。

## C. Complete-state regression fixture

```text
old:
  obs1 / comment=A / normal
  obs2 / comment=B / reactive

incoming:
  obs3 / obs1と5項目完全一致
  obs4 / comment=Bだが他属性違い
  obs5 / comment=C
```

Expected:

```text
projection survivors:
  obs1, obs2, obs4, obs5

classification:
  obs1 = normal
  obs2 = reactive
  obs4 = reactive   # inherited
  obs5 = human decision

obs3 must not exist in classification state
```

## D. Source Dataset v2

- `schema_version === 2`
- source contains corpus/classification identity and ordered snapshot refs
- records order == cumulative survivor order
- public `source_index === 0..N-1`
- record count == survivor count == classification label count
- missing or extra label causes failure

## E. Release gates

| Case | Expected |
|---|---|
| classification depends on different corpus | release build拒否 |
| keyword depends on different corpus | release build拒否 |
| keyword depends on different classification | release build拒否 |
| source dataset SHA != keyword publication source SHA | materialize拒否 |
| comments artifact != source dataset bytes | materialize拒否 |
| overview/account source identity mismatch | materialize拒否 |
| caller supplies arbitrary production artifacts | production override不可 |

## F. Recovery

### Fixture

```text
base committed corpus A
broken current corpus B
```

Recovery result:

```text
logicalCount
= |A| + |B| - fiveFieldDuplicateCount
```

- recovery baseは明示入力。
- base以前の全履歴を勝手に復活させない。
- survivor observation IDに対しhistorical label最新版を復旧。
- historical exactなしで同一comment textあり →継承。
- 真に未解決だけChatGPT対象。
-同じrecovery requestを再実行しても同じ結果。

## G. End-to-End invariant

小さいfixtureでよい。大量24,622件をテストへ入れる必要はない。

以下のlogical corpus identityが一致すること。

```text
cumulative projection
classification coverage
source dataset records
keyword input
account input
overview input
deployed comments artifact
```

production実データでは最終件数が次式を満たすことを確認する。

```text
resultCount
= previousValidCount
+ incomingCount
- duplicateCount
```
