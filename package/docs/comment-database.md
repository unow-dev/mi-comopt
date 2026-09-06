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

collector固有の変換adapterは本MVPの対象外です。実際のcollector出力からの変換では、取得元、投稿参照、実際の収集時刻、コメント本文の契約を確認し、値を推測・補完しないでください。詳細は `FOLLOW_UP_COLLECTOR_ADAPTER.md` を参照してください。

## rich raw snapshot v1 と Comment DB v2

`import-raw-snapshot` は、draft 2020-12 JSON Schemaに適合し、`loadedCount` と実際のitems数が一致し、動画IDの矛盾がないTikTok rich raw snapshotだけを受け付けます。`extractedAt`、コメント本文・ID・日時などのraw文字列は保存時にtrim、Unicode正規化、日時変換または補完を行いません。schemaにない独自の件数・日時制約も追加しません。

入力ファイルのexact bytesをSHA-256でcontent-addressし、次のraw storeへ原本として保存します。JSONの再serializationは行いません。

```text
<repository>/var/raw-snapshots/tiktok-v1/<payload-sha256>.json
```

同じSHAの再importは冪等です。保存先が存在する場合は上書きせず、保存済みbytesのSHAがpathnameと一致しなければ失敗します。raw storeには取得元のプロフィール、avatar、media URLなども残りますが、正規化DBへ複製するのは契約で定めた観測値とidentity/coverage情報だけです。`userId`はコメント観測値であり、user masterは作成しません。

```bash
npm run comment-db -- import-raw-snapshot \
  --input path/to/tiktok-raw-snapshot.json \
  [--db path/to/comment-history.sqlite3] \
  [--raw-root path/to/raw-snapshots]
npm run comment-db -- verify-raw-store \
  [--snapshot-sha <64-lowercase-hex>] \
  [--db path/to/comment-history.sqlite3] \
  [--raw-root path/to/raw-snapshots]
```

`verify-raw-store` はDBが参照するrawだけを検証し、孤立ファイルはエラーにしません。分析exportはraw storeを読まず、DBの観測値だけを使います。

## 分析入力の読み取り境界

明示指定したsnapshot SHAだけをDBから読み出し、既存Stage13互換の5-field JSONとprovenance manifestを生成します。snapshotはSHA昇順、snapshot内の観測はsource index昇順で並び、cross-snapshot dedupeは行いません。

```bash
npm run comment-db -- export-analysis-input \
  --snapshot-sha <sha> [--snapshot-sha <sha> ...] \
  --output new-comments.json \
  --manifest new-comments.manifest.json \
  [--db path/to/comment-history.sqlite3]
```

出力レコードは`username`、`handle`、`comment`、`postedAt`、`postedDate`の5キーだけです。`commentId`、`userId`、DB内部ID、snapshot SHAなどのDBメタデータはレコードへ漏らしません。outputとmanifestはUTF-8、2スペース整形、末尾改行付きで、既存ファイルを上書きしません。manifestに生成時刻は含まれず、同じsnapshot集合からbyte-identicalに再生成できます。

このissueの後続責務は、生成された`new-comments.json`とmanifestを現状データとの統合処理へ渡すことです。legacy 5-fieldとのmerge、dedupe、Stage13 dataset全体の順序、ラベル、候補、UIおよびraw retentionはこのDB境界の責務ではありません。

実データの運用開始前に、取得元サービスの利用規約、プライバシー要件、保存内容に適した保持方針を人間が確認・決定してください。コメント本文や投稿参照だけでも個人情報を含む、または明らかにする可能性があります。
