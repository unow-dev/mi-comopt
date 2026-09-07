# Decisions

## D1. Ownership and dependency direction

**Adopted:** wrapper parsing and mapping belong to Collector responsibility. Database receives only generic `{ payloadBytes, inputFormat, snapshots }`. Processing must not import wrapper-specific code.

**Rejected:** adding a `new-comments.json` parser to Database or Processing.

## D2. Input format identity

Use exactly:

`inputFormat = "tiktokNewCommentsWrapper-1.0.0"`

The payload has no embedded version marker. V1 is selected explicitly by the caller and enforced by V1 shape validation. Do not claim semantic-version detection beyond shape compatibility.

## D3. Wrapper strictness

The supplied real file has one stable keyset for all 8 items and one stable keyset for all 2,677 comments. Adopt a strict V1 object contract (`additionalProperties: false`) at root and nested object levels.

Arrays whose element structure is not exercised by the supplied data (`hashtags`, `hashtagDetails`, `mentions`, `effects`, `stickers`, `video.labels`, `video.tags`) remain arrays with opaque element schema (`items: {}`). Do not invent element contracts.

## D4. Empty wrapper vs empty snapshot

- root `items: []` → reject; generic `importRawInput` currently requires at least one snapshot.
- `item.comments.items: []` → accept if `loadedCount === 0`.

## D5. Ordering and duplicates

- wrapper `items[i]` → snapshot index `i`.
- `comments.items[j]` → source index `j`.
- no sorting.
- no dedupe, even for byte-/field-identical observations.

## D6. Raw bytes

Store the exact original wrapper bytes once as `payloadBytes`. Never serialize items separately to produce stored raw payloads.

## D7. Counts

- map `loadedCount` from `item.comments.loadedCount` unchanged.
- require `loadedCount === item.comments.items.length`.
- map `reportedCount` from `item.comments.reportedCount` unchanged, including `null`.
- do not derive/fill `reportedCount` from `stats.commentCount`, `loadedCount`, or array length.
- no invariant is added between `reportedCount` and `stats.commentCount`; equality in four observed items is evidence, not a defined semantic contract.

## D8. Coverage

`coverageNote = item.comments.note` exactly. It is present as a string in all 8 supplied items. No fallback is needed or allowed.

## D9. IDs

Effective video ID follows the existing legacy rule: collect non-empty `item.video.id` and all non-empty `comment.videoId`; zero distinct IDs → `externalVideoId = null`, one → that ID, more than one → reject.

- `externalAuthorId = null` only when `item.author.id === ""`; otherwise use the source value.
- `externalCommentId = null` only when `comment.commentId === ""`; otherwise use the source value.
- raw ID fields retain the exact source strings.

Do not trim, normalize, or synthesize IDs.

## D10. Nullability

The real wrapper proves legitimate `null` values for exactly seven fields that currently have non-null generic DTO/DB constraints:

- snapshot `reportedCount`
- video `duration`
- video stats `viewCount`, `likeCount`, `commentCount`, `shareCount`, `favoriteCount`

Adopt narrow nullable support for these seven. Do not convert null to zero.

Other DTO fields keep their current constraints unless implementation encounters evidence outside the supplied fixture; that is a blocker requiring a contract decision, not an adapter fallback.

## D11. Normalization

Forbidden in the adapter:

- `.trim()`
- Unicode normalization
- date parsing/reformatting
- `value ?? ""`
- `value ?? 0`
- unrelated-field fallback chains

Map source values verbatim except for the explicit external-ID projection above.

## D12. Atomicity

Validate and map the complete wrapper first. Only then call `importRawInput` once. Any invalid item rejects the whole input and must leave no partial DB materialization.
