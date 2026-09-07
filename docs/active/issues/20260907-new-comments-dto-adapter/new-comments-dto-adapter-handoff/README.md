# `new-comments.json` DTO adapter — implementation handoff

Status: **design closed / implementation-ready**  
Decision-completion: **100%**

This handoff is the implementation contract for the issue “`new-comments.json` のDTO変換adapterを作成する”. It is grounded in:

- the supplied discussion/source bundle (SHA-256 `2a319668663a15dbbf10b5eed6992ef43cedefcf4c3bcf5ac5de13fa8fae6443`), and
- the supplied real `new-comments.json` (SHA-256 `77a679587ce091207ccf8654213a9d454cd5af50849d10ebd8186a4dba440ee9`; raw file intentionally **not included** here).

## Implement exactly this

1. Add a versioned Collector-side contract for `tiktokNewCommentsWrapper-1.0.0`.
2. Parse/validate the wrapper as exact UTF-8 JSON, preserving the original bytes unchanged.
3. Map every wrapper item, in source order, to the existing generic snapshot DTO.
4. Extend the generic DTO/DB **only** for the seven source fields that are legitimately nullable in the real wrapper.
5. Call generic `importRawInput` once, after the whole wrapper is validated and mapped.
6. Keep Database and Processing free of wrapper-specific parsing.

## Seven nullable DTO/DB fields

- `snapshot.reportedCount`
- `video.duration`
- `video.viewCount`
- `video.likeCount`
- `video.commentCount`
- `video.shareCount`
- `video.favoriteCount`

Do **not** coerce their source `null` values to `0`.

## Read order

1. `DECISIONS.md`
2. `SOURCE_PROFILE.md`
3. `MAPPING_MATRIX.md`
4. `DATABASE_CHANGES.md`
5. `IMPLEMENTATION_PLAN.md`
6. `TEST_PLAN.md`
7. `ACCEPTANCE_CRITERIA.md`
8. `REVIEW_CHECKLIST.md`

Supporting artifacts:

- `contracts/tiktokNewCommentsWrapper-1.0.0.schema.json` — implementation-ready schema draft.
- `fixtures/representative-v1.json` — anonymized fixture covering both observed collection modes.
- `drafts/004-nullable-rich-metadata.sql` — migration draft following the v3 table-rebuild pattern.
- `SOURCE_PROFILE.json` — machine-readable facts from the supplied real input.

## Non-goals

Do not implement legacy merge/dedupe, Stage13 dataset generation, labeling/candidate logic, production backfill, or import of the real raw file into the repository.
