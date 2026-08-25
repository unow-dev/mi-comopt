# 3-Class Labeling Handoff v1.0.0

更新版データを、前回と同じ考え方で `direct_nuisance / reactive / normal` に再分類するための handoff パッケージです。

## 最重要事項

この handoff は **stage13 相当の上流データに `normal / nuisance` が既に付いていること**を前提にします。

前回の一次再分類は、21,433件をゼロから3分類した処理ではありません。実態は次の変換です。

```text
元 nuisance + reactive 文脈あり -> reactive
元 nuisance + reactive 文脈なし -> direct_nuisance
元 normal   + reactive 文脈あり -> reactive
元 normal   + reactive 文脈なし -> normal
```

`normal -> direct_nuisance` は互換モードでは自動実行しません。

## なぜレビュー工程が必要か

前回報告値は:

- direct_nuisance: 521
- reactive: 1,054
- normal: 19,858

でした。

一方、復元できた42個の reactive 語だけを機械的に適用すると:

- direct_nuisance: 520
- reactive: 1,096
- normal: 19,817

になります。

前回は reactive 候補から **元normal 41件、元nuisance 1件**を除外していましたが、その完全な例外コードは復元できません。

したがって本 handoff は、その42件を推測でハードコードせず、

1. 自動一次分類
2. 混在・曖昧ケースの review queue 作成
3. 同一の意味基準でレビュー
4. override を適用して確定
5. 検証

という再現可能な手順に固定しています。

## ディレクトリ

```text
config/
  policy.json
  reactive_terms.json
  review_cues.json

src/
  label_comments.py
  validate_labels.py

tests/
  regression_cases.json
  run_tests.py

templates/
  manual_overrides.csv

prompts/
  REVIEW_PROMPT.md

reference/
  LABELING_SPEC.md
  RUNBOOK.md
  BASELINE_AUDIT.md
  CHANGE_CONTROL.md
  REFERENCE_EXAMPLES.md
```

## Quick start

Python 3.9+、外部ライブラリ不要です。

### 1. 回帰テスト

```bash
python tests/run_tests.py
```

### 2. 一次分類

```bash
python src/label_comments.py INPUT.json --outdir output
```

以下が生成されます。

```text
output/labeled_provisional.json
output/review_queue.csv
output/review_queue.json
output/summary.json
output/manual_overrides.csv
```

### 3. review_queue を判定

`prompts/REVIEW_PROMPT.md` と `reference/LABELING_SPEC.md` に従い、
`manual_overrides.csv` の `label` と `note` を埋めます。

### 4. override を適用して再実行

```bash
python src/label_comments.py INPUT.json \
  --outdir output_final \
  --overrides output/manual_overrides.csv \
  --strict-final
```

P0/P1 の未解決レビューが残っていれば `--strict-final` は失敗します。

### 5. 検証

```bash
python src/validate_labels.py output_final/labeled_provisional.json --require-resolved
```

## 判定の根本原則

### direct_nuisance

投稿者本人・投稿そのものに対する一次的な迷惑行為。

例:
- 直接的な侮辱・嘲笑
- 性的対象化・性的要求
- 不適切な身体要求
- スパム
- 一方的なフォロー/DM誘導

### reactive

アンチ、批判、誹謗中傷、荒れたコメント欄などが先に存在することを前提に発生する二次反応。

例:
- 投稿者の擁護
- アンチへの反論
- アンチへの攻撃
- コメント欄が荒れていることへの言及
- 開示請求、通報、ブロック等への言及

### normal

上記のどちらでもない通常コメント。

## 混在ケースの優先順位

意味判定では:

```text
direct_nuisance > reactive > normal
```

ただし「アンチ」という単語を含むだけで direct_nuisance を打ち消してはいけません。

例:

```text
アンチする奴キモい
-> reactive

アンチ＝嫉妬は無理ある。本人のぶりっ子は痛いと思う
-> 投稿者への直接否定を自身の意見として述べるため direct_nuisance 寄り
-> review 必須
```

## 絶対にしないこと

- キーワード1語だけで最終意味ラベルを確定しない。
- `きつい / 痛い / 無理 / ぶりっ子 / アンチ` を単独禁止語として意味分類しない。
- ユーザー名やハンドルでラベルを変えない。
- 過去投稿履歴でラベルを変えない。
- 上流 `normal` を勝手に `direct_nuisance` へ大量変換しない。
- 前回の「41+1例外」を想像で再現しない。
- 件数を前回値へ合わせることを目的化しない。

## バージョン管理

判定基準・語彙・例外を変更した場合は必ず `reference/CHANGE_CONTROL.md` に記録し、
`config/policy.json` の `policy_version` を更新してください。
