# Work Task Sequence: ラベリングを含む候補キーワード生成フロー

## Purpose

未ラベルの5-field rawデータを、既存のStage13・3-Classラベリング契約と品質検証を経て、検証済みの候補キーワード生成・公開フローへ安全かつ追跡可能に接続できる状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、実装仕様、受入条件、採択済み事項、対象外事項および正本を確認する。
- [ ] 2. 実装前提の確認の範囲で、AIエージェントが、Integrated Labelingとcandidate workflowの現行契約、変更境界、基準fixtureおよびテストの実行可能性を確認する。
- [ ] 3. Stage13手動ラベリングhandoffの範囲で、AIエージェントが、batch単位のレビュー入力と回答契約を安全に生成できる状態へ変更する。
- [ ] 4. Stage13回答統合の範囲で、AIエージェントが、複数batchの回答を完全性と既存の検証契約を保って最終化できる状態へ変更する。
- [ ] 5. 3-Class手動レビューの範囲で、AIエージェントが、mandatory reviewを既存のCSV契約で完了し、strict finalizationへ接続できる状態へ変更する。
- [ ] 6. 候補生成へのevidence接続の範囲で、AIエージェントが、ラベリング完了証跡と最終datasetの系譜をfail-closedで検証してhandoffを生成できる状態へ変更する。
- [ ] 7. 運用手順の範囲で、AIエージェントが、rawデータ準備からChatGPTレビュー、候補提案およびlocal publicationまでの再現可能な手順を記録する。
- [ ] 8. 検証範囲で、AIエージェントまたはCIが、正常系、semantic review不要時、回答・証跡の改変検知、既存互換性および公開までの一連の受入条件を確認する。
- [ ] 9. リリース判断の範囲で、人間が、受入条件、既知の基準fixture問題および運用開始の可否を判断する。
- [ ] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、残存する注意点および承認結果を記録する。

## Work Notes

- 実装の正本は `IMPLEMENTATION_SPEC.md`、受入確認の正本は `ACCEPTANCE_TESTS.md`、変更箇所の正本は `PATCH_MAP.md`、採択済み判断と対象外事項の正本は `DECISIONS_AND_NON_GOALS.md` とする。
- ChatGPTはStage13 pending record、3-Classの未解決P0/P1、および候補提案における意味判断のみを担当し、local実装はreuse、dataset assembly、品質検証、決定的評価およびpublicationのauthorityを維持する。
- Stage13の再生成では旧batch artifactを残さず、回答は生成artifactとは別のdirectoryで扱う。single-file回答経路は後方互換を維持する。
- 3-ClassではP0/P1をmandatory、P2をoptionalとする既存semanticsを維持し、semantic reviewが0件の場合はChatGPT工程だけをskipする。
- candidate handoffのevidence modeでは、summary、validationおよび最終three-class datasetのSHA整合性を検証し、検証済みSHAをrequestのsource identityとして使用する。evidenceなしの既存経路、candidate schema v1、11-file handoff、full-updateおよびpublication contractは変更しない。
- ChatGPT/OpenAI API連携、自動orchestration、retry/history、raw全件の再分類、新規manifest・schema、P2 policy変更、candidate評価規則変更およびpublication contract変更は対象外とする。
- `BASELINE.md` に記載されたdiscussion ZIP固有のfixture欠損は、この作業で推測復元またはテスト緩和を行わない。リリース可否は検証結果とともに人間が判断する。
