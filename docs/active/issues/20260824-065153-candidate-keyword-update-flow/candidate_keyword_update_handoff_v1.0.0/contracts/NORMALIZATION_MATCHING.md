# Normalization and Matching Contract

## 正規化順序

次の順序を固定する。

1. `U+200B`, `U+200C`, `U+200D`, `U+2060`, `U+FEFF` を除去。
2. Unicode NFKC。
3. Unicode lowercase。casefoldへ変更しない。
4. Unicode whitespaceの連続をASCII space 1個へ置換。
5. 前後whitespaceを除去。

`fixtures/normalization_vectors.json` をreference test vectorsとする。

## Candidate variants

- `variants` は実際にOR評価されるmatch stringsの完全集合。
- raw exact equalityで `keyword` が `variants` に存在しなければならない。
- canonical formでは `keyword` を先頭に置く。
- `keyword` 以外はnormalized value昇順で並べる。
- 同一candidate内でnormalized duplicateを禁止する。keywordと同じnormalized valueを持つ別variantは削除する。
- raw空文字、またはnormalize後に空となる文字列は禁止。

## Matching

- コメント全文を正規化してsubstring matchする。
- どれか1variantが一致すれば、そのcandidateはそのcommentに1hit。
- 同一comment内の複数回一致・複数variant一致でも1hit。
- `direct_nuisance`, `reactive`, `normal` を別々にcomment単位で集計する。

## Cross-candidate exact normalized conflicts

新しいcross-candidate exact normalized variant conflictを導入してはならない。

ただしlegacy 187件にはbootstrap時点で1つ既存conflictがあるため、bootstrapでsemantic変更を行わない原則を優先してgrandfatherする。

- baselineは `reference/bootstrap_known_cross_candidate_variant_conflicts.json`。
- `full_update` 後のconflict集合からbase registry時点のconflict集合を引いた差分が非空なら `CROSS_CANDIDATE_VARIANT_CONFLICT`。
- 既存conflictが解消されることは許可する。
- 一度解消されたconflictを将来再導入することは「new conflict」として禁止。
- substring包含（例: `きつ` と `きつい`）はhard failureにしない。

これによりbootstrapのidentity保持と、将来のconflict増加防止を両立する。
