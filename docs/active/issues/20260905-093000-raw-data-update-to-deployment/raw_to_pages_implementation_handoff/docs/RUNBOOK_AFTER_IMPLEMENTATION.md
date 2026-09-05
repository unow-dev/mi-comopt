# 継続更新 Runbook（実装後）

以下は実装後にoperatorが毎回使う標準順序です。

## 0. 作業領域

`work/<YYYYMMDD-or-run>/`

raw、中間生成物、人手回答はGitへcommitしない。

## 1. raw準備

`current_raw.json`をauthoritative full snapshotとして配置。

記録:
- scope_id
- source_ref

## 2. Stage 13 reference選択

通常:
`var/integrated-labeling/stage13_reference.json`

bootstrapのみ:
verified legacy reference or immutable baseline。

通常runでprivate referenceがない場合は停止。無言でbaseline fallbackしない。

## 3. Stage 13

prepare -> review -> finalize。

prepare/finalize/final validateでsame `--reference`。

## 4. 3-Class first pass

operational golden/P2 registryを明示。

## 5. mandatory review

4-column CSV:
`record_key,label,reason_code,note`

## 6. registry promotion

review decisionsをoperational registryへpromotion。

## 7. strict final

manual overrideなし。
新operational registriesだけでmandatory 0にする。

## 8. integrated validation

`--require-resolved`
`--three-class-audit`

all checks pass。

## 9. keyword handoff/proposal

既存current public keyword 5artifactを作業publication baseへコピー。

handoff生成。
ChatGPT proposalを未編集保存。
proposal validate/full-update。
parent manifestを明示。

## 10. account generation

same three-class final/summary。
今回のkeyword metaを渡す。

## 11. shared snapshot verification

keyword/account dataset SHA == three-class output SHA。

## 12. public staging

公開8artifactを揃える。

## 13. data release record

actual raw/Stage13/reference/three-class + staged public dataから
`data-release.json`生成。

## 14. local gates

- Integrated Labeling tests
- `npm test`
- `npm run verify:data`
- `npm run verify:release`
- `npm run build`

## 15. Git

commit:
- 公開8artifact
- operational registries
- `data-release.json`
- 必要な運用文書

do not commit:
- raw
- Stage13/three-class full datasets
- review CSV
- work dir
- handoff/proposal

## 16. CI / deploy

PR/main policyに従う。
validation成功後Pages deploy。

## 17. public confirmation

deployed `data-release.json` == repository/build版。

## 18. Stage13 reference promotion

公開成功後のみ今回Stage13 outputをprivate operational referenceへpromotion。

## 19. record

run IDs、dataset SHA、件数、注意点は`data-release.json`と通常作業記録で確認可能。

## 異常時

- deploy失敗: Stage13 referenceをpromotionしない。
- shared dataset SHA mismatch: publicationを中止。
- 3-Class mandatory unresolved: candidate handoffへ進まない。
- private Stage13 reference欠損（通常run）: baselineへ黙って戻らず停止。
- operational registry conflict: overwriteせず停止。decision correctionは別change-control。
