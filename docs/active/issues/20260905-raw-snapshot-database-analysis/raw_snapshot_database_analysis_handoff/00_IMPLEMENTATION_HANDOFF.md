# 実装handoff — raw snapshot拡張とデータベース起点の分析処理

## 1. 結論

本issueでは、新しいTikTok raw snapshot v1を**exact bytesの原本**として保存し、その内容をComment DB v2へ正規化する。後続処理へ渡す境界はSQLiteそのものではなく、明示指定されたsnapshotをDBから読み出して生成する**既存Stage13互換のexact 5-field JSON**と、そのprovenanceを持つmanifestとする。

既存の5-field rawとの統合、重複排除、Stage13へ渡す全量datasetの順序は `20260826-090119-current-incoming-raw-dataset-integration` issueの責務として残す。

## 2. 最終データフロー

```text
Collector / acquisition
  |
  | rich TikTok raw snapshot v1
  v
schema + semantic validation
  |
  +--> invalid: canonical raw storeにもDBにも書かない
  |
  v
exact-byte content-addressed raw store
  |   var/raw-snapshots/tiktok-v1/<sha256>.json
  v
Comment DB v2 normalization
  |
  v
DB read boundary
  |   explicit --snapshot-sha only
  v
new-comments.json            (exact 5-field array)
new-comments.manifest.json   (snapshot provenance / coverage / output SHA)
  |
  v
existing current+incoming integration issue
  |
  v
existing Stage13 and downstream workflows
```

## 3. 絶対に変えない契約

### 3.1 raw schema v1

添付の `raw-snapshot.schema.json` をv1契約のsingle source of truthとする。runtimeではdraft 2020-12対応validatorを使い、手書きの第二shape validatorを作らない。

追加semantic validationは次の2点だけ。

1. `comments.loadedCount === comments.items.length`
2. `video.id`と全commentのnon-empty `videoId`を集めたdistinct集合が2種類以上ならreject

`reportedCount`と`loadedCount`の大小関係は制約しない。count類、duration、level等にschemaにない`minimum`を追加しない。`postedAt`等にも独自日時validationを追加しない。

`extractedAt`はschemaの`format: date-time`だけを契約とし、DB都合で`Z`固定・3桁小数固定等へ狭めない。DBにはraw文字列をそのまま保存する。

### 3.2 exact byte identity

rich raw snapshotのSHAは**input fileのexact bytes**に対するSHA-256 lowercase hex。

- JSONの空白、property順、改行が違えば別snapshot
- v1 Comment DBの既存semantic canonical hashとは別概念
- invalid inputはcanonical `tiktok-v1/` raw storeへ保存しない

### 3.3 stable identity

空IDとは **exact `""`** を指す。trimしない。whitespace-onlyを勝手にempty扱いしない。

- video master: effective video IDがnon-emptyの場合のみ
- author master: top-level `author.id`がnon-emptyの場合のみ
- comment master: effective video IDと`commentId`が双方non-emptyの場合のみ
- comment `userId`: observation値として保持するがuser masterを作らない
- 本文、handle、username、hash等から疑似IDを生成しない

### 3.4 Stage13 5-field

DBからanalysis inputへ出す値はcomment observationの以下を**変換せず**使う。

```text
username   -> username
handle     -> handle
comment    -> comment_text
postedAt   -> posted_at
postedDate -> posted_date
```

trim、Unicode normalization、日時変換、補完、代表観測選択、dedupeをしない。

output recordはexactlyこの5キーのみ。

## 4. schema/migration

- `APPLICATION_SCHEMA_VERSION`: `1 -> 2`
- migrations: `001-init.sql`, `002-raw-snapshots.sql`
- v1 `imports` / `comment_observations` は変更・rename・再解釈しない
- v2はadditive migration
- v2 FKは`ON DELETE CASCADE`を付けず、親削除をfail-closedにする
- SQLite `STRICT`

v2 tables:

```text
raw_snapshots
videos
authors
comments
snapshot_video_observations
snapshot_comment_observations
```

exact columnsは `contracts/DB_V2_CONTRACT.md` を参照。

## 5. privacy boundary

normalized DBへ複製する個人関連情報を最小化する。

DBに入れるcomment由来値:

```text
commentId / videoId / parentCommentId
username / handle / userId
comment
postedAt / createdAt / postedDate
likeCount / replyCount / level
```

