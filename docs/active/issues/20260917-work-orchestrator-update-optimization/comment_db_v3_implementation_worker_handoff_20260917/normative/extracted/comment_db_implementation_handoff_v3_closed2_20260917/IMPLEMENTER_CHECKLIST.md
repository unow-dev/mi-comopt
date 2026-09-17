# Implementer Checklist

## Before coding

- [ ] Read README, 01, machine-readable contracts/rules, 02, 08, 03, and 09.
- [ ] Confirm `comment-data-update@2` hash `77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1`.
- [ ] Confirm `deploy-promoted-release@2` hash `aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c`.
- [ ] Resolve `TARGET_REVISION`: starting at 3, build/validate/hash candidate; use absent slot, reuse equal-hash slot, increment past conflicting registered slot. Never overwrite a registered revision.
- [ ] Run requirement/acceptance/traceability consistency check and supporting-document normative-keyword lint.
- [ ] Do not edit frozen v2 Definition builders/schema in a way that changes their canonical hashes.

## Provider PR

- [ ] ProducedArtifact logicalPath local/Temporal parity.
- [ ] Optional InputBinding strict-default and artifact propagation parity.
- [ ] RegistryReader receipt lookup.
- [ ] External event `event:<eventId>` parity and request hash preparation.

## Consumer Definition/Foundation

- [ ] Create explicit new session/result schemas; do not overwrite v2 schemas.
- [ ] Install `work-step-result-v3-rules.json` validator before Agent Task completion.
- [ ] Validate Session terminal payloads against the strict outcome `oneOf` schema; rejection stage and superseded conflictAt are mandatory/closed enums.
- [ ] Human file-task completion payload is exactly `executionId + artifact`; no free-form contract identity fields.
- [ ] Application operation ID is exactly `<sessionId>/<stepId>` and request hash is SHA-256(JCS(serviceRequestDto)).
- [ ] Build the resolved new Definition revision with stable Step IDs from 08.
- [ ] `deploy-promoted-release@2` remains unchanged.
- [ ] Validated Human artifact completion implements preflight/hash/snapshot/receipt-first recovery.
- [ ] Production start facade is not switched yet.

## Domain

- [ ] Classification handoff v1 reused.
- [ ] Keyword candidate-handoff v1 reused.
- [ ] Payload change always requires Human review.
- [ ] Dependency-only transition uses exact dependency equality.
- [ ] Human accept records Decision before guarded Commit; conflict retains Decision and returns superseded.
- [ ] Human reject records rejected Decision and does not attempt state Commit.
- [ ] Nullable Version IDs accept `null` and reject empty string.

## Release / Promotion

- [ ] Release key is JCS/SHA-256 over the exact eight named Version IDs plus contract discriminator.
- [ ] `release_key` uniqueness and concurrent find-or-create verified.
- [ ] Projection Definition covers all byte-relevant output semantics; materialization is deterministic.
- [ ] Existing Release materialization is verified, never silently overwritten.
- [ ] Promotion Proposal pins exact Release and expected Promotion head (`null` for genesis).
- [ ] Promotion no-op accept records Decision and reuses existing Promotion Version.

## Deployment / Integration

- [ ] Deployment intent unique key is `(acceptedPromotionDecisionId, deploymentTarget)`.
- [ ] Target-local deployment sequence is unique/monotonic and retry-stable.
- [ ] Multiple dispatcher processes remain correct; external deployment is FIFO single-flight per target.
- [ ] Promotion head checked immediately before first external deploy call.
- [ ] Step 19 checks Promotion head before and after verification.
- [ ] Step 20 applies Promotion-head and deployment-sequence guards.
- [ ] Deployment event outbox is receipt-first with monotonic delivered/dead-letter disposition.
- [ ] Dead-letter/integration uncertainty is not converted to business `deployment_failed`.
- [ ] Full Temporal v3 acceptance green in cloned/disposable environment.

## Cutover

- [ ] Freeze new v2 starts.
- [ ] Drain active update@2 to zero.
- [ ] Disable legacy authority before enabling new-revision starts.
- [ ] Run production smoke.
- [ ] On failure: freeze starts and fix-forward; never recreate dual authority.
