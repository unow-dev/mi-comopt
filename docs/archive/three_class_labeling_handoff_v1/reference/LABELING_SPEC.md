# LABELING_SPEC

## 1. スコープ

この仕様は、上流で `normal / nuisance` の2値ラベルが付与されたコメントデータを、
`direct_nuisance / reactive / normal` の3値へ変換するための仕様である。

本仕様は法的な誹謗中傷判定ではない。
目的はコメントフィルター設計のために「一次 nuisance」と「それへの二次反応」を分離することである。

## 2. ラベル定義

### 2.1 direct_nuisance

投稿者本人、投稿内容、外見、行動、人格等に直接向けられた迷惑コメント、
または投稿者に対するスパム・不適切要求。

代表カテゴリ:

- 直接侮辱
- 嘲笑
- 嫌悪
- 人格否定
- 外見攻撃
- 年齢攻撃
- 投稿行為への嘲笑
- 性的対象化
- 性的要求
- 身体的要求
- フォロー強要
- DM誘導
- 無関係な長文コピペ
- その他の一次的フィルター対象

### 2.2 reactive

既存のアンチ、批判、誹謗中傷、荒れ、コメント欄等への二次反応。

以下を含む:

- 投稿者への擁護
- 投稿者への励まし（アンチ等が明示的前提の場合）
- アンチへの反論
- アンチへの攻撃
- 誹謗中傷者への非難
- コメント欄の荒れへの言及
- 通報、ブロック、開示請求等への言及
- 批判表現の引用
- 「嫌なら見なければよい」等のモデレーション的反応

`reactive` は「善良」「穏当」という意味ではない。
攻撃的なアンチ反撃も `reactive` である。

### 2.3 normal

`direct_nuisance` にも `reactive` にも該当しない通常コメント。

通常の応援・感想・質問・雑談・絵文字等を含む。

## 3. 意味上の優先順位

```text
direct_nuisance > reactive > normal
```

ただしこれは最終レビュー時の意味優先順位である。

互換モードの自動一次分類では上流ラベルを尊重するため、
`normal -> direct_nuisance` は自動では行わない。

## 4. 対象（誰への発言か）

否定語そのものより「誰を対象にしているか」を重視する。

### 投稿者が対象

```text
この人キモい
```

direct_nuisance。

### アンチが対象

```text
アンチしてる奴キモい
```

reactive。

### 否定語を引用して擁護

```text
きついとか言ってる人やめなよ
```

reactive。

### アンチ文脈なしの応援

```text
今日も可愛い。応援してます
```

normal。

## 5. 引用・否定・メタ言及

以下を区別する。

### 自身の評価

```text
この人は痛い
```

direct_nuisance 寄り。

### 否定

```text
この人は痛くない
```

「痛い」という文字列だけで direct_nuisance にしない。

### 引用

```text
「痛い」とか書いてる人多すぎ
```

reactive。

### 引用後に自身も同意

```text
アンチが痛いって言うのも分かる。自分も正直痛いと思う
```

direct_nuisance と reactive が混在。
最終意味優先順位により direct_nuisance を優先する候補。
必ずレビューする。

## 6. 上流ラベル依存

互換モードは以下を守る。

```text
nuisance -> direct_nuisance または reactive
normal   -> normal または reactive
```

`normal -> direct_nuisance` は自動禁止。

理由:
前回の一次再分類がこの構造を採用したため。

したがって、このデータは「完全にゼロから意味分類した3クラス教師データ」ではなく、
既存2値ラベルを構造分解したデータである。

## 7. 自動 reactive 検出

`config/reactive_terms.json` の語を、原文 `comment` に対して raw substring で検索する。

- case sensitive
- NFKC正規化なし
- 空白除去なし
- 改行変換なし

これは前回の一次処理との互換性を優先するためである。

フィルター語の統計分析で行う NFKC/lowercase 等とは別工程である。

## 8. Review queue

### P0: mixed_direct_reactive

条件:

- 元ラベル `nuisance`
- reactive term を含む
- direct cue も含む

理由:
投稿者への直接攻撃と、アンチ等への反応が混在する可能性が高い。

必ずレビュー。

### P1: possible_reactive_without_primary_term

条件:

- reactive term はない
- latent reactive cue がある

理由:
42語では拾えない反応文脈の可能性がある。

必ずレビュー。

### P2: source_normal_direct_cue

条件:

- 元ラベル `normal`
- direct cue を含む
- reactive term を含まない

理由:
上流 `normal` のままでよい軽い意見か、上流ラベル漏れかを監査できるようにする。

互換モードでは自動変更しない。
通常の更新作業では P2 は参考情報であり、全件再ラベルを明示的に行う場合のみ変更する。

## 9. 混在ケースの最終判定

次の順に問う。

1. 投稿者本人に対する独立した nuisance 主張を、コメント投稿者自身の意見として述べているか。
   - YES -> direct_nuisance
2. 主内容が既存アンチ・批判・コメント欄等への反応か。
   - YES -> reactive
3. それ以外。
   - normal

「アンチ」という語があるだけでは 1 を無効にしない。

## 10. 軽い否定意見

上流データでは軽い否定や好みの不一致が `normal` に残る場合がある。

したがって、

- タイプではない
- 少し狙いすぎに見える
- この演出は好みではない

等を直ちに direct_nuisance としない。

互換モードでは上流ラベルを維持する。

## 11. スパム

スパムは direct_nuisance に含める。

理由:
本タスクの direct_nuisance は「harassmentのみ」ではなく
「一次的に除去対象となる nuisance」である。

## 12. 利用しない情報

以下を自動判定に使わない。

- username
- handle
- postedAt
- postedDate
- フォロワー数
- 過去コメント履歴
- 返信構造
- 動画本文
- 動画キャプション
- いいね数
- 通報歴

## 13. 変更禁止事項

同一基準を維持したい期間は次を勝手に変更しない。

- reactive terms
- raw substring の照合方式
- normal->direct 自動禁止
- review priority 定義
- direct > reactive > normal の意味優先順位

変更する場合は policy version を上げ、CHANGE_CONTROLへ記録する。
