# Implementer Checklist

Use this as the PR completion checklist. It is intentionally binary.

## Provider

- [ ] `WorkDefinition.schemaVersion` validates 1 and 2 with v1 behavior preserved.
- [ ] v2 includes Noop, binding Choice, task-source binding, dynamic event correlation.
- [ ] v2 Human Task does not require wall budget.
- [ ] `AgentRunRequest` includes Session/Definition context.
- [ ] `AgentRunResult` supports top-level outcome and blocked status.
- [ ] blocked leaves original Task waiting and creates intervention without normal retry.
- [ ] Human completion persists full ActorRef provenance.
- [ ] Wait correlation resolves once and persists.
- [ ] Session view exposes `resultsByStepId`.
- [ ] external-event facade is receipt-first and persists/recognizes terminal_ignored delivery identity.
- [ ] JSON-schema subset enforces additionalProperties/minLength.
- [ ] package version is `0.1.0` and `dist` regenerated.

## Consumer

- [ ] Real policy streams exist: corpus, promotion-production, deployment-production.
- [ ] No pseudo Transition Policy IDs remain in Decision creation.
- [ ] Session pins are exact-stream validated; corpus policy pin added.
- [ ] Recovery starter pins Promotion version + release from same head.
- [ ] Provider AgentAdapter exists and uses operation ID `<session>/<step>/1`.
- [ ] routing uses explicit stateResult mapping; `details.outcome` is not authoritative.
- [ ] `promotion.propose` exists and precedes Promotion Human review.
- [ ] all Human reject paths execute finalize and create formal Decision.
- [ ] Promotion finalize always uses Proposal policy dependency and stale-head guard.
- [ ] Release build validates exact policy streams.
- [ ] Deployment request ledger is durable before network call.
- [ ] Deployment request reconciliation is monotonic.
- [ ] callback ingress writes audit + outbox atomically.
- [ ] callback can route to workflow Session using stored workflow_session_id.
- [ ] Deployment semantic state excludes verificationRef.
- [ ] `deployment.record` has state:propose permission and no caller `verified:true` gate.
- [ ] revision-2 definitions use schemaVersion 2 and semantic Record bindings.
- [ ] no v2 blocked Choice branches or empty terminal Sequences.
- [ ] v2 builder cannot emit revision 1.
- [ ] outcome projector uses completed Session view/results.

## Verification

- [ ] Provider v1 regression tests green.
- [ ] Provider v2 tests green.
- [ ] Consumer tests green.
- [ ] Deployment race/crash/outbox tests green.
- [ ] A01–A32 green.
- [ ] `comment-data-update@2` validates/hashes/registers.
- [ ] `deploy-promoted-release@2` validates/hashes/registers.
- [ ] exact v2 hashes are pinned after final definition generation.
- [ ] revision-1 hashes are unchanged.
