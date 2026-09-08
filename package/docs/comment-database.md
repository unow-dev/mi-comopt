# コメントデータベース

このMVPは、collector固有の出力を直接解釈せず、正規化済みJSONのコメント観測をリポジトリ内SQLiteへ冪等に保存します。保存単位は一意なコメントではなく観測です。同じ内容が別payloadで再び観測された場合も重複排除しません。

## 入力

入力JSONのトップレベルは、`schemaVersion` と `observations` の2キーだけを持つ必要があります。`schemaVersion` は整数 `1`、`observations` は配列です。

```json
{
  "schemaVersion": 1,
  "observations": [
    {
      "source": "tiktok",
      "postRef": "post:example-001",
      "collectedAt": "2026-09-04T09:15:00+09:00",
      "commentText": "Example comment"
    }
  ]
}
```

観測オブジェクトも上記4キーだけを持つ必要があります。`source` と `postRef` は空白だけの文字列を指定できません。`commentText` は空文字列を含め、そのまま保存されます。文字列をtrim、大小文字変換、Unicode正規化、句読点除去などで変更することはありません。

`collectedAt` はタイムゾーン付きの `YYYY-MM-DDTHH:mm:ss[.SSS](Z|+HH:MM|-HH:MM)` 形式（小数秒は1〜3桁）に限定され、保存時は `Date#toISOString()` のUTC形式へ変換されます。

## CLI

```bash
npm run comment-db -- import --input path/to/normalized-comments.json
npm run comment-db -- import --input path/to/normalized-comments.json --db /tmp/comments.sqlite3
```

DBを指定しない場合は `<リポジトリルート>/var/comment-history.sqlite3` を使用します。migrationは実行場所（CWD）に依存せず、`package/db/comment-database/` から読み込まれます。DBとSQLiteのsidecarファイルはGit管理対象外です。

同じ正規化payloadを再投入すると成功扱いのno-opになります。payload hashは正規化後の観測tupleを並べ替えて計算するSHA-256であり、JSONの空白やプロパティ順、配列順には依存しません。ただし観測の重複数は保持されるためhashに影響します。

## SQLiteクエリ例

投稿・収集時刻で確認する例:

```sql
SELECT source, post_ref, collected_at, comment_text
FROM comment_observations
WHERE source = ? AND post_ref = ?
ORDER BY collected_at;
```

日別の観測数を集計する例:

```sql
SELECT substr(collected_at, 1, 10) AS day, COUNT(*) AS observations
FROM comment_observations
GROUP BY day
ORDER BY day;
```

コメント本文を通常のSQLite `LIKE` で検索する例:

```sql
SELECT source, post_ref, collected_at, comment_text
FROM comment_observations
WHERE comment_text LIKE '%' || ? || '%';
```

このDBの件数は観測件数であり、保証された一意コメント件数ではありません。FTS、filter判定、検出キーワード、ユーザー名・プロフィール情報、保持自動化はMVPに含みません。

collector固有の別形式やlegacy rawとの自動判別、legacy rawとのmerge/dedupe、Stage13 dataset生成、実データのrepository fixture化は対象外です。実データはlocal検証入力としてのみ扱い、raw本体をrepositoryへ追加しないでください。

## rich raw snapshot と Comment DB v5

`import-raw-snapshot` は、draft 2020-12 JSON Schemaに適合し、`loadedCount` と実際のitems数が一致し、動画IDの矛盾がないTikTok rich raw snapshotだけを受け付けます。`extractedAt`、コメント本文・ID・日時などのraw文字列は保存時にtrim、Unicode正規化、日時変換または補完を行いません。schemaにない独自の件数・日時制約も追加しません。

`import-new-comments` は、Collector側の厳格な `tiktokNewCommentsWrapper-1.0.0` contractで `new-comments.json` 全体をUTF-8・JSON・shape検証し、source順のrich snapshot DTO列へ変換してから、generic `importRawInput` を1回だけ実行します。wrapperのrootは `items` のみで、空wrapper、loadedCount不一致、item内の動画ID不一致、未知のobject keyは拒否します。`import-new-comments-wrapper` は同じ契約を明示的に選択するCLI aliasです。

`import-comment-batch` は `tiktokCommentBatch-1.0.0` contractでroot array全体をUTF-8・JSON・exact five-field shape検証し、必ず1つの `comment-batch` materializationへ変換します。`[]`、空文字、whitespace-only、opaqueな日時文字列、重複は有効で、trim、Unicode正規化、日時解析、欠損補完、dedupeは行いません。batchではvideo observation、video/author/comment masterを生成せず、取得不能なmetadataとrich-only comment fieldsを`NULL`で保存します。

元wrapperのbytesは再serializationせず、1つの `raw_inputs.payload_bytes` として保存します。`reportedCount`、videoの `duration` と5つの統計値はsourceの `null` を `null` のまま保存・読出しします。その他のrich metadataはraw bytesに保持し、generic DTOへ投影しません。

