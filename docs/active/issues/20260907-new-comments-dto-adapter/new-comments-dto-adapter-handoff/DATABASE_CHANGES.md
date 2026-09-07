# Database / generic DTO changes

This issue requires a narrow generic-contract extension because the supplied wrapper contains legitimate null rich metadata that the current v3 DTO/DB cannot represent.

## 1. Schema version

- `APPLICATION_SCHEMA_VERSION`: `3 → 4`
- register `004-nullable-rich-metadata.sql`
- `DATABASE_SCHEMA_VERSION` in `src/processing/analysis-input/raw-snapshot-projection.js`: `3 → 4`
- keep analysis manifest schema/projection versions unchanged unless another independent compatibility reason exists.

## 2. DTO validation changes

In `validateSnapshotDto`:

- `snapshot.reportedCount`: `assertDtoInteger` → `assertDtoNullableInteger`
- `snapshot.video.duration`: finite number **or null** (add/use `assertDtoNullableNumber`)
- five video stats: `assertDtoInteger` → `assertDtoNullableInteger`

No other DTO validation should be loosened.

## 3. SQL nullability

Migration 004 removes `NOT NULL` from exactly:

- `raw_snapshots.reported_count`
- `snapshot_video_observations.duration`
- `snapshot_video_observations.view_count`
- `snapshot_video_observations.like_count`
- `snapshot_video_observations.comment_count`
- `snapshot_video_observations.share_count`
- `snapshot_video_observations.favorite_count`

SQLite requires table rebuilds for this change. Rebuild `raw_snapshots`, `snapshot_video_observations`, and `snapshot_comment_observations` together following migration 003's FK-safe pattern. See `drafts/004-nullable-rich-metadata.sql`.

## 4. Read paths: preserve SQL NULL

Current code has `Number(row.reported_count)` and `Number(video.duration/...)`. `Number(null) === 0`, which would corrupt semantics after migration 004.

Change all seven reads to the pattern:

```js
value === null ? null : Number(value)
```

At minimum this applies to:

- `src/database/comment-database.js` materialization readback
- `src/database/raw-snapshot-repository.js` `toPlainSnapshot` (`reportedCount`)

Search the repository for every read/conversion of these seven SQL columns and update all paths, including tests/helpers that assert round trips.

## 5. Write paths

No special SQL write coercion is required once DTO validation and column nullability allow null. Pass the DTO values directly.

## 6. Legacy compatibility

`tiktokRawSnapshot-1.0.0` continues to require non-null values under its existing schema. Do not weaken that legacy source contract merely because the generic DTO/DB can now represent null. Existing legacy imports should behave identically.
