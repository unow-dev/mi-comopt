# Acceptance tests

These are normative behavior tests for the implementation handoff. Test names may differ.

## A. Generation / exact matching

1. **Unlabeled comments remain items**
   - selected source contains `A`, `B`;
   - Comment DB contains no labels for them;
   - ITEMS contains `I1=A`, `I2=B`.

2. **Global existing label excludes selected exact comment**
   - selected source contains `A`, `B`;
   - a different/non-selected snapshot observation has `A -> normal`;
   - generated HISTORY contains `A -> normal`;
   - ITEMS contains only `I1=B`.

3. **Worst existing DB label wins**
   - exact `A` has DB labels `normal`, `reactive`, `direct_nuisance` on different observations;
   - generated HISTORY contains exactly one `A -> direct_nuisance`;
   - `A` is excluded from ITEMS.

4. **Intermediate conflict resolution**
   - exact `A` has only `normal` and `reactive`;
   - effective label is `reactive`.

5. **Input HISTORY label is replaced by DB effective label**
   - input HISTORY has `A -> direct_nuisance`;
   - DB effective label is `A -> normal`;
   - generated HISTORY keeps A at the input position but changes it to `normal`.
   - This verifies DB precedence, not cross-source worst-label resolution.

6. **Input-HISTORY-only comment is not excluded**
   - input HISTORY has `A -> normal`;
   - DB has no label for exact A;
   - selected source contains A;
   - A remains in ITEMS.

7. **Input HISTORY internal conflict remains invalid**
   - input HISTORY contains `A -> normal` and `A -> reactive`;
   - generation fails with `INVALID_HISTORY` before packaging.

8. **No normalization**
   - DB label exists for `A`;
   - source contains `A `, `a`, `Ａ`, and `A`;
   - only exact `A` is excluded.

9. **First occurrence and item IDs after exclusion**
   - source comments: `A, B, A, C`;
   - A is DB-labeled;
   - ITEMS is exactly `I1=B`, `I2=C`.

10. **All comments excluded**
    - every selected unique comment has a DB label;
    - ITEMS is empty and validates successfully;
    - generated HISTORY includes the effective precedents.

## B. HISTORY deterministic merge

11. **Input order preserved**
    - input HISTORY comments `X, A, Y`;
    - DB also labels A;
    - generated order remains `X, A, Y` for those entries.

12. **DB-only precedents appended deterministically**
    - input HISTORY has `X`;
    - DB-only comments B and A have earliest observation IDs 20 and 10;
    - appended order is A then B.

13. **Tie-break by comment text**
    - construct effective rows with equal first observation id if fixture/injected unit boundary permits;
    - order by `commentText ASC`.
    - If actual DB constraints make equal observation ids impossible across comments, unit-test the merge/effective-map helper instead.

## C. Provenance / migration

14. **Schema version advances to 8**
    - fresh DB migrates through 008;
    - `PRAGMA user_version` is 8;
    - exclusion table exists with the required PK/FK shape.

15. **Only actually excluded selected comments are registered**
    - global DB labels include A and Z;
    - selected source contains A and B but not Z;
    - provenance for the new workset contains A only.

16. **Registration is atomic**
    - force an exclusion provenance insert failure inside registration;
    - workset row and snapshot-ref rows must not remain partially committed.
    - Use existing transaction test style if available.

17. **Legacy workset compatibility**
    - register/build a pre-feature-style workset with zero exclusion rows;
    - apply follows old source reproduction semantics without a version flag.

## D. Apply / source reproduction

18. **Registered exclusion set reproduces ITEMS**
    - generation excludes A and emits B;
    - apply reads the registered exclusion set and accepts the untouched source/ZIP pair.

19. **Tampered ITEMS still rejected**
    - alter a syntactically valid ITEMS archive so it no longer equals source-minus-registered-exclusions;
    - apply fails with `WORKSET_SOURCE_MISMATCH`.

20. **Missing registered excluded source comment rejected**
    - make the registered selected source no longer contain an excluded A while keeping a ZIP that could otherwise reproduce the same remaining ITEMS;
    - apply fails with `WORKSET_SOURCE_MISMATCH`.
    - The test can induce controlled DB corruption/mutation in a fixture; production code must not support raw mutation.

21. **Excluded selected observations are untouched**
    - selected source has duplicate A observations plus B;
    - A was excluded because DB had an exact existing label elsewhere;
    - response covers B only;
    - applying response writes no label to the selected A observations.

22. **All response-target duplicate observations are updated**
    - selected source contains duplicate B observations;
    - B is an ITEM;
    - response label is applied to every selected B observation, as in current behavior.

23. **Apply counts response targets only**
    - selected source has two excluded A observations and one response-target B observation;
    - first apply returns `observations=1 inserted=1 unchanged=0`;
    - not `observations=3`.

24. **Idempotent replay**
    - second apply of the same response returns zero inserts and all response targets unchanged.

## E. Concurrent/new labels after generation

25. **Same label added after generation is allowed**
    - B was an ITEM;
    - before apply, another observation receives the same label requested by the response;
    - apply remains allowed.

26. **Different label added after generation conflicts**
    - B was an ITEM;
    - before apply, another exact B observation receives a different label;
    - apply fails with `LABEL_CONFLICT`.

27. **Excluded comment label changes after generation do not change membership**
    - A was excluded at generation;
    - alter/remove the label that originally caused exclusion;
    - apply still treats A as excluded based on registered workset provenance;
    - A is not added to the response target set.

## F. Shared severity rule / one-shot final sync

28. **Final sync still resolves conflicts by shared priority**
    - existing `three-class-final-sync` tests for worst-label wins continue to pass after moving priority definition.

29. **Workset does not call final-sync**
    - structural/code review assertion: no runtime dependency from workset generation/apply to `syncThreeClassFinal` or the final-sync adapter.

30. **Protocol unchanged**
    - archive still has exactly five members;
    - `protocol_version` remains `three-class-workset-v1`;
    - existing response validation tests continue to pass.
