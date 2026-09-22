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
| v1 headでnormal session start | session/evidence ingest前に`CORPUS_BOOTSTRAP_REQUIRED` |
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
- exact 5-field dedupe group内のmember observation IDsに対してhistorical labelsを検索し、group内の最新classification versionのlabelをsurvivorへ復旧。
- dedupe loser側にしかhistorical labelがない場合も、同一コメントidentityとしてsurvivorへ復旧しChatGPT対象外。
- group identity labelなしでも、current survivorへ復旧済みの別identity labelに同一comment textあり →継承。recovery corpus外のhistorical comment labelは使用しない。
- 真に未解決だけChatGPT対象。
- 同じrecovery requestを再実行しても同じ結果。

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
= baseLogicalRecordCount
+ appendedRawObservationCount
- duplicateObservationCount
```

## H. Recovery classification authority isolation

| Case | Expected |
|---|---|
| recovery survivor自身にhistorical exact labelあり | 最新のlabelを復旧 |
| same 5-field dedupe groupのloserにのみhistorical labelあり | group identity labelとしてsurvivorへ復旧、ChatGPT対象外 |
| group memberの複数historical versionにlabelあり | newest classification versionのlabelを採用 |
| same latest classification version内でgroup member labelsが衝突 | `worseThreeClassLabel()` |
| recovery corpus外のhistorical obsに同一comment labelあり | 継承元として使用しない |
| recovery survivor内の別identity-resolved obsに同一comment labelあり | survivor-derived comment mapから継承可能 |
| DB-global label readerを差し込もうとする | v3 recovery pathから呼ばれないことをテスト |

## I. Recovery CLI contract

- `recovery freeze` requires `smoke_verified` and enters `recovery_frozen`.
- `recovery plan` is non-mutating and requires `recovery_frozen` + zero nonterminal v3 sessions.
- `recovery plan` fails if supplied broken head != current head.
- `recovery start` rejects a mismatched `--expected-plan-sha256`.
- recovery range rejects base/broken versions that are not on the same committed ancestry.
- `fix_forward_v3` is rejected from `recovery_frozen`.
- `recovery cancel` succeeds only before any mutating recovery stage receipt exists; after mutation it is rejected.
- if the canonical plan changes between reviewed plan and `start`, recovery remains frozen and returns `RECOVERY_PLAN_STALE` before corpus mutation.
- repeated `recovery resume` is idempotent.
- `recovery status` can be reconstructed from deterministic `application_operation_receipts`; no dedicated progress table is required.
- `recovery verify` fails if served release ID differs from corrected release ID.
- marker/DB statusが正しくても、served manifestまたはcomments/keywords/accounts/overviewのいずれかをread-backできない・SHAが違う場合は失敗。
- `recovery verify` fails if any expected source/deployed SHA differs.
- `recovery verify` rebuilds Source Dataset v2 from recovered corpus + classification and fails unless rebuilt bytes/SHA == materialized comments == deployed comments; count must equal cumulative survivors.
- `recovery verify` rebuilds Overview/Account from the rebuilt source dataset and fails on artifact mismatch.
- `recovery verify` fails if `previouslyResolvedItemCount != 0`.
- `recovery complete` fails before a successful verification receipt.
- `recovery complete` succeeds after a matching successful verification receipt and returns `recovery_frozen -> smoke_verified`.
- `recovery complete` is rejected from any other cutover state.

## J. Production issue-close gate

CI/fixture success alone is insufficient.

For this issue, require recorded production evidence that:

```text
recovery command executed = true
corrected release deployed = true
recovery verify passed = true
previouslyResolvedItemCount = 0
served release ID = corrected release ID
deployed comments SHA = generated corrected comments/source dataset SHA
```

Actual record count must satisfy:

```text
logicalRecordCount
= baseLogicalRecordCount
+ appendedRawObservationCount
- duplicateObservationCount
```

Do not hard-code 36,090 unless the actual duplicate count is verified as 300.
