# Consumer Implementation Handoff

Source root: `consumer/package/`

## A. WorkStepResult and routing

Files:

- `src/workflow/outcomes.js`
- canonical JSON schema under source docs/contracts or its production location
- `src/workflow/definitions.js` inline copy (prefer generating/importing one canonical schema rather than manually drifting copies)

### State-result vocabulary

Add `deployment_failed`.

`blocked` may remain in the shared schema for backward compatibility, but revision-2 application services SHALL NOT normally return it as a completed WorkStepResult. Non-retryable operational block exits via typed error and AgentAdapter returns `status:"blocked"`.

### Agent routing mapping

Use explicit mapping, not `details.outcome`:

```text
succeeded
committed
unchanged
created
reused
materialized
already_materialized
verified                 -> continue

review_required          -> review_required
rejected
not_verified             -> rejected
conflict                 -> superseded
triggered                -> wait
already_deployed         -> verify
deployment_failed        -> deployment_failed
```

`details` is diagnostic only.

## B. AgentAdapter/application handler boundary

Current `src/integration/task-handlers.js` exposes service handlers but is not yet a Provider `AgentAdapter`.

Implement an adapter that:

1. reads exactly one required capability from Task contract;
2. receives Provider Session context (`sessionId`, definition ID/revision), step ID and grant permissions;
3. creates OperationContext with `operationId = <sessionId>/<stepId>/1`;
4. calls the application-service handler with Task inputs;
5. maps normal WorkStepResult to `{status:"succeeded", outcome, result}`;
6. maps non-retryable operational/domain-integrity StateControlPlane errors to `{status:"blocked", failure}` without writing a completed application receipt;
7. maps technical/transient errors to `{status:"failed", failure}` so Provider retry policy applies.

`DEPLOYMENT_TRIGGER_FAILED` is technical/retryable. `HEAD_CONFLICT` should normally be caught by the domain service and returned as normal `conflict -> superseded`, not escape to Adapter classification.

Add `promotion.propose` to `SERVICE_CAPABILITIES` and handler registry.

## C. Permissions

Revision-2 Task contracts SHALL use:

```text
01 evidence.ingest:
  evidence:write

02 corpus.update:
  state:read, state:propose, state:auto-decide, state:commit

03 classification.assess:
  state:read, state:propose, state:auto-decide, state:commit

06 classification.finalize:
  state:read, state:commit

07 keyword-selection.assess:
  state:read, state:propose, state:auto-decide, state:commit

10 keyword-selection.finalize:
  state:read, state:commit

11 release.build:
  state:read, release:build

12 release.materialize:
  release:build, artifact:write

13-propose promotion.propose:
  state:read, state:propose

14 promotion.finalize:
  state:read, state:commit

16 deployment.trigger:
  state:read, deployment:trigger

19 deployment.verify:
  state:read, deployment:verify

20 deployment.record:
  state:read, state:propose, state:auto-decide, state:commit
```

Classification/Keyword assessment capabilities that receive commit permissions must resolve only to the deterministic Application Service worker. Any LLM/non-deterministic assessor remains subordinate inside that service and never receives Orchestrator commit grant directly.

## D. Policy stream/provenance changes — `src/application/services.js`

Extend `STREAM_KEYS` with:

```js
corpusPolicy: { domain: "policy", streamKey: "corpus" },
promotionPolicy: { domain: "policy", streamKey: "promotion-production" },
deploymentPolicy: { domain: "policy", streamKey: "deployment-production" },
```

Replace permissive `policyPayload()` behavior. Never return `{}` on missing/invalid version for an authoritative transition.

Add exact-stream helpers such as `requireVersionFromStream(controlPlane, versionId, expectedStream)` and use them at every authoritative boundary.

Corpus Proposal includes its pinned policy dependency and automated Decision uses that exact version.

Classification/Keyword:

- Proposal policy dependency is exact pinned version;
- finalize derives policy from Proposal dependency;
- request does not choose policy;
- actor authorization uses the policy payload;
- cross-stream policy injection is rejected.

## E. Promotion — `src/application/release-services.js`

### `PromotionApplicationService.propose`

This is a required workflow Task before Human review.

On first execution for deterministic proposal ID:

1. validate release is materialized;
2. in one short DB transaction resolve current Promotion head and current `policy/promotion-production` head;
3. fail blocked/intervention if policy missing;
4. create immutable Proposal in that same transaction with:
   - expected Promotion head version;
   - policy dependency;
   - release/target semantics.

On technical retry, if same deterministic Proposal already exists, validate request identity and return it. Do **not** re-resolve head or policy.

### `PromotionApplicationService.finalize`

- read Proposal;
- derive release/target and policy dependency from Proposal;
- validate Human review (`accept|reject`) and actor against that policy;
- create formal Decision using dependency policy version;
- reject path returns normal `rejected` result so workflow records formal rejected Decision;
- accept path always attempts `commitProposal()`; remove the early shortcut that returns unchanged solely because current release ID happens to match;
- commit service decides same-head/same-semantics `unchanged` vs stale-head `HEAD_CONFLICT -> conflict/superseded`.

The removed shortcut is necessary to detect Promotion ABA (`R1 -> R2 -> R1`) during Human wait.

## F. Release build — `src/application/release-services.js`

Release inputs include and validate exact streams for:

- corpus version;
- classification version;
- keyword-selection version;
- projection-definition version;
- classification policy;
- keyword policy;
- account-candidate policy.

Existing code only validates policy `domain`; strengthen to expected policy stream by role.

## G. Session input — `src/workflow/session-input.js`

### comment-data-update v2

Add required `pinned.corpusPolicyVersionId`.

When caller supplies any pin, verify the version exists and belongs to the exact expected stream. Do not accept a syntactically valid ID from another stream.

If required policy/projection head is missing, fail Session creation rather than silently continuing.

### deploy-promoted-release v2

Create a separate validator/starter for:

```js
{
  promotionVersionId,
  releaseId,
  target: { deploymentTarget: "production" }
}
```

Starter derives both IDs from the same current Promotion head read. This pair is authoritative for the recovery Session.

## H. Definition compatibility — `src/workflow/compatibility.js`

Provider `validateAndHashDefinition()` is the only structural WorkDefinition validator.

Consumer validation remains only for Comment DB-specific invariants:

- correct definition ID/revision/schema version;
- required stable step IDs;
- required capabilities/permissions;
- canonical Provider hash equals pinned snapshot.

Do not duplicate Provider step-structure validation.

Remove/avoid `revision` passthrough that can assign revision 1 to the revision-2 tree.

## I. Outcome projector — `src/workflow/outcomes.js`

Add a projector from Provider completed Session view. It reads `resultsByStepId` and terminal Noop marker.

Do not use `details.outcome` as authority.

`commentDataUpdateOutcome({status:"deployment_failed"...})` must require non-empty release ID.

For deployed:

```text
releaseId = record step refs.releaseId
changed = record step stateResult === "committed"
```

## J. Definition hashes

Do not preselect hash values.

After exact revision-2 definitions are complete:

1. run Provider `validateAndHashDefinition()`;
2. use returned canonical hashes as `comment-data-update@2` and `deploy-promoted-release@2` snapshots;
3. test that a one-byte/canonical change under the same registered revision is rejected.
