# raw snapshot拡張とデータベース起点の分析処理

## 目的

TikTokから取得するrich raw snapshot v1をexact bytesの原本として保存し、そのsnapshotをComment DB v2へ正規化して蓄積する。明示指定したDB snapshotを既存Stage13互換の5-field JSONへ決定的に射影する読み取り境界を設け、取得形式・DB実装・分析処理・UIの責務を分離する。

本issueは「rich raw -> raw保存 -> DB -> new/incoming 5-field artifact」までを所有する。既存5-fieldとの全量統合、重複処理、Stage13投入dataset構築は既存の「現状データと新規データの統合」issueへ残す。

## 決定事項

### raw snapshot v1

添付のdraft 2020-12 JSON Schemaをv1契約とする。runtime validationはJSON Schemaをsingle source of truthとして行い、手書きshape validatorを重複実装しない。

追加semantic validationは以下だけ。

- `comments.loadedCount === comments.items.length`
- top-level `video.id`と全commentのnon-empty `videoId`を集めたdistinct集合が2種類以上ならreject

`reportedCount`と`loadedCount`は一致を要求しない。schemaにないrange/date/trim制約を追加しない。

### raw原本

valid snapshotはinput fileのexact bytesのSHA-256でcontent-addressし、次へ保存する。

```text
var/raw-snapshots/tiktok-v1/<sha256>.json
```

JSONを再serializationしてから保存しない。同じ意味でもbytesが違えば別snapshot。invalid snapshotはcanonical raw storeにもDBにも書かない。

### Comment DB v2

既存v1 tablesと`comment-db import`は変更しない。`002-raw-snapshots.sql`をadditive migrationとして追加し、`PRAGMA user_version=2`とする。

追加tables:

```text
raw_snapshots
videos
authors
comments
snapshot_video_observations
snapshot_comment_observations
```

stable identityがない場合に疑似IDを作らない。

- effective video ID: non-empty `video.id` / comment `videoId`のdistinct値が0ならなし、1ならその値、2以上ならreject
- author: top-level `author.id`がnon-emptyの場合のみidentity master
- comment: effective video IDと`commentId`が双方non-emptyの場合のみidentity master
- comment `userId`: observationには保持するがuser masterを作らない

comment observationはsource arrayの全行を0-based `source_index`で保持し、dedupeしない。

### privacy/minimization

Stage13再処理に必要なcommentの`username`、`handle`等とstable ID/coverage/core video fieldsだけをDBへ正規化する。avatar、signature、secUid、author profile stats、music/media URL、hashtag details等はraw-onlyとする。author masterはidentityだけを持つ。

### DB読み取り境界

新command:

```text
comment-db export-analysis-input \
  --snapshot-sha <sha> [--snapshot-sha <sha> ...] \
  --output <new-comments.json> \
  --manifest <new-comments.manifest.json> \
  [--db ...]
```

snapshotは明示SHAのみ。implicit latest/all selectionをしない。snapshot順はSHA昇順、snapshot内は`source_index`昇順。

5-field mapping:

```text
username, handle, comment, postedAt, postedDate
```

raw由来文字列を変更せず、exactlyこの5キーだけを出力する。cross-snapshot dedupeをしない。

manifestにはprojection/schema version、output SHA/count、各snapshot SHA、raw schema version、extractedAt、canonical URL、loaded/reported count、coverage note、output rangeを記録する。生成時刻は入れず、同じsnapshot集合からbyte-identical artifactを生成する。

### raw integrity

`export-analysis-input`はDB-onlyで実行可能とする。raw storeの整合性は別command `comment-db verify-raw-store` で検証する。

検証項目:

- expected content-addressed path
- file existence
- exact SHA
- observation count == loaded_count
- snapshot video observation 1件

orphan raw fileはエラーにしない。

## CLI

既存:

```text
comment-db import --input ... [--db ...]
```

追加:

```text
comment-db import-raw-snapshot --input ... [--db ...] [--raw-root ...]
comment-db export-analysis-input --snapshot-sha ... --output ... --manifest ... [--db ...]
comment-db verify-raw-store [--snapshot-sha ...] [--db ...] [--raw-root ...]
```

exit codeは既存に合わせて0=success/help、1=runtime/data error、2=CLI misuse。

## レイヤー境界

```text
Collector -> raw store -> DB repository -> plain records -> pure projection -> artifact -> downstream
```

projection coreはSQLiteに依存しない。candidate workflowとUIはDBを直接参照しない。

## 実装分割

### PR1: write boundary

- raw schema runtime contract
- Ajv validator
- migration 002
- exact-byte raw store
- normalization/import
- raw integrity verification
- v1 regression

### PR2: read boundary

- selected-snapshot DB query
- pure 5-field projection
- deterministic JSON/manifest
- export CLI
- Stage13 boundary integration test

## 受入条件

- existing v1 import/hash/timestamp/duplicate/rollback behavior unchanged
- v1 DB with data migrates to v2 without data loss
- raw exact bytes are content-addressed and idempotent
- semantic-equivalent but byte-different raw is distinct
- invalid schema/loadedCount/video conflict never partially writes canonical raw+DB
- missing IDs never create guessed masters
- five source strings preserve exact content
- raw store corruption is detected by verify command
- export requires explicit snapshot SHA set
- export does no cross-snapshot dedupe
- same SHA set yields byte-identical JSON+manifest independent of CLI/import order
- export works without raw store mounted
- output is accepted by current Stage13 exact-five-key validation
- candidate/UI code requires no DB changes

## 非scope

- legacy 5-field DB migration/baseline import
- current+incoming merge/dedupe/order policy
- Stage13 reference reuse
- label/candidate/publication/UI changes
- auto latest/all snapshot selection
- raw retention/delete policy/CLI
- user/account identity merging
