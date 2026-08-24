# 外部LLMによる候補キーワード提案生成

## 目的

既存の決定的な候補更新フローに、外部LLMへ候補キーワードの意味的な更新提案を依頼する実運用を接続し、`candidate_generation_request.json` から検証済みの `candidate_proposal.json` を生成できる状態にする。

LLMからの提案は、既存候補のidentity、候補のライフサイクルおよび更新履歴を壊さず、ローカルのschema検証・lifecycle検証・canonical change set・deterministic evaluation・publicationへ追跡可能に引き渡せることを目的とする。

## 背景

候補キーワード更新フローでは、現在すでにcandidate registry、bootstrap、決定的評価、publication、`NEW` 表示および `full_update` のローカル処理が実装されている。一方、候補の意味的な発見・追加・更新を担う外部LLMとの実接続は、provider、model、API呼び出しおよび実際のprompt本文を対象外としていたため、実行時には外部LLMが返す `candidate_proposal.json` を別途用意する必要がある。

handoff内の `contracts/PROMPT_CONTRACT_v1.md` は、LLMが満たすべき意味上の指示と入出力境界を定義しているが、実際にLLMへ送る自然言語prompt本文ではない。実装済みの `generate-request` も、現在のpublication、candidate view、pre-evaluation、policyおよびtaxonomyをbindingする機械可読requestを生成するだけで、LLMへの依頼文の組み立てやAPI呼び出しは行わない。

そのため、現状は決定的なローカル更新経路と外部LLMによる候補提案生成の間に実運用上の境界が残っている。このIssueでは、その境界をprovider固有の挙動やLLM内部の推論に依存せず、request fingerprint、厳密なproposal schema、候補ライフサイクルおよび監査可能な実行履歴と結び付ける必要がある。
