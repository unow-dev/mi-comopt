# ダッシュボード実装 handoff

このbundleは、ダッシュボードページのデザイン正本を実装作業者へ引き渡すための最終handoffです。

## 最初に読む順序

1. `docs/dashboard-design-spec.md` — **実装上の正本**
2. `docs/implementation-guide.md` — 現行コードへの接続方法と変更ポイント
3. `docs/acceptance-tests.md` — 完了判定とテストマトリクス
4. `docs/final-decisions.md` — 最終採択事項と、明示的に撤回された旧案
5. `references/` — 元issue、ラフ画像、議論時点の参照ソース

## 正本の優先順位

実装時に資料が食い違う場合は、次の順序で判断してください。

1. 公開データ契約・治安指数計算ロジック
2. `docs/dashboard-design-spec.md`
3. `docs/acceptance-tests.md`
4. 現行実装
5. ラフ画像・元issueの説明

ラフ画像は方向性を示す参考資料であり、画像内の数値・文言・配置を確定仕様として扱わないでください。

## このhandoffで固定している重要事項

- 現行ホームを「ダッシュボード」に置き換える。
- ホームの分析期間は **7日 / 30日**。初期値は7日。
- ホーム表示のために取得するartifactは **overviewのみ**。
- フィルター候補件数・ブロック候補件数はrelease manifestの `record_count` を使う。
- ホーム表示を理由に `keywords` / `accounts` / `comments` artifactを先読みしない。
- 「今日」「リアルタイム」という表現は使わない。
- 正式なマスコット画像は今回の実装条件にしない。
- 既存の治安指数算式、評価閾値、artifact schemaは変更しない。

## スコープ

このhandoffは実装作業者がダッシュボード実装へ着手するための仕様です。コンポーネント名・ファイル分割・hooksの切り方など内部構造は拘束しません。ただしユーザー可視の意味・状態・操作・データ解釈は正本どおりにしてください。
