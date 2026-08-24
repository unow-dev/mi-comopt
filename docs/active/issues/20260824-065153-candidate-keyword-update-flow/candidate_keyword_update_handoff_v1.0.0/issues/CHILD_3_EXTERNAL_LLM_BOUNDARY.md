# 外部LLM候補提案の入出力境界と更新フローを整備する

## Depends on

Child 1 + Child 2。

## Scope ownership

- candidate_view.json
- pre_evaluation.json
- candidate_generation_request.json
- prompt contract v1
- candidate_proposal.json
- proposal schema/lifecycle validation
- canonical candidate_change_set.json
- add/update/retire/reactivate
- `full_update`
- legacy local generator production assetsの完全撤去

## Explicitly out of scope

LLM provider/model、API call、chunking/retrieval、actual prompt本文、LLM内部rationale/evidence。

## Proposal lifecycle

- add: IDなし -> local canonicalization時にUUIDv4発行。
- update: active candidateのみ、full semantic state、no-op禁止。
- retire: activeのみ。
- reactivate: retiredのみ、full semantic state。
- keep actionなし。absence = keep。
- proposal schemaはadditionalProperties=false。
- proposalのrequest_id/fingerprintがrequestと一致しなければfail。

## Concurrency

request/change-setはbase run + registry hashへbinding。publication時currentと違えばSTALE_PARENTでrejectし、自動rebaseしない。

## Acceptance Criteria

- [ ] candidate viewにactive+retired全件をcandidate_id昇順で出す。
- [ ] pre-evaluation candidate setがactive IDsと完全一致する。
- [ ] generation request fingerprintが仕様どおり計算される。
- [ ] valid/invalid proposal fixtureをschema/lifecycleで判定できる。
- [ ] canonical change setでadd UUIDが一度固定され、replay可能。
- [ ] fixture proposalだけでLLM呼び出しなしにfull_update local pathをE2E testできる。
- [ ] full_updateの空actions proposalを正常に扱う。
- [ ] active全件をproposal適用後に再評価する。
- [ ] same-parent concurrent runsでfirst publicationだけが成功する。
- [ ] production/update pathからlocal candidate generation reachable pathが0件。
- [ ] seed/n-gram generator固有config/fixture/docsを削除またはhistorical化する。
