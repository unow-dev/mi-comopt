# Local Deterministic Evaluation Contract

`policy/evaluation/<version>.json` が機械的な正本。

`D = direct_nuisance_hits`, `R = reactive_hits`, `N = normal_hits` とする。

- precision: `D / (D + N)`。`D+N=0` の場合だけ `null`。
- direct recall contribution: `D / D_total`。
- normal hit rate: `N / N_total`。
- utility: `D - N`。
- `R` は上記の式・recommendation判定に一切入れない。

## Recommendation

判定順は `高推奨 -> 中推奨 -> 任意`。

- 高推奨: `D >= 2`, precision `>= 0.95`, `N <= 1`
- 中推奨: `D >= 2`, precision `>= 0.80`, `N <= 5`
- 任意: `D >= 1`
- `D == 0`: recommendation `null`

threshold比較は丸め前の整数比で行う。binary floating pointをtier判定の正本にしない。

rate系出力は最後に最大6桁、`ROUND_HALF_EVEN` でserializationする。utilityはinteger。

## Publication eligibility

`registry.status == active AND D >= 1` のcandidateだけをUI向けJSONへ出す。`任意`もpublished対象。

## Sorting

1. 高推奨 / 中推奨 / 任意
2. exact precision desc
3. D desc
4. N asc
5. normalized keyword code-point length desc
6. normalized keyword code-point lexical asc
7. candidate_id asc
