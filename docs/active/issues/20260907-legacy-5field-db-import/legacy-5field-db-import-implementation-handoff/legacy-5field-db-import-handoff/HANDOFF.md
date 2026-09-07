# Implementation Handoff: `tiktokCommentBatch-1.0.0`

## 0. ゴール

旧5-field raw JSON:

```json
[
  {
    "username": "...",
    "handle": "...",
    "comment": "...",
    "postedAt": "...",
    "postedDate": "..."
  }
]
```

を、出所・video ID・収集時刻等の存在しない値を推測せず、現行と同じgeneric

```js
{ payloadBytes, inputFormat, snapshots }
```

境界からComment DBへ原子的・冪等に保存し、既存のread/Processingからexact five-field analysis recordsとして利用できるようにする。

順序と重複は入力arrayどおり保持する。

---

## 1. Frozen decisions

### 1.1 入力format

新しいversioned collector input format:

```text
tiktokCommentBatch-1.0.0
```

永続的な契約名に `legacy` や `5field` は使わない。

Collector側constant:

```js
export const COMMENT_BATCH_INPUT_FORMAT = "tiktokCommentBatch-1.0.0";
```

### 1.2 generic DTO discriminator

`snapshots[]` はstrict discriminated unionにする。

```text
rich-snapshot
comment-batch
```

field名:

```js
materializationKind
```

`materializationKind` は必須。省略時をrichとみなすfallbackは作らない。

Top-levelの `snapshots` という既存名は変更しない。`materializations` への全面renameはissue外。

### 1.3 Databaseのgeneric性

Databaseは `inputFormat` で保存戦略をswitchしてはいけない。

正:

```js
switch (snapshot.materializationKind) { ... }
```

誤:

```js
if (request.inputFormat === "tiktokCommentBatch-1.0.0") { ... }
```

TikTok固有知識はCollector contract/adapterに閉じる。`comment-batch` DTOの`platform`はgeneric Databaseでは「non-empty string」とだけ検証する。公式comment-batch adapterは `platform: "tiktok"` を出す。

1 raw input内で異なる`materializationKind`が混在してもgeneric importerは拒否しない。各要素を独立検証する。公式adapterが現状混在を生成しないだけである。

---

## 2. Collector input contract

### 2.1 Schema

新規:

```text
contracts/collector-inputs/tiktokCommentBatch-1.0.0.schema.json
```

JSON Schema draft 2020-12。rootはarray。`minItems`は設定しない（`[]`を許可）。

各element:

- type: object
- `additionalProperties: false`
- required exact keys:
  - `username`
  - `handle`
  - `comment`
  - `postedAt`
  - `postedDate`
- 全5値 type `string`

追加の`format`制約は付けない。特に`postedAt`/`postedDate`を日時としてvalidateしない。

次をそのまま許可する。

- `""`
- whitespace-only
- opaque date/time strings
- Unicode strings
- duplicate records

次を行わない。

- trim
- Unicode normalization
- date parse / normalization
- dedupe
- missing-value補完

### 2.2 Contract module

新規:

```text
src/collector/comment-batch/comment-batch-contract.js
```

`src/collector/new-comments-wrapper/new-comments-wrapper-contract.js` と同じ責務・実装様式を使う。

公開APIの目安:

```js
export const COMMENT_BATCH_INPUT_FORMAT = "tiktokCommentBatch-1.0.0";
export const COMMENT_BATCH_SCHEMA_PATH = ...;
export class CommentBatchContractError extends Error { ... }
export function validateCommentBatch(payload) { ... }
export function parseAndValidateCommentBatchBytes(bytes) { ... }
```

error codeはcontract validationでは既存様式どおり:

```text
VALIDATION_ERROR
```

UTF-8は `TextDecoder("utf-8", { fatal: true })` で厳格にdecodeする。invalid UTF-8 / invalid JSON / schema failureはpersistent write前に失敗させる。

### 2.3 Adapter

新規:

```text
src/collector/comment-batch/comment-batch-adapter.js
```

root array全体を**必ず1つ**のcomment-batch materializationへ変換する。

```js
{
  payloadBytes: Buffer.from(bytes),
  inputFormat: COMMENT_BATCH_INPUT_FORMAT,
  snapshots: [{
    materializationKind: "comment-batch",
    platform: "tiktok",
    loadedCount: payload.length,
    comments: payload.map((item) => ({
      username: item.username,
      handle: item.handle,
      commentText: item.comment,
      postedAt: item.postedAt,
      postedDate: item.postedDate,
    })),
  }],
}
```

`[]` の場合も:

```text
snapshots.length = 1
loadedCount = 0
comments.length = 0
```

元データにsnapshot境界がないため、推測して分割しない。

---

## 3. Generic DTO v5 contract

現行 `src/database/comment-database.js` の `validateSnapshotDto()` をkind dispatchにする。

