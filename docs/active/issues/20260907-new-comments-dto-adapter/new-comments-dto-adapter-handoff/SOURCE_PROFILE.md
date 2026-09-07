# Source profile — supplied `new-comments.json`

The real file is not copied into this handoff because it contains real comments/account data and the issue explicitly excludes committing the real dataset.

- SHA-256: `77a679587ce091207ccf8654213a9d454cd5af50849d10ebd8186a4dba440ee9`
- JSON root keys: `items` only
- item count: **8**
- total comments: **2,677**
- `loadedCount` values: `217, 248, 408, 351, 397, 388, 342, 326`
- every item satisfies `loadedCount === comments.items.length`
- every item has the same item keyset
- every comment has the same comment keyset

## Two observed collection modes

Four items have `source.itemSource == "__UNIVERSAL_DATA_FOR_REHYDRATION__"` and populated rich metadata. Four have `source.itemSource == ""` and legitimately unavailable rich metadata.

For the latter four items all of these are `null` together:

- `comments.reportedCount`
- `video.duration`
- `stats.viewCount`
- `stats.likeCount`
- `stats.commentCount`
- `stats.shareCount`
- `stats.favoriteCount`

This is why the generic DTO/DB needs the narrow seven-field nullability extension.

## Comment-level observations

Across all 2,677 supplied comments:

- `commentId == ""`: 2,677
- `parentCommentId == ""`: 2,677
- `userId == ""`: 2,677
- `likeCount == null`: 2,677
- `replyCount == null`: 2,677
- `level == 1`: 2,677 (observed fact only; **do not** constrain the V1 schema to level 1)
- `createdAt == ""`: 2,677

The comment schema should preserve the existing generic capability for future replies/counts rather than narrowing to this one dataset.

## Schema construction rule

For fields already present in the supplied legacy `tiktokRawSnapshot-1.0.0` contract, retain its accepted types. Add `null` only where the supplied wrapper demonstrates legitimate null values. Remove only root `schemaVersion` when embedding the snapshot shape under wrapper `items`.
