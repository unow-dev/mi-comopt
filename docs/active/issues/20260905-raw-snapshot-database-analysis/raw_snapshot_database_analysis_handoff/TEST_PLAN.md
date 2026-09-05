# Test plan / acceptance matrix

## A. Existing v1 regression — mandatory

1. existing `comment-db import` command still works
2. semantic canonical hash still ignores JSON formatting/property/observation order
3. v1 timestamp normalization unchanged
4. duplicate observations within payload preserved
5. repeated content across distinct v1 payloads preserved
6. empty `commentText` preserved
7. empty observations payload remains valid/idempotent
8. transaction rollback unchanged
9. FK enforcement unchanged
10. CLI misuse exits 2 without stack trace
11. v1 DB rows survive migration to v2 unchanged
12. future DB version fails closed; test uses `APPLICATION_SCHEMA_VERSION + 1`

## B. raw contract validation

13. valid raw snapshot schema v1 accepted
14. JSON shape/schema failure -> no canonical raw file and no v2 DB rows
15. invalid UTF-8/JSON -> no canonical raw file and no v2 DB rows
16. `comments.loadedCount != comments.items.length` -> `VALIDATION_ERROR`
17. `reportedCount != loadedCount` remains valid
18. top video ID + comment video ID conflict -> reject
19. top video ID empty + all non-empty comment video IDs same -> effective ID created
20. all video IDs empty -> no video master, import succeeds
21. schema-valid `extractedAt` is stored exact; no extra canonical timestamp restriction
22. no trimming/Unicode normalization of IDs or five Stage13 strings

## C. exact-byte raw store

23. raw SHA equals exact input file bytes
24. same exact bytes reimport -> `already-imported`, no duplicate observations
25. semantically same JSON with different bytes -> distinct snapshot SHA and DB snapshot
26. existing content-address target with matching bytes -> reuse
27. existing target whose bytes do not hash to pathname SHA -> `RAW_STORE_CORRUPT`
28. DB transaction failure after raw publish -> no partial DB rows; orphan raw may remain
29. raw canonical path is `tiktok-v1/<sha>.json`
30. `/var/raw-snapshots/` is Gitignored

## D. identity normalization

31. non-empty effective video ID -> one video master
32. repeated same video across snapshots reuses video master
33. top-level `author.id` non-empty -> author master
34. empty `author.id` -> no author master; no pseudo ID
35. effective video + non-empty `commentId` -> comment master
36. non-empty commentId but no video identity -> observation only, no comment master
37. empty commentId -> observation only
38. same logical comment across snapshots links same comment master but keeps every observation
39. `userId` preserved in `user_id_raw`, no user master
40. author profile/avatar and comment avatar do not appear in normalized v2 tables

## E. observation fidelity

41. every `comments.items[i]` produces exactly one observation
42. `source_index` is 0-based and preserves source array order
43. `username`, `handle`, `comment`, `postedAt`, `postedDate` round-trip exact including whitespace, Unicode composition, punctuation, and empty strings
44. nullable like/reply counts preserve NULL
45. snapshot video observation count is exactly 1 per snapshot
46. stored comment observation count equals `loaded_count`

## F. verify-raw-store

47. all referenced raw files present/hash-correct -> success
48. missing raw file -> runtime error
49. corrupt raw bytes -> `RAW_STORE_CORRUPT`
50. DB count mismatch -> `DATABASE_INTEGRITY_ERROR`
51. SHA filter verifies only requested snapshots
52. no SHA filter verifies all rich snapshots
53. orphan files not referenced by DB do not fail verification

## G. analysis export

54. zero snapshot SHA -> CLI error 2
55. invalid/duplicate SHA option -> CLI error 2
56. unknown DB SHA -> runtime error 1
57. output contains top-level array
58. every record has exactly `username,handle,comment,postedAt,postedDate`
59. no value normalization or fallback
60. no cross-snapshot dedupe
61. snapshot order = SHA ASC
62. inside snapshot = `source_index ASC`
63. same snapshot set with different CLI option order -> byte-identical JSON
64. same source set -> byte-identical manifest
65. output SHA in manifest equals exact output bytes
66. manifest ranges cover all output rows in order
67. coverage values and `extracted_at` match DB snapshot values
68. raw store unavailable/unmounted -> export still succeeds from DB
69. pre-existing output or manifest target -> fail closed without silent overwrite
70. generated JSON passes current Stage13 exact-five-key validation

## H. layer boundary

71. pure projection module imports no SQLite module
72. candidate workflows import no DB module
73. UI imports no DB module
74. existing candidate/UI tests pass without semantic changes

## Merge gates

### PR1

- all A–F applicable tests green
- `npm test` green

### PR2

- all A + G + H green
- `npm test` green
- fixture demonstration archived in test output or docs