推奨構造:

```js
function validateSnapshotDto(snapshot, snapshotIndex) {
  // record + discriminator確認
  switch (snapshot.materializationKind) {
    case "rich-snapshot":
      return validateRichSnapshotDto(snapshot, snapshotIndex);
    case "comment-batch":
      return validateCommentBatchDto(snapshot, snapshotIndex);
    default:
      throw validationError(...);
  }
}
```

### 3.1 Rich DTO exact shape

現行rich shapeに `materializationKind` を1 field追加する。それ以外の意味は変更しない。

```js
{
  materializationKind: "rich-snapshot",
  platform,
  extractedAt,
  sourcePageUrl,
  sourceCanonicalUrl,
  itemSource,
  loadedCount,
  reportedCount,
  coverageNote,
  video,
  comments,
}
```

rich snapshot/video/commentの現行validationは維持する。

既存rich DTO producer両方を更新:

- `src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js` の `mapItemToSnapshotDto()`
- `src/database/comment-database.js` の `mapTikTokSnapshotToDto()`

どちらも:

```js
materializationKind: "rich-snapshot"
```

を明示する。

### 3.2 Comment-batch DTO exact shape

```js
{
  materializationKind: "comment-batch",
  platform: <non-empty string>,
  loadedCount: <safe integer >= 0>,
  comments: [ ... ]
}
```

exact keysのみ。

各comment:

```js
{
  username: <string>,
  handle: <string>,
  commentText: <string>,
  postedAt: <string>,
  postedDate: <string>,
}
```

exact keysのみ。

共通semantic:

```text
loadedCount === comments.length
```

`loadedCount`はsafe integerかつ`>= 0`。

rich-only fieldをDTOへ `null` で足さない。存在しない値はDTOにも存在させず、Database persistence boundaryでNULLへ写す。

---

## 4. DB schema v5

### 4.1 Version

```js
APPLICATION_SCHEMA_VERSION = 5
```

migration新規:

```text
db/comment-database/005-comment-batch-materialization.sql
```

既存migration命名・legacy helperのrenameは行わない。

### 4.2 `raw_snapshots`

新field:

```sql
materialization_kind TEXT NOT NULL
CHECK (materialization_kind IN ('rich-snapshot', 'comment-batch'))
```

`platform`は従来どおりnon-empty text。

`loaded_count`には明示的に:

```sql
CHECK (loaded_count >= 0)
```

を付ける。

次をnullable化:

```text
extracted_at
source_page_url
source_canonical_url
item_source
coverage_note
```

`reported_count`はv4ですでにnullableなのでそのまま。

kind-specific CHECKの意味を以下に固定する。

#### `rich-snapshot`

```text
extracted_at          IS NOT NULL
source_page_url       IS NOT NULL
source_canonical_url  IS NOT NULL
item_source           IS NOT NULL
coverage_note         IS NOT NULL
reported_count        NULL可（v4 semantics維持）
```

#### `comment-batch`

```text
extracted_at          IS NULL
source_page_url       IS NULL
source_canonical_url  IS NULL
item_source           IS NULL
reported_count        IS NULL
coverage_note         IS NULL
```

`comment-batch`に対して`platform='tiktok'`のSQL CHECKは入れない。

### 4.3 `snapshot_comment_observations`

共通5-fieldは引き続き`NOT NULL`:

```text
username
handle
comment_text
posted_at
posted_date
```

rich-only 6 fieldsをnullable化:

```text
level
comment_id_raw
video_id_raw
parent_comment_id_raw
user_id_raw
created_at
```

row-local CHECKとして、上記6 fieldは:

```text
all IS NULL
OR
all IS NOT NULL
```

のみ許可する。

既存の `comment_pk`, `like_count`, `reply_count` はrichでもnullableなので、このall-or-none groupには含めない。

親snapshotのkindとの一致はSQL CHECKではなくrepository verificationで保証する。

### 4.4 `snapshot_video_observations`

列定義のnullable semanticsはcomment-batch用に変更しない。

`comment-batch`ではrowを**挿入しない**。

`PRIMARY KEY(snapshot_id)` により1 snapshotあたりvideo observationは最大1行。したがってcanonical representationへvideo countを新規fieldとして追加する必要はない。

### 4.5 Migration semantics

v4の全 `raw_snapshots` rowは:

```text
materialization_kind = 'rich-snapshot'
```

として移行する。

理由: v4 schema自体がrich-only snapshot metadataとvideo observationを前提にしているため。

`raw_snapshots` rebuildでFK親を差し替えるため、現行migration patternに合わせchild tablesもrebuildする。少なくとも:

```text
raw_snapshots_v5
snapshot_video_observations_v5
snapshot_comment_observations_v5
```

を作成 → copy → old children → old parent drop → rename → index再作成 → `PRAGMA user_version = 5`。

