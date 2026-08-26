# PR / CI Review Checklist

## Merge prerequisites

- [ ] `UPDATED_ISSUE_BODY.md` 相当のissue本文が確定MVPへ同期されている
- [ ] contract / policy / implementationが互いに矛盾していない
- [ ] 正式published 3-Class sourceでE2E artifact生成を実行済み
- [ ] account/keyword dataset SHAが同一
- [ ] `npm test` 成功
- [ ] `npm run verify:data` 成功
- [ ] `npm run build` 成功
- [ ] UI manual acceptance完了

## Candidate semantics

- [ ] groupingはexact handle
- [ ] usernameはaccount identityに不使用
- [ ] behavior eventはhandle/comment/postedAt/postedDate exact tuple
- [ ] 値をtrim/lowercase/parse/normalizeしていない
- [ ] same event + same labelはcollapse
- [ ] same event + different labelはfail
- [ ] direct distinct event >= 2のみcandidate
- [ ] reactive/normalはcandidate condition/scoreに不使用
- [ ] time windowなし
- [ ] nuisance subtype推定なし

## Public data minimization

- [ ] candidate JSONにusernameなし
- [ ] reactive/normal本文なし
- [ ] reactive/normal件数なし
- [ ] evidence本文はpolicy sample sizeのみ
- [ ] evidence sampleを「最新/代表/最悪」と表示していない
- [ ] raw/audit 3-Class datasetをbrowser bundleへ含めていない

## Provenance

- [ ] `summary.final_published === true` をgateしている
- [ ] final dataset SHAをsummaryと検証している
- [ ] P2未解決だけを理由に下流独自publication blockerを追加していない
- [ ] account candidate/meta/manifestのhash bindingあり
- [ ] account/keyword `dataset_artifact_sha256` 一致をrelease gateにしている
- [ ] 特定の現在SHAをcontractへhard-codeしていない

## UI regression

- [ ] default viewはkeywords
- [ ] existing KeywordCard behaviorを不要にrefactorしていない
- [ ] keyword recommendation tabs/stateが維持される
- [ ] AccountCardは別責務で実装
- [ ] account viewでraw handle copy
- [ ] account-specific empty stateあり
- [ ] footer/heroがviewに応じて正しい

## Immediate-reject patterns

次の差分があれば、原則として仕様逸脱として修正要求する。

- usernameでgroupingする
- handleをlowercase/trimする
- `@`を勝手に付与・除去する
- direct 1件をcandidate化する
- direct 3/5件へ閾値を勝手に変更する
- reactive/normal比率を危険度として使う
- `score` / 高推奨 / 中推奨をaccountへ導入する
- 30/90日windowを導入する
- all direct evidenceをbrowser bundleへ出す
- `audit_three_class.json` をgenerator入力にする
- build/browserでraw sourceからcandidate生成する
- sourceがない場合に手編集candidateを正規更新とする
- `[]` をmissing-data placeholderにする
- keyword/accountが別dataset SHAなのにwarningだけでreleaseする
- auto-block / localStorage review stateをMVPへ追加する

## Issue close evidence

PR descriptionまたはCI artifactで確認可能にする。

- [ ] source dataset SHA
- [ ] account candidate count
- [ ] collapsed source row count
- [ ] unresolved optional P2 count
- [ ] `npm test` result
- [ ] `verify:data` result
- [ ] production build result
- [ ] UI smoke結果
