# Baseline Notes from the Discussion Set

この文書は添付されたdiscussion setを確認した時点の**参考情報**であり、contractではない。実装開始時のrepositoryが変化している場合は現行repoを優先する。

## Existing package shape observed

```text
sources/package/
  src/App.jsx
  src/styles.css
  src/data/filterKeywordCandidates.json
  src/data/filterKeywordCandidates.meta.json
  src/data/run_manifest.json
  src/data/candidateWorkflowConfig.json
  tests/smoke.test.js
  package.json
```

`App.jsx` は現在keyword candidateのみを表示し、recommendation tabs、KeywordCard、clipboard toastを持つ。React Routerは使用していない。

`tests/smoke.test.js` は現状、browser entrypoint存在確認だけであり、account candidate policyを保証するテストはない。

## Existing keyword provenance observed

Discussion set内の `filterKeywordCandidates.meta.json` では、確認時点のdataset SHAは:

```text
sha256:b15bf5a4f431e56fb1d5b9e1490b94fbca3950ad596f4db142877c45bb0d95b3
```

これは**現在のsnapshotの観測値にすぎずcontract値ではない**。実装契約へhard-codeしない。

## Upstream Stage13 contract observed

Stage13 work rulesでは:

- source 5 fieldsを変更しない
- same user判定はexact `handle`
- `username`が同じでもhandleが異なれば原則別user
- 反復否定は2件以上を作業上の反復境界とする
- `postedDate`は時系列確認の補助として利用可能

という契約が確認できる。

## Upstream Three-Class contract observed

Three-Class final labelは:

```text
direct_nuisance
reactive
normal
```

であり、three-class classification自体ではhandle履歴を未知コメントへ一般化して使わない。

Pipeline `summary.json` には確認時点で少なくとも:

```text
three_class_policy_version
unresolved_optional_p2_reviews
final_published
final_output_sha256
```

が存在する。

Publication ruleはP0/P1 mandatory reviews解決を要求し、P2はoptional auditとして未解決でも `final_published=true` になり得る。

## Raw integration issue relationship

別issueでは、現状rawと新規rawを分離保持しながら統合snapshotを再現可能に作ることが議論されている。

Account candidate workflowはそのraw統合**実装**を直接知る必要はない。正式なdependency surfaceはpublished 3-Class finalである。

## Missing from the supplied discussion set

正式な `three_class_labeled.json` 本体はdiscussion setに含まれていない。

そのためhandoff作成時点では、handle別direct_nuisance分布や実candidate countを実測していない。閾値2は実データ負荷最適化ではなく、Stage13既存の反復境界と意味論から採択している。