入力ファイルのexact bytesをSHA-256でcontent-addressし、SQLiteの`raw_inputs.payload_bytes`へBLOBとして原本保存します。JSONの再serializationは行いません。`raw_snapshots`と観測行はこのBLOBから得たmaterializationです。

```text
raw_inputs(payload_sha256, payload_bytes, byte_length, input_format, imported_at)
```

同じexact bytesの再importは、raw bytes・format・全materializationが一致する場合だけ冪等です。raw BLOBには取得元のプロフィール、avatar、media URLなども残りますが、正規化DBへ複製するのは契約で定めた観測値とidentity/coverage情報だけです。`userId`はコメント観測値であり、user masterは作成しません。

```bash
npm run comment-db -- import-raw-snapshot \
  --input path/to/tiktok-raw-snapshot.json \
npm run comment-db -- import-new-comments \
  --input path/to/new-comments.json \
npm run comment-db -- import-comment-batch \
  --input path/to/comment-batch.json \
npm run comment-db -- backfill-raw-inputs \
  --db path/to/comment-history.sqlite3 \
  --raw-root path/to/legacy-raw-snapshots
npm run comment-db -- verify-raw-inputs \
  [--snapshot-ref <64-lowercase-hex>:<snapshot-index>] \
  [--db path/to/comment-history.sqlite3]
```

`backfill-raw-inputs`のfilesystemはv2からの移行入力に限られ、通常のrich import/read/verifyはfilesystemに依存しません。分析exportもraw BLOBを再parseせず、DBの観測値だけを使います。

## 分析入力の読み取り境界

明示指定したsnapshot reference（`payload_sha256:snapshot_index`）だけをDBから読み出し、既存Stage13互換の5-field JSONとprovenance manifestを生成します。snapshotはSHA・snapshot index昇順、snapshot内の観測はsource index昇順で並び、cross-snapshot dedupeは行いません。richとcomment-batchは同じprojectionを使い、manifest schemaは3、projection versionは`1.0.0`を維持します。manifestへ`materialization_kind`は追加しません。

```bash
npm run comment-db -- export-analysis-input \
  --snapshot-ref <sha>:<snapshot-index> [--snapshot-ref <sha>:<snapshot-index> ...] \
  --output new-comments.json \
  --manifest new-comments.manifest.json \
  [--db path/to/comment-history.sqlite3]
```

出力レコードは`username`、`handle`、`comment`、`postedAt`、`postedDate`の5キーだけです。`commentId`、`userId`、DB内部ID、snapshot SHAなどのDBメタデータはレコードへ漏らしません。outputとmanifestはUTF-8、2スペース整形、末尾改行付きで、既存ファイルを上書きしません。manifestに生成時刻は含まれず、同じsnapshot集合からbyte-identicalに再生成できます。

## 3-class workset生成

明示したsnapshotだけを既存のanalysis projectionへ投影し、v1.5.0の`prepare-single-roundtrip`を変更せずに実行して、finalize可能なworkspaceとChatGPTへ渡すportable ZIPを生成します。`--reference`と`--workspace`、および`--snapshot-ref`または`--snapshot-sha`を1件以上指定してください。SHA selectorは一意に解決できる場合だけ受け付け、refとSHAの混在・重複・曖昧なSHAは拒否します。

```bash
npm run comment-db -- generate-three-class-workset \
  --snapshot-ref <sha>:<snapshot-index> \
  --reference path/to/stage13-reference.json \
  --workspace path/to/workspace \
  [--db path/to/comment-history.sqlite3] \
  [--state-dir path/to/integrated-labeling-state]
```

workspace内には既存pipelineの`request/`、`snapshot/`、`prepare_receipt.json`と、`README_FIRST.md`、`provenance/`、`workset_manifest.json`、`three_class_workset_<workset_id>.zip`が保持されます。ZIPにはREADME、`request/`全体、DB projectionのprovenance、workset manifestだけを含め、snapshotやinner handoff ZIPは含めません。既存workspaceの上書きは行わず、すべての検証とpackagingが成功した場合だけworkspaceを出現させます。

ZIPの`workset_id`はcontainer bytesではなく、`request_id`とtransport memberの相対POSIX path・SHA-256・byte lengthから計算されます。`request/`がclassificationのcanonical packageで、`provenance/`はlineage確認専用です。S/T taskがないzero-handoff worksetではclassification responseは不要です。

このissueの後続責務は、生成された`new-comments.json`とmanifestを現状データとの統合処理へ渡すことです。legacy 5-fieldとのmerge、dedupe、Stage13 dataset全体の順序、ラベル、候補、UIおよびraw retentionはこのDB境界の責務ではありません。

実データの運用開始前に、取得元サービスの利用規約、プライバシー要件、保存内容に適した保持方針を人間が確認・決定してください。コメント本文や投稿参照だけでも個人情報を含む、または明らかにする可能性があります。
