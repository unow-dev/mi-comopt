# Acceptance test matrix

## A. Freeze / parity

| ID | Test | Expected |
|---|---|---|
| A01 | v1.4 source tree before/after | byte-identical |
| A02 | v1.5 parity on existing fixtures | intended metadata以外semantic parity |
| A03 | `three_class_policy_version` | 1.4.0維持 |
| A04 | v1.5 root manifest | all listed files hash/size一致 |

## B. Prepare

| ID | Test | Expected |
|---|---|---|
| B01 | human decisions 0 | handoffなし、自動final |
| B02 | Stage13 exact duplicate pending | 1 S-task、全rowへ展開可能 |
| B03 | same comment but non-identical 5 fields | Stage13で別S-task |
| B04 | Stage13 context | original duplicates/order preserved |
| B05 | Stage13 exact reuse + unresolved P0/P1 | unconditional T-task |
| B06 | pending normal branch only P0/P1 | conditional T-task |
| B07 | pending nuisance branch only P0/P1 | conditional T-task |
| B08 | both branches mandatory | branchごとpotential exact key/task |
| B09 | exact duplicate `record_key` rows | 1 logical T-task |
| B10 | distinct `record_key` same comment | 別T-task |
| B11 | existing golden exact key | task不要、golden applied |
| B12 | existing P2 exact eligible | task不要、P2 applied |
| B13 | unresolved P2 only | mandatory human task 0 / final可 |
| B14 | existing workspace | prepare exit 3, no overwrite |
| B15 | prepare crash before rename | canonical workspaceが半端に公開されない |

## C. Request/binding

| ID | Test | Expected |
|---|---|---|
| C01 | same semantic inputs | deterministic request_id |
| C02 | input/reference/config/prompt/task change | request_id changes |
| C03 | response template formatting only | semantic request_id unchanged |
| C04 | implementation manifest change | request_id changes |
| C05 | request semantic file tamper | finalize reject |
| C06 | snapshot tamper | finalize reject |
| C07 | ZIP re-compression | canonical workspace request unaffected |
| C08 | request manifest duplicate JSON key | reject |

## D. Response validation

| ID | Test | Expected |
|---|---|---|
| D01 | complete valid response | preflight success |
| D02 | wrong request_id | reject |
| D03 | unknown/missing S task | reject |
| D04 | invalid Stage13 label | reject |
| D05 | empty Stage13 note | reject |
| D06 | active T = null | reject |
| D07 | inactive T = object | reject |
| D08 | invalid reason_code | reject |
| D09 | empty Three-Class note | reject |
| D10 | unknown/missing T key | reject |
| D11 | response duplicate JSON key | reject |
| D12 | reason_code mapped label | existing mapping exactly |

## E. Finalization/provenance

| ID | Test | Expected |
|---|---|---|
| E01 | Stage13 clean schema | exact 5 fields + label |
| E02 | Three-Class clean schema | exact 5 fields + label |
| E03 | reviewed P0/P1 audit | `golden_adjudication` after replay |
| E04 | existing P2 audit | `p2_adjudication` preserved |
| E05 | Stage13 audit source | existing vocabulary preserved |
| E06 | single-roundtrip sidecar | request_id/response SHA/task binding traceable |
| E07 | strict final | unresolved mandatory=0 |
| E08 | integrated validate | resolved/all checks pass |
| E09 | response accepted boundary | only after full deterministic preflight |
| E10 | accepted raw response | exact supplied bytes + SHA retained |

## F. Concurrency/retry

| ID | Test | Expected |
|---|---|---|
| F01 | unrelated live golden addition outside RUN_KEYS | merge success |
| F02 | same-key identical operational decision | idempotent success |
| F03 | same-key same label different reason | conflict |
| F04 | snapshot golden entry deleted/changed live | conflict |
| F05 | conflicting live P2 overlap | fail-closed |
| F06 | conflict after acceptance | accepted state remains, no re-review |
| F07 | retry same accepted response | succeeds/idempotent |
| F08 | different response SHA after acceptance | reject |
| F09 | golden commit before final promotion crash | retry completes without human re-review |
| F10 | failure before golden commit | operational golden byte-identical |

## G. CLI/receipts

| ID | Test | Expected |
|---|---|---|
| G01 | prepare with handoff | exit0 + one stdout JSON, state AWAITING_RESPONSE |
| G02 | prepare zero-human | exit0 + one stdout JSON, FINALIZED_NO_HANDOFF |
| G03 | finalize success | exit0 + one stdout JSON |
| G04 | expected validation/conflict failure | exit3, stdout empty, stderr error |
| G05 | disk receipt vs stdout | request/state/hash一致 |
| G06 | finalize `--state-dir` mismatch | reject |

## H. Fallback/downstream/cutover

| ID | Test | Expected |
|---|---|---|
| H01 | accepted response -> legacy Stage13 CSV | all source rows covered, notes retained |
| H02 | accepted response -> prospective golden | exact key entries only |
| H03 | v1.4 fallback strict-final | same Stage13/Three-Class labels, 0 re-review |
| H04 | keyword candidate 1.4/1.4 | accept |
| H05 | keyword candidate 1.5/1.5 | accept |
| H06 | 1.4/1.5 mixed evidence | reject |
| H07 | unknown 1.x | reject |
| H08 | account candidate | v1.5 final accepted under existing contract |
| H09 | release | existing tests pass |
| H10 | shadow replay | semantic parity, only allowlisted transport metadata differs |
| H11 | recurring runbook before gates | v1.4 default unchanged |
| H12 | cutover after gates | Stage13〜strict 3-class only replaced by single-roundtrip block |

## Top-level invariants

1. Human classification communication is max 1 handoff + 1 response.
2. Stage13/Three-Class semantic rules remain v1.4-equivalent.
3. Unresolved P2 does not add mandatory human work.
4. Golden/P2 persistence remains exact `record_key` only.
5. Duplicate rows/inactive branches do not cause redundant review.
6. Accepted human decisions survive machine failures/retries.
7. Downstream clean artifact contracts remain compatible.
8. v1.4 operational flow stays frozen until cutover gate passes.

## Execution Record: 2026-09-06

- v1.5全回帰25群、v1.4全回帰24群、Node 78 tests、`verify:data`、production build、v1.5 manifest 43 filesを確認した。
- G06は、finalized workspaceのroot receiptあり／promoted receiptのみのretry両経路で、異なる`--state-dir`を拒否することを確認した。
- H09は、v1.5 finalを既存release builder/validatorへ接続する隔離fixtureで確認した。H10は、同一responseからのv1.4 fallback replayとv1.5 finalのStage13/Three-Class意味内容一致で確認した。
- F01〜F10を独立した同時実行ハーネスで網羅する検証は未実施。今回の回帰ではlive golden/P2 conflict、accepted response retry、異なるresponse拒否、golden commit後retryを確認した。
- H11はv1.4 default維持を確認済み。H12のcutover判断とPR5の通常runbook置換は人間の承認待ち。