既存dataを失わないこと。

---

## 5. Persistence semantics

`insertRawInputMaterialization()` をkind-awareにする。

### 5.1 `rich-snapshot`

現行v4 behaviorを維持する。

- raw snapshot row insert
- video master: external IDがある場合get-or-create
- author master: external IDがある場合get-or-create
- video observation exactly 1 row
- comment master: videoPk + externalCommentIdがある場合get-or-create
- comment observationをsource orderでinsert

### 5.2 `comment-batch`

raw snapshot row:

```text
materialization_kind = 'comment-batch'
platform = DTO platform
snapshot_index = snapshots[]内index
extracted/source/item/reported/coverage = NULL
loaded_count = DTO loadedCount
```

次は**生成しない**:

```text
snapshot_video_observations row
videos master row
authors master row
comments master row
```

各comment observation:

```text
snapshot_id       = current snapshot
source_index      = input comments array index
comment_pk        = NULL
level             = NULL
comment_id_raw    = NULL
video_id_raw      = NULL
parent_comment_id_raw = NULL
username          = DTO username
handle            = DTO handle
user_id_raw       = NULL
comment_text      = DTO commentText
posted_at         = DTO postedAt
created_at        = NULL
posted_date       = DTO postedDate
like_count        = NULL
reply_count       = NULL
```

値を推測・変換しない。

duplicate recordは別observationとして全件保存する。

---

## 6. Idempotency / materialization comparison

raw identityは現行どおりexact bytes SHA-256。

現行error semanticsを維持:

```text
RAW_INPUT_CONFLICT
RAW_INPUT_MATERIALIZATION_CONFLICT
```

### 6.1 Internal canonical representation

公開DTOはstrict unionだが、比較用の内部canonical representationはsupersetでよい。

必須追加:

```text
materializationKind
sourceIndex (各comment)
```

DTO側comments:

```js
snapshot.comments.map((comment, sourceIndex) => ({ sourceIndex, ... }))
```

DB側comments:

```js
{ sourceIndex: Number(row.source_index), ... }
```

これにより`0,1,3`のようなindex破損をre-import比較でも検出できる。

### 6.2 `comment-batch` canonical expected

- rich snapshot metadata: `null`
- video: `null`
- external comment identity / rich-only comment fields: `null`
- 5-field値:そのまま
- `sourceIndex`: array index

DB側でbatch rowに誤って`comment_pk`等が紐づけばcanonical mismatchになるよう、LEFT JOIN由来identityも比較対象に残す。

### 6.3 Nullable numeric conversion

v5でnullableになるnumeric rich fieldに対し、次は禁止:

```js
Number(null) // => 0
```

必ずnull-preservingにする。

例:

```js
comment.level === null ? null : Number(comment.level)
```

### 6.4 `assertSameMaterialization`

現行の:

```js
if (actual.video === null || JSON.stringify(expected) !== JSON.stringify(actual)) ...
```

はkind-awareに変更する。`comment-batch`では`video === null`が正常なので、単純な`actual.video === null`拒否は削除する。

JSON canonical structures全体が一致することを判定する。

---

## 7. Repository / integrity

### 7.1 `readSelectedSnapshots()` public read model

`materialization_kind`をProcessing向けsnapshot objectへ追加しない。

Processingへは既存の:

```text
inputFormat
platform
extractedAt
sourcePageUrl
sourceCanonicalUrl
itemSource
loadedCount
reportedCount
coverageNote
```

を返し、comment-batchではunavailable metadataが`null`になるだけとする。

`materialization_kind`はDB import / idempotency / verifyの内部情報として使う。

### 7.2 Normal readのsource-index integrity

`readSnapshotObservations()` は現行のcount checkに加え、sorted rowsの各indexを確認する。

```js
rows.forEach((row, index) => {
  if (Number(row.source_index) !== index) throw integrityError(...);
});
```

これにより破損DBからanalysis artifactを生成しない。

### 7.3 `verifyRawInputs()`

verification queryでは`raw_snapshots.materialization_kind`を取得する。

共通:

```text
raw input bytes/hash/byte_length integrity
raw input parent exactly 1
observation count == loaded_count
source_index exactly 0..loaded_count-1
(payload_sha256, snapshot_index) unique
raw input has >=1 materialized snapshot
foreign_key_check clean
```

kind別:

#### rich-snapshot

```text
video observation count == 1
rich snapshot metadata present
all comment rich-only 6 fields NOT NULL
```

#### comment-batch

```text
video observation count == 0
unavailable snapshot metadata NULL
all comment rich-only 6 fields NULL
```

親kindとcomment row shapeの一致をここで強制する。

triggerやchild tableへの`materialization_kind`複製は行わない。

---

## 8. Processing / manifest

Analysis recordsは変更しない。

