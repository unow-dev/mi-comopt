# P2 REVIEW PROMPT

P2 (`source_normal_direct_cue`) 専用のexact-caseレビュー補助。

目的はdirect cueの文字列一致をそのままラベル化することではなく、元`normal`を維持すべきか、`reactive`または`direct_nuisance`へ明示的に変更すべきかを意味で判断すること。

## 判定順

1. cueが別単語の部分文字列、自分自身への表現、身体的痛み、応援、技術的文脈、中立質問等なら `normal`。
2. cueが既存批判・アンチコメントの引用、反論、擁護、コメント欄への反応なら `reactive`。
3. 投稿者本人・投稿内容へ独立した否定、嘲笑、不適切要求、スパムを投稿者自身の意見として述べているなら `direct_nuisance`。
4. 文面だけで1〜3を高信頼に決められない場合は `defer`。件数合わせのために推測しない。

`username`, `handle`, `postedAt`, `postedDate`, 過去コメント履歴を根拠に使わない。

## 出力

```json
{
  "record_key": "...",
  "decision": "normal|reactive|direct_nuisance|defer",
  "reason_code": "confirm_normal|reactive_context|direct_target|spam_or_inappropriate_request|ambiguous",
  "rationale": "短い根拠"
}
```
