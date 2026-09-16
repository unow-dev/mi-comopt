# TikTok Filter Keywords Demo

Comment DBの業務フローを、実DBとは分離されたdemo DBで再生するための独立した実行単位です。

## 起動

```bash
cd demo
npm install
npm run demo
```

引数なしでは、4件のコメント・3件の分類済みkeywordからなる合成fixtureをdemo DBへ作成します。実行ごとに`demo/var/run-*/`へDBとmaterialized artifactを出力します。

実DBに近いデータで再生する場合は、実DBをread-onlyのコピー元として指定します。

```bash
npm run demo -- \
  --source-db ../var/comment-history.sqlite3
```

`--source-db`のDBは読み取り専用で検査・コピーされ、demo処理から直接変更されません。`--db`で出力先を指定できますが、既存ファイルの上書きは拒否します。

## 再生する業務フロー

```text
Evidence
  → Corpus
  → Classification
  → Keyword Selection
  → Account Candidate（派生）
  → Release / materialize
  → Production Promotion
  → Deployment
```

公開Work Orchestratorへrevision 2の定義を登録し、Application Service Agent AdapterでComment DBのApplication Serviceを実行します。PromotionのHuman Taskはdemo用の`demo-reviewer`が承認します。Deployment完了eventはComment DBのoutboxからWork Orchestratorへ配送します。

成功条件は、Sessionが`completed`、業務結果が`deployed`、Deployment Requestが`succeeded`、outboxのpending件数が0になることです。

## 依存関係

demoはこのworkspace内の`../package`を`tiktok-filter-keywords`として、`../../work-orchestrator/package`を`work-orchestrator`として参照します。業務ロジックと公開Orchestrator定義は本体実装を利用し、demo固有のfixture・adapter・artifact builderだけをこのディレクトリに持ちます。

demoは本番Cutoverを実行しません。出力されたDBとartifactを確認した後に削除できる、一時的な検証環境として扱います。
