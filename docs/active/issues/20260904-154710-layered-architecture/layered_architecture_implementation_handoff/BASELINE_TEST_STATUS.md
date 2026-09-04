# Baseline Test Status

## Runtime

Supplied workspace rootはNode:

```text
>=24 <25
```

を要求している。

このhandoff作成環境で確認できたNodeは:

```text
v22.16.0
```

したがって最終merge判定は必ずNode 24環境で行う。

## Supplied discussion setでの `npm test`

実行結果:

```text
# tests 32
# pass 14
# fail 18
# skipped 0
```

この18失敗を本issueのbaseline regressionとみなして直してはいけない。

主因はsupplied discussion setに含まれていない既存fixture/document参照である。

代表例:

- account policy:
  `../docs/active/issues/20260827-054534-account-block-candidate-list/.../accountBlockCandidatePolicy.json`
- keyword evaluation policy/fixtures:
  `../docs/active/issues/20260824-065153-candidate-keyword-update-flow/...`
- `package/docs/comment-database.md`

これらの欠落修正は本issueのscope外。

## Merge gate

### Discussion set上

少なくとも今回追加・変更する独立検証を実行する。

- architecture boundary test
- UI adapter test
- NEW badge test
- supplied dependenciesだけで実行可能なComment DB/publication等の回帰

### 実リポジトリ + Node 24

以下をmerge必須条件にする。

```bash
npm test
npm run verify:data
npm run build
```

すべてgreen。
