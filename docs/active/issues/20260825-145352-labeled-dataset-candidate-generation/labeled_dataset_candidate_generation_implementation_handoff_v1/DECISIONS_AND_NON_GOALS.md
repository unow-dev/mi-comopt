# Decisions and Non-goals

## 採択済みDecision

- Stage13 → 3-Classの既存二段階semantic boundaryを維持する。
- ChatGPTはsemantic adjudicator。localがdataset assembly/validation/publication authority。
- raw全件をChatGPTでゼロから3-class化しない。
- Stage13は既存500件batch機構を活用する。
- Stage13 batchごとにlocal contextとCSV templateを生成する。
- ChatGPTのStage13回答は既存CSV契約へ直接戻す。
- Stage13の複数回答は `finalize-stage13 --adjudications-dir` で扱う。
- 3-Class ChatGPT回答も既存CSV契約 `record_key,label,note` に合わせる。
- P0/P1 mandatory、P2 optionalの現行semanticsを維持する。
- labeling完了証跡は既存 `summary.json` + `validation_report.json` を使う。
- 新しいlabeling manifestを作らない。
- candidate production handoffでのみlabeling evidenceをfail-closed検証する。
- candidate request schema v1は維持する。
- candidateの一般的なsource SHA semanticsは変更しない。
- Integrated Labeling evidence modeではupstream自身のbyte SHAを照合してverified source SHAとする。
- semantic review対象0件ではChatGPTのみskipし、local finalizationは同一pathで行う。

## Non-goals

このIssueでは以下を実装しない。

- ChatGPT/OpenAI API integration。
- 自動LLM scheduler/orchestrator。
- retry/history/attempt管理。
- confidence score。
- raw全件LLM再分類。
- candidate schema v2。
- 新規labeling manifest。
- 新規LLM JSON response schema。
- 3-Class自動batch orchestration。
- P2をmandatory化。
- Stage13/3-Class分類policy変更。
- candidate evaluation rule変更。
- candidate publication contract変更。
- artifact registry / URI naming制度新設。
- discussion ZIPの欠損fixtureを推測復元すること。

## Scope guard

実装中に上記Non-goalが必要に見えた場合、当Issueに混ぜず別Issueとして提案すること。MVPのため「ついでのrefactor」は避ける。
