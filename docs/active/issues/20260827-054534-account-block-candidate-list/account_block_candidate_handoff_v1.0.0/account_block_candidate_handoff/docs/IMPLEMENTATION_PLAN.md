# Implementation Plan

## Goal

既存フィルターキーワードUIを壊さず、account block candidate workflowとaccount viewを追加する。

## Recommended feature PR shape

**1 feature PR / 2 logical commits** を推奨する。

### Commit 1 — Contract / generator / tests

追加・変更候補:

```text
docs/ACCOUNT_BLOCK_CANDIDATE_CONTRACT.md
config/accountBlockCandidatePolicy.json
scripts/account-block-candidate-workflow.mjs
scripts/verify-data.mjs   (または同等のverify:data実装)
tests/account-block-candidate-workflow.test.js
tests/account-block-publication.test.js
package.json
```

User-visible UIはまだ変更しない。

### Commit 2 — Real artifacts / UI

正式published 3-Class sourceでartifactを生成したうえで:

```text
src/data/accountBlockCandidates.json
src/data/accountBlockCandidates.meta.json
src/data/accountBlockCandidateRunManifest.json
src/App.jsx
src/styles.css
```

を追加・変更する。

Feature PR全体はartifact + UI + testsまで揃ってからmergeする。Commit 1だけをmainへ先行mergeする必要はない。

## Existing code migration strategy

### Keep

- `KeywordCard`
- recommendation tabs/state
- NEW badge semantics
- keyword empty state
- keyword data format

### Add

- top-level `view` state (`keywords` default / `accounts`)
- `AccountCard`
- account-specific hero / empty state / footer
- shared clipboard/toast reuse

### Avoid

KeywordCardとAccountCardを無理に共通componentへ抽象化しない。今回のfeatureと無関係な大規模refactorは回帰面積を増やす。

## package.json target scripts

最低限、次の入口を持つ。

```json
{
  "scripts": {
    "test": "node --test tests/*.test.js",
    "verify:data": "node scripts/verify-data.mjs",
    "account-candidate-workflow": "node scripts/account-block-candidate-workflow.mjs",
    "build": "vite build"
  }
}
```

既存 `candidate-workflow` はkeyword workflowとして維持する。

## Generator architecture

推奨内部関数分割（名前は実装裁量）:

```text
loadInputs
validateSummary
validatePolicy
validateDatasetRecord
buildBehaviorEvents
aggregateCandidates
serializeCandidateView
buildManifest
buildMeta
validateStagedArtifacts
publishAtomically
```

Contractを守る限り、関数名・module分割は実装者裁量。

## Publication safety

- staging/temp directoryに3 artifactsを生成する
- hash bindingをstaging上で完了させる
- keyword meta dataset SHAを検査する
- 全validation成功後にpublish-dirの3 account filesを置換する
- failureでは既存published filesを維持する

完全なfilesystem multi-file atomic renameは必須ではないが、**validation前にpublic filesを逐次上書きする実装は禁止**。

## Runtime / build behavior

- Vite buildはcommitted JSONをbundleするだけ
- build時に3-Class sourceを要求しない
- browserでraw/public upstream datasetをfetchしない
- missing account artifactをruntime fallbackでごまかさない

Account viewをreleaseするcommitでは3 account public artifactsが必須。

## Data update runbook

1. 対応するpublished `three_class_labeled.json` と `summary.json` を取得する。
2. summary publication gate / final SHAをworkflowで検証する。
3. 現在のkeyword metaのdataset SHAとsourceが一致するか確認する。
4. 一致する場合はaccount artifactsを生成する。
5. 一致しない場合、accountだけ別snapshotへ更新しない。keyword/account双方を同じpublished snapshotへ揃える。
6. `npm test`
7. `npm run verify:data`
8. `npm run build`
9. UI manual smokeを行う。
10. generated artifactsをcommitする。

## When to return to design discussion

実装者が仕様議論へ戻すのは次の場合のみ。

- 実published 3-Class dataが確定behavior-event contractで扱えない
- upstream summaryにcontract必須情報が存在しない
- keyword/accountを同一dataset SHAへ揃えられない
- evidence 2件公開に新しいprivacy制約が判明した
- exact handleではidentityを扱えない実データ反例が確認された
- handoff内の正本同士に矛盾が見つかった

関数分割、CSS class名、helper名等は実装裁量であり、設計議論へ戻さない。