ただし`userId`はobservationのみでuser master化しない。

DBに入れないもの:

```text
comment avatarUrl
author username/nickname/signature/avatar/secUid/profile stats
music/media URLs
hashtags/details/effects/stickers
```

top-level authorについてDBに持つのはstable `author.id` identityだけ。プロフィールはraw原本に残る。

Stage13 export、candidate artifact、UIへ`commentId`、`userId`、DB PK等を出さない。

## 6. raw store

Default root:

```text
<repository>/var/raw-snapshots
```

DBにはabsolute pathを保存せず、次のrelative pathを保存する。

```text
tiktok-v1/<payload_sha256>.json
```

content-addressed targetの既存ファイルは上書き禁止。

- targetなし -> exact bytesをno-clobberでpublish
- targetあり、hash一致 -> reuse
- targetあり、hash不一致 -> `RAW_STORE_CORRUPT`

DB transactionがraw保存後に失敗し、未参照rawが残ることは許容する。逆向き（DB rowだけありrawがない状態）を通常importで作らない。

`/var/raw-snapshots/` をGitignoreする。

## 7. import transaction

```text
read input bytes
-> decode/parse/validate (bytes自体は変更しない)
-> exact-byte SHA
-> canonical raw file ensure
-> open DB / migrate
-> BEGIN IMMEDIATE
-> insert master/observation rows
-> COMMIT
```

同じexact SHAの再importはidempotent。early return前に最低限、DBの`loaded_count`とcomment observation countが一致することを確認し、不一致は`DATABASE_INTEGRITY_ERROR`。

## 8. export boundary

command:

```text
comment-db export-analysis-input \
  --snapshot-sha <sha> [--snapshot-sha <sha> ...] \
  --output <new-comments.json> \
  --manifest <new-comments.manifest.json> \
  [--db ...]
```

snapshot選択はexplicit SHAのみ。0件はCLI error。duplicate SHAもCLI error。DBにないSHAはruntime error。

snapshot順:

```text
payload_sha256 ASC
```

snapshot内:

```text
source_index ASC
```

CLI引数の指定順、DB import順、日時parser、timezoneに依存しない。

cross-snapshot dedupeは行わない。

JSON bytes:

```js
JSON.stringify(records, null, 2) + "\n"
```

UTF-8 / BOMなし / fixed key order。

manifest契約は `contracts/ANALYSIS_EXPORT_CONTRACT.md`。

## 9. raw integrity verification

`export-analysis-input`はDB-onlyでありraw storeを読まない。

rawとDBの整合確認は別command:

```text
comment-db verify-raw-store \
  [--snapshot-sha <sha> ...] \
  [--db ...] \
  [--raw-root ...]
```

SHA指定なしはv2 rich snapshots全件。

verify対象:

- expected relative path規則
- raw file existence
- exact file SHA == DB payload SHA
- comment observation count == loaded_count
- snapshot_video_observationsがsnapshotにつき1件

orphan raw fileはエラーにしない。verifyでrawをschema再validationしない（import時validation済みであり、hash一致がimmutabilityを証明する）。

## 10. CLI exit semantics

既存契約を維持する。

```text
0 success / help
1 input/schema/raw-store/DB/export integrity runtime error
2 CLI misuse
```

既存 `comment-db import --input ... [--db ...]` をそのまま維持する。

## 11. 実装PR分割

### PR1: write boundary

raw contract / validator / migration / raw store / import / verify / v1 regression。

### PR2: read boundary

DB query / pure 5-field projection / deterministic export / manifest / integration-boundary tests。

詳細はchecklists参照。

## 12. 本issueの非scope

- legacy 5-fieldをDBへimportする機能
- baseline bridge
- cross-snapshot dedupe
- commentId-aware output collapse
- Stage13 reference lookup
- latest snapshotの自動選択
- DB全snapshotの暗黙export
- label / keyword / account candidate / publication / UI変更
- raw retention/delete CLI
- user/account master統合

## 13. merge/close gate

- PR1 + PR2 merged
- `npm test` green
- v1 import behavior regressionなし
- v1 DB with rows -> v2 migrationでdata lossなし
- rich raw fixture -> exact raw store -> DB -> exact 5-field JSON + manifest成功
- outputがcurrent Stage13 exact 5-key validatorに受理される
- integration issueがJSON + manifestを新規側入力として利用可能
