# Baseline integrity findings — supplied discussion-set snapshot

## Important

Before implementing PR1, verify the **actual repository's v1.4 tree**. Do not modify/restore v1.4 based solely on this handoff snapshot.

The supplied archive itself has SHA-256:

`9b2e8b4be4891853533db0b5d576544ce77a54fb122e6e1a6015fdde7d721692`

The supplied v1.4 `manifest.json` does **not** match two actual files contained in the same supplied archive:

| file | manifest SHA / bytes | actual supplied SHA / bytes |
|---|---|---|
| `src/pipeline.py` | `5883b3f2e3541c57f7ca466a0d342a854b1d091e2990f4ab9e1c95661989d7f1` / 49717 | `b1d605a165d66cfc2521f7728a0ef0e00475f6cd84565e1634639340a4bde722` / 61718 |
| `tests/run_all_tests.py` | `a39e69d565b12c8ae399708aefedd6c719541c6ebe2a9fe1e1a45731ebc98500` / 36183 | `f84ceba46419471bef88ba492edd00cf572595c09a65b0e1d53debb004a4dd5c` / 39335 |

All other files listed by the supplied v1.4 manifest matched in this check.

## Required handling

1. In the actual repository, run existing integrity verification before copying v1.4.
2. If repository v1.4 is manifest-consistent, use repository state as the baseline and ignore these snapshot mismatches.
3. If repository v1.4 has the same mismatch, **do not fix v1.4 inside this issue**. Capture actual v1.4 bytes as the freeze baseline and document the pre-existing mismatch separately.
4. v1.5 sibling must get a newly correct manifest matching its actual files before `implementation_manifest_sha256` is used for request binding.
5. Do not silently restore `pipeline.py` or tests to manifest hashes; content for those hashes is not supplied here.

`baseline/supplied_v1.4_tree_sha256.json` records actual bytes in this supplied snapshot for forensic comparison only.
