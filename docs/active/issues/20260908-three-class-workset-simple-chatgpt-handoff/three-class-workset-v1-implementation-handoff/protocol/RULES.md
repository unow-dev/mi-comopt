# Three-Class Labeling Rules — v1

## 1. Scope

Classify each supplied comment directly into exactly one of:

- `direct_nuisance`
- `reactive`
- `normal`

There is no upstream `normal / nuisance` label and no Stage13 dependency.

Use the comment text and the supplied workset only. Do not invent missing context.

## 2. Label meanings

### `direct_nuisance`

A **primary nuisance** statement: content that itself functions as a filter-worthy attack, humiliation, hostility, sexual objectification, exclusion demand, spam/solicitation, or comparable nuisance, and is not merely a reaction to existing criticism/attack.

The target does not have to be the original poster. The term `direct` means primary rather than reactive.

Typical forms include:

- direct insult or personal attack;
- ridicule, humiliation, or treating someone as a spectacle;
- strong contempt directed at a person or their overall behavior;
- attacks using appearance, body, age, ability, or similar traits;
- malicious assertions about motives or character;
- comparisons used to degrade a person's value;
- sexual objectification, fetishistic appraisal, or sexual demands;
- threats, violence, death wishes, or explicit hostile harm;
- demands intended to drive someone away or make them stop posting/activity;
- primary personal attacks on supporters or other third parties;
- clear spam, promotion, solicitation, DM/external-site inducement, or unrelated self-promotion.

Negative sentiment alone is not sufficient.

### `reactive`

A response to **existing criticism, anti behavior, attack, abuse, hostile comments, or comment-section conflict** that is apparent from the comment text itself.

Typical forms include:

- defending or encouraging the target in response to criticism;
- rebutting critics or antis;
- attacking critics/antis as part of that reaction;
- condemning abuse or defamatory/hostile comments;
- commenting on a hostile or chaotic comment section;
- suggesting reporting, blocking, disclosure/legal response, or moderation in reaction to abuse;
- quoting or referring to an attack in order to rebut, criticize, report, or discuss it;
- moderation-style responses such as “嫌なら見なければいい”.

`reactive` does not mean polite or benign. An aggressive counterattack against critics can still be `reactive`.

### `normal`

Any comment that is neither `direct_nuisance` nor `reactive`.

This includes ordinary support, impressions, questions, conversation, neutral facts, ordinary romantic/affectionate expressions, ordinary criticism, and preference disagreement.

## 3. Ordinary criticism vs nuisance

Do not classify a comment as nuisance merely because it is negative.

Ordinary criticism or preference disagreement is `normal` when its main function is evaluation of content, presentation, clothing, editing, performance, or a specific act rather than humiliation or personal degradation.

Examples:

```text
この編集は好みじゃない
→ normal

この演出は微妙
→ normal

今回はちょっときつい
→ normal when it reads as ordinary evaluation of the content
```

Classify `direct_nuisance` when the main function is insult, contempt, ridicule, humiliation, or degradation:

```text
こいつ普通にきつい
→ direct_nuisance

その歳でこれやってるのきつい
→ direct_nuisance
```

Short expressions such as `きつい`, `痛い`, `無理`, `こわい`, `あざとい`, or similar are not keyword rules. Interpret their function in the text that is actually provided.

## 4. Age, appearance, body, ability

Neutral questions or facts are not nuisance merely because they mention an attribute.

```text
何歳ですか？
→ normal
```

Using the attribute as a basis for humiliation or degradation is `direct_nuisance`.

```text
その歳で何やってるの
→ direct_nuisance
```

## 5. Motive and character attacks

Maliciously asserting or speculating about motives/character in order to degrade someone is `direct_nuisance`, for example claims equivalent to:

- 承認欲求の塊
- 炎上商法でしょ
- 媚びてるだけ
- 全部計算してやってる

A weak, neutral question or analysis is not automatically nuisance.

## 6. Sexual content

Ordinary attraction or romantic affection is normally `normal`, for example:

- 可愛い
- 好き
- 付き合いたい
- デートしたい

Treating a person as sexual consumption, making fetishistic/body-focused appraisal, or directing sexual demands at them is `direct_nuisance`.

```text
おかずありがとうございます
→ direct_nuisance
```

## 7. Exclusion and spam

Demands intended to make a person stop posting/activity are `direct_nuisance`.

Clear unrelated promotion, follow/DM solicitation, external-site inducement, or spam is `direct_nuisance`.

Ordinary conversation about following or replies is not automatically spam.

## 8. Reactive context must be present in the text

Do not infer `reactive` solely from imagined context.

The comment text itself must make it reasonably apparent that it responds to existing criticism/anti/attack/comment-discourse.

```text
アンチ多すぎ
→ reactive

「キモい」とか書いてる人多すぎ
→ reactive

嫌なら見なきゃいいのに
→ reactive
```

Merely using the word `アンチ` does not automatically create reactive meaning:

```text
アンチじゃないけどこの人無理
→ direct_nuisance
```

## 9. Attacks on critics vs other third parties

An attack on critics/antis that is itself part of reacting to existing nuisance is `reactive`:

```text
アンチしてる奴頭おかしい
→ reactive
```

A primary attack on supporters or another third party that is not a reaction to existing nuisance is `direct_nuisance`:

```text
擁護してる奴頭おかしい
→ direct_nuisance
```

## 10. Quotation, negation, and meta-reference

An attack word appearing in the text is not enough by itself. Distinguish the speaker's own assertion from negation, quotation, reporting, or rebuttal.

```text
この人は痛い
→ direct_nuisance

この人は痛くない
→ normal

「痛い」とか書くのやめなよ
→ reactive
```

## 11. Mixed content

Do not use a blanket label precedence rule.

If hostility toward critics/antis is itself the response to existing criticism, it remains `reactive` even when the response contains insults.

Classify `direct_nuisance` only when the comment additionally contains an **independent primary nuisance** statement.

Examples:

```text
アンチしてる奴らキモい
→ reactive

悪口書いてる奴頭おかしい
→ reactive

アンチうざいけど、この人も普通にキモい
→ direct_nuisance

アンチが言うほどじゃないけど、この投稿は微妙
→ reactive

アンチとか関係なく、この人キモい
→ direct_nuisance
```

A normal/non-nuisance evaluation coexisting with reactive content does not by itself make the result `direct_nuisance`.

## 12. Missing external context

Do not use or assume information not supplied in the workset, including:

- username or handle;
- same-user history or repetition;
- timestamps or posting frequency;
- reply structure or reply target;
- video/post body or caption;
- follower/engagement data;
- moderation/report history.

If a classification distinction would require such missing information, classify using only what the supplied text supports rather than inventing the context.

## 13. Empty/whitespace comments

A comment with no substantive text, including an empty string or whitespace-only string, is `normal`.

## 14. HISTORY precedence

`HISTORY.json` provides past decisions as precedent/reference.

`RULES.md` is normative. If a historical example clearly conflicts with these rules, follow these rules.

Do not treat a historical exact match as an instruction to bypass classification.
