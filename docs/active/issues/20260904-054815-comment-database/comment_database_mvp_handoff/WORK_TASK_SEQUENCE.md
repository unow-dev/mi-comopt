# Work Task Sequence: コメントデータベースMVP

## Purpose

正規化されたコメント観測データを、Git管理から除外したリポジトリ内SQLiteデータベースへ安全かつ冪等に蓄積し、コメント検索、投稿・収集時刻ごとの確認およびフィルターキーワード検討に利用できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、実装仕様、受入条件、テスト計画、採択済み事項、対象外事項および各文書の正本を確認する。
- [x] 2. 実装前提の確認の範囲で、AIエージェントが、Node実行環境、既存のテスト・workspace構成、パッケージ境界およびSQLite組込み機能の利用可能性を確認する。
- [x] 3. スキーマとマイグレーションの実装範囲で、AIエージェントが、観測単位の永続化、外部キー保護、必要な索引、スキーマ版数管理および新しい版に対するfail-closed処理を実現する。
- [x] 4. 正規化入力の実装範囲で、AIエージェントが、version 1入力の厳格な検証、収集時刻のUTC正規化、文字列の非改変保持および正準payload hashの算出を実現する。
- [x] 5. インポート処理の実装範囲で、AIエージェントが、リポジトリ位置に依存しないDB・migration解決、既存payloadのno-op、1 payload単位の原子的保存および運用者向けエラー処理を実現する。
- [x] 6. 利用経路とGit保護の実装範囲で、AIエージェントが、workspace経由のCLI、可変SQLiteファイルのGit除外、入力・保存先・検索例・制約を説明する利用文書を整備する。
- [x] 7. 自動検証の実装範囲で、AIエージェントが、初期化、厳格な入力検証、時刻正規化、冪等性、重複観測、ロールバック、外部キー、CWD非依存性およびGit保護を確認できるテストを整備する。
- [x] 8. 受入検証の範囲で、AIエージェントまたはCIが、定義済みテスト、`npm test`、`npm run build` および受入条件の全項目を確認する。
- [ ] 9. 実データ投入の機能判断の範囲で、人間が、実際のcollector出力をversion 1正規化入力へ変換でき、期待どおりにインポート・再投入・検索できるかを判断する。
  - [ ] 9.1 collector出力の確認範囲で、人間が、各レコードから`source`、`postRef`、`collectedAt`、`commentText`を特定する。
  - [ ] 9.2 必須値の確認範囲で、人間が、4項目の欠損・曖昧値・推測値がないことを確認する。
  - [ ] 9.3 正規化入力の確認範囲で、人間が、トップレベルと観測オブジェクトをversion 1契約へ変換する。
  - [ ] 9.4 変換結果の確認範囲で、人間が、実際のcollector出力件数、観測順、文字列内容および収集時刻を照合する。
  - [ ] 9.5 初回保存の確認範囲で、人間が、検証用DBへ全payloadを投入し、import件数と観測件数を照合する。
  - [ ] 9.6 再投入の確認範囲で、人間が、同一payloadを再投入してno-opと行数不変を確認する。
  - [ ] 9.7 重複観測の確認範囲で、人間が、同一payload内および別payload間の重複が仕様どおり保持されることを確認する。
  - [ ] 9.8 検索結果の確認範囲で、人間が、source・postRef・collectedAt・commentTextによる期待結果を照合する。
  - [ ] 9.9 機能判定の範囲で、人間が、全確認項目を満たした場合だけ実データ投入を承認し、未達時は保留する。
- [x] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、未実施のcollector adapter作業および実データ運用上の注意点を記録する。

## Work Notes

- ベースラインは `2e63ce0`（`chore: comment database MVP baseline`）として、実装前の作業ツリーを記録した。
- Node `v24.19.0` の組込み `node:sqlite` を使用し、第三者SQLite依存は追加していない。
- `package/src/lib/comment-database.js`、`package/scripts/comment-database.mjs`、`package/db/comment-database/001-init.sql`、`package/tests/comment-database.test.js` および `package/docs/comment-database.md` を追加した。
- `npm test` は48件すべて成功し、`npm run build` と `git diff --check` も成功した。
- DB実装はcollector統合を含まない。実際のcollector出力からの変換は `FOLLOW_UP_COLLECTOR_ADAPTER.md` に従う別課題として扱い、必要な値を推測・補完しない。
- タスク9のスコープは機能面に限定する。利用規約、プライバシー、保持方針、セキュリティおよび法務判断は本タスクシーケンスの対象外とし、別途管理する。
- 実データを含むSQLite本体とsidecarはGit管理しない。
- タスク9の機能判定では、まず検証用DBを`--db`で明示し、リポジトリ既定DBへ直接投入しない。
- version 1入力の受入条件は、トップレベルが`schemaVersion`と`observations`のみ、各観測が`source`・`postRef`・`collectedAt`・`commentText`のみであることとする。
- 初回投入の期待結果は`imported payload=<64桁hex> observations=<入力件数>`、再投入の期待結果は`already imported payload=<同一hash> observations=<同一件数>`とする。
- 初回投入後は、`imports`が1行、`comment_observations`が入力件数行、`source_index`が0始まりであることを確認する。空payloadはimport 1行・観測0行とする。
- collector出力の必須値が欠ける、収集時刻がタイムゾーン付きでない、文字列内容が照合できない場合は、機能判定を保留し、値を推測して通過させない。
- 検証例: `npm run comment-db -- import --input /absolute/path/normalized-comments.v1.json --db /tmp/comment-db-functional-check.sqlite3`。保存後はNode組込みSQLiteで件数と検索結果を照合する。
