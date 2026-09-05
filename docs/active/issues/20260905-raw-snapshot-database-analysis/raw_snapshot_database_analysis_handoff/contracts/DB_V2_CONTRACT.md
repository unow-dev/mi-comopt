# Comment DB v2 contract

## General

- SQLite `STRICT`
- `PRAGMA foreign_keys = ON` remains mandatory
- `PRAGMA user_version = 2`
- migration is additive; v1 tables unchanged
- new v2 FKs use SQLite default `NO ACTION` behavior; no `ON DELETE CASCADE`

## raw_snapshots

| column | type | null | contract |
|---|---|---:|---|
| snapshot_id | INTEGER PRIMARY KEY | no | internal row identity |
| platform | TEXT | no | importer writes `tiktok` |
| raw_schema_version | INTEGER | no | v1 importer writes `1` |
| payload_sha256 | TEXT UNIQUE | no | exact input bytes, lowercase 64hex |
| raw_relpath | TEXT UNIQUE | no | exactly `tiktok-v1/<sha>.json` |
| extracted_at | TEXT | no | raw `extractedAt` string, unchanged |
| source_page_url | TEXT | no | `source.pageUrl` unchanged |
| source_canonical_url | TEXT | no | `source.canonicalUrl` unchanged |
| item_source | TEXT | no | `source.itemSource` unchanged |
| loaded_count | INTEGER | no | `comments.loadedCount` |
| reported_count | INTEGER | no | `comments.reportedCount` |
| coverage_note | TEXT | no | `comments.note` |
| imported_at | TEXT | no | application `new Date().toISOString()` |

No semantic range CHECKs are added for counts beyond the raw schema. `loaded_count === observation count` is importer semantic validation/integrity, not a SQL range inference.

## videos

| column | type | null | contract |
|---|---|---:|---|
| video_pk | INTEGER PRIMARY KEY | no | internal |
| platform | TEXT | no | `tiktok` |
| external_video_id | TEXT | no | non-empty effective video ID |

`UNIQUE(platform, external_video_id)`.

### effective video ID

Let `S` be the distinct set of:

- top-level `video.id` if it is not exact `""`
- every comment `videoId` that is not exact `""`

Then:

- `|S| = 0`: no video master; `video_pk = NULL`
- `|S| = 1`: use the single value
- `|S| > 1`: reject entire raw snapshot (`VALIDATION_ERROR`)

No trimming.

## authors

| column | type | null | contract |
|---|---|---:|---|
| author_pk | INTEGER PRIMARY KEY | no | internal |
| platform | TEXT | no | `tiktok` |
| external_author_id | TEXT | no | top-level `author.id`, only when non-empty |

`UNIQUE(platform, external_author_id)`.

No username/nickname/secUid/avatar/profile stats are duplicated into this table in v2.

## comments

| column | type | null | contract |
|---|---|---:|---|
| comment_pk | INTEGER PRIMARY KEY | no | internal |
| video_pk | INTEGER FK -> videos(video_pk) | no | stable parent video identity |
| external_comment_id | TEXT | no | raw `commentId`, non-empty |

`UNIQUE(video_pk, external_comment_id)`.

A comment master is created only when both effective video ID and raw `commentId` are non-empty. No pseudo IDs.

## snapshot_video_observations

Exactly one row per `raw_snapshots` row.

| column | type | null | mapping |
|---|---|---:|---|
| snapshot_id | INTEGER PK/FK | no | raw snapshot |
| video_pk | INTEGER FK | yes | effective stable video, if available |
| author_pk | INTEGER FK | yes | top-level stable author, if available |
| video_id_raw | TEXT | no | `video.id` unchanged |
| canonical_url | TEXT | no | `video.canonicalUrl` |
| title | TEXT | no | `video.title` |
| description | TEXT | no | `video.description` |
| published_at | TEXT | no | `video.publishedAt` unchanged |
| published_date | TEXT | no | `video.publishedDate` unchanged |
| region_code | TEXT | no | `video.regionCode` |
| duration | REAL | no | `video.duration` |
| view_count | INTEGER | no | `stats.viewCount` |
| like_count | INTEGER | no | `stats.likeCount` |
| comment_count | INTEGER | no | `stats.commentCount` |
| share_count | INTEGER | no | `stats.shareCount` |
| favorite_count | INTEGER | no | `stats.favoriteCount` |

Fields not listed remain raw-only in v2.

## snapshot_comment_observations

Every raw `comments.items[i]` gets one row. No dedupe.

| column | type | null | mapping |
|---|---|---:|---|
| observation_id | INTEGER PRIMARY KEY | no | internal |
| snapshot_id | INTEGER FK | no | raw snapshot |
| source_index | INTEGER | no | zero-based `i` |
| comment_pk | INTEGER FK | yes | stable comment master if available |
| level | INTEGER | no | `level` |
| comment_id_raw | TEXT | no | `commentId` unchanged |
| video_id_raw | TEXT | no | `videoId` unchanged |
| parent_comment_id_raw | TEXT | no | `parentCommentId` unchanged |
| username | TEXT | no | `username` unchanged |
| handle | TEXT | no | `handle` unchanged |
| user_id_raw | TEXT | no | `userId` unchanged; no user master |
| comment_text | TEXT | no | `comment` unchanged |
| posted_at | TEXT | no | `postedAt` unchanged |
| created_at | TEXT | no | `createdAt` unchanged |
| posted_date | TEXT | no | `postedDate` unchanged |
| like_count | INTEGER | yes | `likeCount` |
| reply_count | INTEGER | yes | `replyCount` |

`UNIQUE(snapshot_id, source_index)`.

`avatarUrl` and `createTime` are raw-only in v2.

## indexes

Required explicit index beyond UNIQUE-generated indexes:

```sql
CREATE INDEX idx_snapshot_comment_observations_comment
  ON snapshot_comment_observations(comment_pk);
```

Do not add broad 5-field indexes in v2 unless profiling establishes a need.
