# Acceptance tests

The following tests define completion. Exact test function names are implementation detail.

## A. Generation / archive boundary

1. **exact-five-members**  
   Generated ZIP contains exactly `PROMPT.md`, `RULES.md`, `HISTORY.json`, `ITEMS.json`, `response.schema.json`.

2. **no-directory-or-extra-member**  
   No directory entries, `request/`, provenance, manifest, README, snapshot, workspace metadata, or other member.

3. **unsafe-member-rejected-by-validator**  
   Validator rejects duplicate member names, nested paths, `../`, absolute paths, backslash ambiguity, directories, and symlink entries.

4. **canonical-prompt-rules**  
   Generated prompt/rules equal local v1 canonical templates. Validator rejects modified versions.

5. **uuid-v4-binding**  
   `ITEMS.workset_id` is UUID v4 and bundled response schema contains that exact const.

6. **protocol-version-binding**  
   HISTORY and ITEMS both contain exactly `three-class-workset-v1`. Unknown/mismatched version fails closed.

## B. Item construction

7. **comment-only**  
   ITEMS exposes only `id` and `comment`; no username, handle, dates, snapshot IDs, provenance, or Stage13 label.

8. **first-occurrence-dedupe**  
   Input comments `A,B,A,C` produce `I1=A,I2=B,I3=C`.

9. **no-normalization-dedupe**  
   `"abc"` and `"abc "` remain distinct items.

10. **sequential-unbounded-id-format**  
    IDs are `I1`, `I2`, ... and match `^I[1-9][0-9]*$`; no six-digit formatting requirement.

11. **empty-items-valid**  
    An otherwise valid selected input that projects to zero records can produce `items: []`, and validator accepts `decisions: {}`.

12. **empty-whitespace-comments-retained**  
    Empty/whitespace string comments are present as items; generator does not drop them.

## C. HISTORY

13. **history-shape**  
    Accept v1 `{protocol_version, items:[{comment,label}]}` only.

14. **history-same-label-dedupe**  
    Same exact comment + same label is bundled once.

15. **history-conflict-fails**  
    Same exact comment + different labels fails generation.

16. **history-invalid-label-fails**.

17. **history-items-overlap-allowed**  
    A comment may appear in both HISTORY and ITEMS; generator must not remove it from ITEMS due to the historical match.

18. **history-not-truncated**  
    Given N valid history entries, bundled history includes all N after same-label exact dedupe.

## D. Strict JSON

19. **duplicate-json-key-history-rejected**.
20. **duplicate-json-key-items-rejected**.
21. **duplicate-json-key-schema-rejected**.
22. **duplicate-json-key-response-rejected**.

## E. Response validation

23. **valid-response-accepted**.

24. **wrong-workset-id-rejected**.

25. **missing-decision-rejected**.

26. **extra-decision-rejected**.

27. **invalid-label-rejected**.

28. **extra-response-field-rejected**.

29. **invalid-item-key-syntax-rejected**.

30. **bundled-schema-tamper-rejected**  
    Modify bundled schema to permit something broader; validator must reject the workset instead of trusting it.

31. **canonical-schema-structural-match**  
    Validator derives expected schema locally from `workset_id` and requires bundled schema equivalence.

## F. Dependency removal

32. **no-reference-arg-required**  
    New generator succeeds without Stage13 reference.

33. **legacy-generator-options-rejected**  
    `--reference`, `--workspace`, `--state-dir` are not accepted for new generator.

34. **pipeline-unavailable**  
    Temporarily make `Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py` unavailable; generation and response validation still pass.

35. **no-stage13-runtime-data**  
    New runtime does not read legacy Stage13 reference, golden/P2 registry, reactive terms, review cues, or single-roundtrip state.

## G. Classification-rule regression fixtures

These are protocol rule anchors and should appear in RULES/PROMPT fixture tests or a focused rules fixture test. They are not local algorithm tests—the classifier is ChatGPT—but protect template drift.

```text
アンチしてる奴頭おかしい
→ reactive

擁護してる奴頭おかしい
→ direct_nuisance

アンチうざいけど本人も普通に痛い
→ direct_nuisance

アンチが言うほどではないけど今回の投稿は微妙
→ reactive

アンチじゃないけどこの人無理
→ direct_nuisance

何歳ですか？
→ normal

その歳で何やってるの
→ direct_nuisance

「痛い」とか書くのやめなよ
→ reactive

おかずありがとうございます
→ direct_nuisance
```

## H. One-shot migration anchors

Against the supplied discussion-set sources:

36. golden decision count = 123.
37. P2 decision count = 345.
38. reverse lookup failures = 0.
39. unique exact comments = 457.
40. same-comment/different-label conflicts = 0.
41. unique label counts = normal 251 / reactive 173 / direct_nuisance 33.
