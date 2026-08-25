# RUNBOOK

## A. 更新データ受領時

### A-1. 入力確認

入力は JSON array を想定する。

各要素に最低限:

```json
{
  "comment": "...",
  "label": "normal"
}
```

が必要。

`label` は `normal` または `nuisance` でなければならない。

更新データに元ラベルがない場合、この handoff をそのまま適用してはいけない。
その場合は別途「ゼロからの3分類器」を設計する必要がある。

### A-2. 元ファイルを保全

入力原本を上書きしない。
チェックサムを保存する。

例:

```bash
sha256sum INPUT.json
```

## B. 回帰テスト

```bash
python tests/run_tests.py
```

テストが失敗した状態で本番データを処理しない。

## C. 一次分類

```bash
python src/label_comments.py INPUT.json --outdir output
```

### 出力

- `labeled_provisional.json`
- `review_queue.csv`
- `review_queue.json`
- `summary.json`
- `manual_overrides.csv`

## D. review_queue の処理

### D-1. P0

全件レビュー必須。

主に:

- アンチ文脈 + 投稿者への直接否定
- 引用か自身の主張か不明
- アンチへの攻撃と投稿者批判の混在

### D-2. P1

全件レビュー必須。

42語に入っていないが二次反応らしいケース。

### D-3. P2

通常更新では任意監査。

互換性維持のため、上流normalは自動でdirectへ動かさない。

もし P2 を direct_nuisance に変更するなら、
それは「旧基準再現」ではなく「上流ラベルの修正」を含むため、
変更理由を必ず記録する。

## E. overrides

`manual_overrides.csv`:

```csv
record_key,label,note
abc123...,reactive,アンチへの反論であり投稿者攻撃ではない
```

許可ラベル:

- direct_nuisance
- reactive
- normal

## F. 厳格再実行

```bash
python src/label_comments.py INPUT.json \
  --outdir output_final \
  --overrides output/manual_overrides.csv \
  --strict-final
```

P0/P1の未解決があれば終了コード2で停止する。

## G. 最終検証

```bash
python src/validate_labels.py output_final/labeled_provisional.json --require-resolved
```

## H. 保存すべきもの

更新ごとに以下を一緒に保存する。

1. 入力JSON
2. 入力SHA256
3. handoff version
4. reactive_terms.json
5. review_cues.json
6. manual_overrides.csv
7. summary.json
8. 最終ラベルJSON
9. 変更履歴

これにより後から同じ判断を監査できる。

## I. 件数差の扱い

前回件数へ無理に合わせない。

分布が変わった場合に確認すべきなのは:

- 上流 nuisance 比率が変わったか
- 新しいアンチ表現が増えたか
- reactive terms の未対応表現が増えたか
- P0/P1 が急増していないか

件数そのものをゴールにしない。
