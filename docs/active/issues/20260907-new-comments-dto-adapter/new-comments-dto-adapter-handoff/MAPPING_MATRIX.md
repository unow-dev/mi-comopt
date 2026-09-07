# Mapping matrix

No fallback chains are permitted. Each target has exactly one authoritative source rule.

## Snapshot

| Target DTO | Wrapper source | Rule |
|---|---|---|
| `platform` | — | constant `"tiktok"` |
| `extractedAt` | `item.extractedAt` | exact string |
| `sourcePageUrl` | `item.source.pageUrl` | exact string |
| `sourceCanonicalUrl` | `item.source.canonicalUrl` | exact string |
| `itemSource` | `item.source.itemSource` | exact string, including `""` |
| `loadedCount` | `item.comments.loadedCount` | exact integer; must equal `item.comments.items.length` |
| `reportedCount` | `item.comments.reportedCount` | exact integer or `null` |
| `coverageNote` | `item.comments.note` | exact string |

## Video

| Target DTO | Wrapper source | Rule |
|---|---|---|
| `externalVideoId` | `item.video.id` + all `comment.videoId` | existing effective-video-ID rule |
| `externalAuthorId` | `item.author.id` | `"" → null`; otherwise exact source string |
| `videoIdRaw` | `item.video.id` | exact string |
| `canonicalUrl` | `item.video.canonicalUrl` | exact string |
| `title` | `item.video.title` | exact string |
| `description` | `item.video.description` | exact string |
| `publishedAt` | `item.video.publishedAt` | exact string; no date transform |
| `publishedDate` | `item.video.publishedDate` | exact string |
| `regionCode` | `item.video.regionCode` | exact string |
| `duration` | `item.video.duration` | exact finite number or `null` |
| `viewCount` | `item.stats.viewCount` | exact safe integer or `null` |
| `likeCount` | `item.stats.likeCount` | exact safe integer or `null` |
| `commentCount` | `item.stats.commentCount` | exact safe integer or `null` |
| `shareCount` | `item.stats.shareCount` | exact safe integer or `null` |
| `favoriteCount` | `item.stats.favoriteCount` | exact safe integer or `null` |

## Comment (`item.comments.items[j]`)

| Target DTO | Wrapper source | Rule |
|---|---|---|
| `externalCommentId` | `comment.commentId` | `"" → null`; otherwise exact source string |
| `level` | `comment.level` | exact safe integer |
| `commentIdRaw` | `comment.commentId` | exact string |
| `videoIdRaw` | `comment.videoId` | exact string |
| `parentCommentIdRaw` | `comment.parentCommentId` | exact string |
| `username` | `comment.username` | exact string |
| `handle` | `comment.handle` | exact string |
| `userIdRaw` | `comment.userId` | exact string |
| `commentText` | `comment.comment` | exact string |
| `postedAt` | `comment.postedAt` | exact string |
| `createdAt` | `comment.createdAt` | exact string |
| `postedDate` | `comment.postedDate` | exact string |
| `likeCount` | `comment.likeCount` | existing nullable integer behavior |
| `replyCount` | `comment.replyCount` | existing nullable integer behavior |

## Deliberately unmapped rich fields

The raw wrapper bytes preserve all fields. The DTO intentionally does not project fields such as `video.url/shareUrl/...`, author profile details, music, hashtags/effects/stickers, comment avatar/createTime, etc. Do not add DB columns for these as part of this issue.
