# Required test plan

## A. Wrapper contract unit tests

1. representative fixture validates.
2. invalid UTF-8 rejects.
3. invalid JSON rejects.
4. root unknown key rejects.
5. item unknown key rejects.
6. nested unknown key rejects.
7. required field missing rejects.
8. wrong field type rejects.
9. `items: []` rejects.
10. zero-comment item with `loadedCount: 0` accepts.
11. loaded-count mismatch rejects.
12. conflicting video IDs reject.
13. rich arrays accept opaque elements without inventing an item schema.
14. observed legitimate null variants validate (`reportedCount`, video duration/stats, author/music null-valued metadata).

## B. Adapter mapping unit tests

15. `payloadBytes` are byte-for-byte identical to input.
16. `inputFormat` is exactly `tiktokNewCommentsWrapper-1.0.0`.
17. item order is preserved as snapshot order.
18. comment order is preserved.
19. no dedupe of duplicate comment observations.
20. empty `commentId` maps to `externalCommentId: null` and `commentIdRaw: ""`.
21. empty author ID maps to `externalAuthorId: null`.
22. effective-video-ID rule matches legacy behavior.
23. null seven-field metadata maps to null, not zero.
24. `reportedCount` is never filled from `stats.commentCount`.
25. text/date strings are not trimmed/reformatted.

## C. Generic DB v4 tests

26. migrate v3 DB with existing populated rows to v4 without value changes.
27. `PRAGMA user_version == 4` after migration.
28. import DTO with all seven fields null; round trip returns null for all seven.
29. import DTO with populated values; round trip preserves exact values.
30. raw repository `reportedCount` null stays null (does not become 0).
31. materialization-conflict/idempotency logic distinguishes null from zero.
32. foreign-key check passes after migration.
33. existing legacy snapshot tests remain green.

## D. End-to-end wrapper integration

34. import anonymized representative wrapper in one generic call.
35. returns expected snapshot count and comment observation count.
36. exact stored raw bytes equal source bytes.
37. stored snapshot indexes match wrapper order.
38. stored source indexes match comment order.
39. invalid second item results in zero partial materialization for the input.
40. analysis-input projection can include a snapshot whose `reportedCount` is null; manifest preserves JSON `null`.
41. structural check: Database and Processing do not import the wrapper contract/adapter.

## E. Real-file verification (local only; do not commit raw data)

Against the supplied real file SHA-256 recorded in `SOURCE_PROFILE.json`:

42. wrapper validates as 8 items.
43. maps to 8 DTO snapshots.
44. maps to 2,677 comment observations total.
45. all 8 loaded counts match array lengths.
46. exactly four snapshots retain `reportedCount: null` and null video duration/stats.
47. exact raw bytes can be retrieved and hash to the original SHA-256.

The real file is a local verification input only, not a repository fixture.
