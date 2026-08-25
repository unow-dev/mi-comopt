# Known baseline packaging issue

The supplied discussion ZIP does not contain the expected `reference/` directory under:

```text
sources/docs/active/issues/20260824-065153-candidate-keyword-update-flow/
  candidate_keyword_update_handoff_v1.0.0/reference/
```

The existing test `bootstrap preserves 187 identities and canonicalizes only structure` expects at least:

```text
reference/legacy_filterKeywordCandidates.json
reference/bootstrap_candidate_id_map.json
```

On the supplied snapshot, `npm test` result is:

```text
10 tests total
9 pass
1 fail
```

The failure is `ENOENT` on `reference/legacy_filterKeywordCandidates.json`; execution stops before the second missing fixture is read.

## Required handling

- Do not delete or weaken the bootstrap test to make this Issue green.
- Do not invent/reconstruct the 187-entry authoritative fixture from guesses.
- In the authoritative repository, first confirm whether these fixtures exist.
- If only the discussion export omitted them, treat this as packaging deficiency and proceed against the authoritative repository.
- If the authoritative repository also lacks them, restore them from an authoritative source as a separate preparatory fix before evaluating regressions from this Issue.
