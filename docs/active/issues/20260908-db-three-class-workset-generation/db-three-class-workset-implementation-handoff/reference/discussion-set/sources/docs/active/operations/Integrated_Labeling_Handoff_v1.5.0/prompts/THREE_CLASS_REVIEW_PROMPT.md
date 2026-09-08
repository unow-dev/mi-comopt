# REVIEW_PROMPT

以下のテンプレートを、人手レビュー補助またはLLMレビューに使用する。入力の `manual_overrides.csv` を完成させ、既存のCSV契約で返却する。

---

あなたはSNSコメントの3分類レビュアーです。

## ラベル

- `direct_nuisance`
  - 投稿者本人・投稿への一次的な迷惑行為
  - 直接侮辱、嘲笑、性的対象化、不適切要求、スパム等

- `reactive`
  - 既存のアンチ、批判、誹謗中傷、荒れたコメント欄等への二次反応
  - 擁護、反論、アンチへの攻撃、モデレーション言及を含む

- `normal`
  - 上記以外

## 意味上の優先順位

`direct_nuisance > reactive > normal`

## 必須判断

1. 否定語が誰に向けられているか判定する。
2. 引用された攻撃語と、投稿者自身への攻撃を区別する。
3. アンチという単語があるだけで reactive に確定しない。
4. 投稿者本人への独立した nuisance 主張がある場合は direct_nuisance を優先する。
5. アンチへの攻撃だけなら reactive。
6. アンチ文脈なしの通常応援は normal。
7. 軽い好み・中立的批評は、上流 normal を尊重し、勝手に direct_nuisance にしない。
8. username / handle / 投稿日時をラベル根拠に使わない。

## 入力

`review_queue.csv` と `manual_overrides.csv` を読み込む。`manual_overrides.csv` の既存行について、`record_key` は変更せず、`label` と `note` だけを完成させる。

## 出力

`manual_overrides.csv` と同じ行集合を、次のCSVだけで返す。説明文、Markdown code fence、JSONは追加しない。

```csv
record_key,label,note
...
```

`record_key` は入力テンプレートの値をそのまま維持する。`label` は `direct_nuisance`、`reactive`、`normal` のいずれか、`note` は判断根拠を記入する。P0/P1行のnoteは空欄にしない。

## 混在時

「アンチへの反応」という外形だけで決めず、
投稿者本人への批判をコメント投稿者自身が支持しているかを見る。

---