```js
ANALYSIS_INPUT_FIELDS = ["username", "handle", "comment", "postedAt", "postedDate"];
ANALYSIS_PROJECTION_VERSION = "1.0.0";
```

`readSelectedSnapshots()`から得たcomment-batchもrichも、同じprojectionへ流す。形式固有分岐をProcessingへ追加しない。

DB schema:

```js
DATABASE_SCHEMA_VERSION = 5;
```

Manifest schemaは:

```js
ANALYSIS_MANIFEST_SCHEMA_VERSION = 3;
```

へ上げる。

理由: v2/v4までは事実上stringだった以下がcomment-batchで`null`を取る公開値域変更になるため。

```text
extracted_at
source_canonical_url
coverage_note
```

manifestへ `materialization_kind` fieldは追加しない。provenanceは既存 `input_format` で表す。

comment-batch manifest entry例:

```json
{
  "payload_sha256": "...",
  "snapshot_index": 0,
  "input_format": "tiktokCommentBatch-1.0.0",
  "platform": "tiktok",
  "extracted_at": null,
  "source_canonical_url": null,
  "loaded_count": 24622,
  "reported_count": null,
  "coverage_note": null,
  "output_start_index": 0,
  "record_count": 24622
}
```

manifest key集合・orderingは現行を維持する。

---

## 9. CLI

新規filesystem adapter:

```text
scripts/adapters/comment-batch.js
```

`new-comments-wrapper.js`と同じpattern:

1. `readFile`
2. read failure → `CommentDatabaseError("INPUT_READ_FAILED", ...)`
3. `adaptCommentBatchBytes(bytes)`
4. `importRawInput(request, options)`

CLI command:

```bash
npm run comment-db -- import-comment-batch \
  --input current_raw.json \
  [--db path.sqlite3]
```

`scripts/comment-database.mjs`に:

- usage
- supportedCommands
- allowedOptions
- required `--input`
- dispatch

を追加。

stdoutは既存import-new-commentsと同程度の情報でよい。公開aliasは増やさない。

既存 `--snapshot-sha` / `--snapshot-ref` selection semanticsは変更しない。comment-batchは1 raw input → 1 materializationなので既存single-child SHA shorthandが自然に使える。

既存`resolveLegacySnapshotRefs`等のsymbol renameはこのissueでは行わない。

---

## 10. Architecture boundary

新comment-batch固有parser/contractをDatabase/Processingからimportしない。

推奨test強化:

```text
src/database/** と src/processing/** が src/collector/** をimportしない
```

少なくともcomment-batch moduleへの直接依存が存在しないことを保証する。

Databaseが知るのはgeneric `comment-batch` semanticsまで。

---

## 11. Error contract

新しい大規模error hierarchyは作らない。

Collector contract:

```text
CommentBatchContractError
code = VALIDATION_ERROR
```

filesystem:

```text
CommentDatabaseError("INPUT_READ_FAILED", ...)
```

generic DTO validation:

```text
CommentDatabaseError("VALIDATION_ERROR", ...)
```

raw conflict:

```text
RAW_INPUT_CONFLICT
RAW_INPUT_MATERIALIZATION_CONFLICT
```

DB corruption:

```text
DATABASE_INTEGRITY_ERROR
```

unexpected transactional import failure:

```text
IMPORT_FAILED
```

新規testではerror codeと有用なcontext pathを固定し、全文messageの句読点までAPI化しない。

---

## 12. Atomicity / idempotency

`importRawInput()`の現行`BEGIN IMMEDIATE` transaction boundaryを維持する。

comment-batch insert途中のfailure時:

```text
raw_inputs
raw_snapshots
snapshot_comment_observations
master tables
```

にpartial stateを残さない。

exact同一bytes + 同一input format + 同一materializationは`already-imported`。

byte-different JSONは別raw input。JSON formattingやproperty orderをcanonicalizeしてraw SHA identityにしない。

---

## 13. Do not do

次は禁止。

- `extractedAt = import time`
- source URL / video ID / IDs / levelをdummy値で補完
- unknownを`""`や`0`で表現
- `postedAt`から`createdAt`を推測
- duplicate dedupe
- legacy-only Processing/export path
- Databaseの`inputFormat` switch
- comment-batchにvideo/master identityを捏造
- rich DTO required fieldをnullableにして同じshapeへ押し込む
- `materializationKind`省略fallback
- unrelated legacy symbol rename/refactor
- private実データの反例を見てadapterで黙ってschema緩和

---

## 14. Re-open criteria

仕様を再オープンするのは次の2ケースだけ。

1. private 24,622-record JSONに、このcontractへ適合しない具体的データがある。
2. rich regressionを維持しつつv5を実装できない具体的schema/test矛盾が出た。

その際は、実例・失敗test・該当row shapeを添えて戻す。実装者判断で意味を補完しない。
