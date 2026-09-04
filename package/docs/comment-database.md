# コメントデータベースMVP

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

実データの運用開始前に、取得元サービスの利用規約、プライバシー要件、保存内容に適した保持方針を人間が確認・決定してください。コメント本文や投稿参照だけでも個人情報を含む、または明らかにする可能性があります。
