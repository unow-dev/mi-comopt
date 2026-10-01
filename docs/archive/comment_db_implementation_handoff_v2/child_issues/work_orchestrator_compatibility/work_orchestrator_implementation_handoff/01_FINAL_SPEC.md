# Final Adopted Specification

## 1. Authority boundary

`work-orchestrator` owns workflow execution state. Comment DB/Application owns business authoritative state. A Task completion is never itself a business-state commit.

No new general workflow runtime is introduced in the Consumer.

## 2. Versioning

### Provider Definition language

Provider SHALL support:

- `WorkDefinition.schemaVersion = 1`: existing behavior, preserved for backward compatibility.
- `WorkDefinition.schemaVersion = 2`: the capabilities in this handoff.

`CommandEnvelope.schemaVersion` remains `1`.

Provider package version SHALL be bumped from `0.0.0` to `0.1.0`, with regenerated `dist` and type declarations.

### Consumer definitions

The only new definitions are:

- `comment-data-update`, revision `2`, `schemaVersion: 2`
- `deploy-promoted-release`, revision `2`, `schemaVersion: 2`

Do not permit an API that builds the new tree while accepting `revision: 1`. Revision 1 stays immutable. If old definitions must remain reconstructable, preserve them as archived fixtures/snapshots rather than parameterizing the v2 builder with an old revision number.

## 3. Provider v2 Definition contract

### Input binding

```ts
interface InputBinding {
  source: "session" | "step" | "task";
  path: string;
  stepId?: string;
}
```

- JSON Pointer root is the empty string `""`.
- `"/"` means a property whose key is the empty string; do not use it for root bindings.
- `source:"session"` resolves from Session input.
- `source:"step"` resolves from step result JSON.
- `source:"task"` resolves from a completed static Task as:

```ts
{
  outcome?: string;
  actor?: ActorRef;
  result: JsonValue;
}
```

The referenced Task must be lexically visible and completed. No match is unresolved; more than one matching static Task is an invariant violation.

### Choice

```ts
interface ChoiceStep {
  kind: "choice";
  id: string;
  decision: TaskStep | InputBinding;
  branches: Record<string, Step>;
}
```

For binding-based Choice:

- resolved value must be a string;
- it must equal one branch key;
- otherwise fail with `OUTCOME_INVALID`;
- for a statically known `source:"task", path:"/outcome"`, validator should verify known allowed outcomes/branch keys where possible.

Existing Task-based Choice remains valid for v1 compatibility. The decision Task is visible to branch bindings.

### Noop

Add:

```ts
interface NoopStep {
  kind: "noop";
  id: string;
  result?: JsonValue;
}
```

It completes immediately, writes its optional static result into normal step results, and emits normal scope completion. Empty Sequence remains invalid; intentional terminal branches use Noop.

### WaitEvent

```ts
interface WaitEventStep {
  kind: "waitEvent";
  id: string;
  eventType: string;
  correlationKey: string | InputBinding;
}
```

When the wait opens, resolve correlation exactly once and persist the resolved non-empty string in `WaitRuntime.correlationKey`. Matching thereafter uses the persisted wait value, never a re-evaluated definition binding. This invariant survives recovery.

### Task contracts

For schema v2, represent Task contract as a worker-kind discriminated contract:

- Agent: `budgets.maxWallTimeMs` required.
- Human: no fabricated business timeout; budgets are not required.
- Human review Tasks in this Consumer allow exactly `accept | reject` and do not use the Agent `WorkStepResult` schema as their result schema.

### Agent boundary

```ts
interface AgentRunRequest {
  session: {
    sessionId: string;
    workDefinitionId: string;
    definitionRevision: number;
  };
  task: TaskRuntime;
  execution: ExecutionRuntime;
  grant: ExecutionGrant;
}
```

```ts
type AgentRunResult =
  | { status: "succeeded"; outcome?: string; result?: JsonValue; artifacts?: ProducedArtifact[] }
  | { status: "blocked"; result?: JsonValue; failure?: JsonValue }
  | { status: "failed" | "cancelled" | "abandoned"; failure?: JsonValue };
```

For schema v2, routing outcome is top-level `AgentRunResult.outcome`; do not use `result.outcome` as a fallback. Preserve current v1 behavior only for v1 definitions.

### `blocked`

`blocked` is **not a workflow routing outcome in v2**. It is an operational disposition common to Agent Tasks.

When Agent returns `status:"blocked"`:

- the Execution attempt terminates successfully as an execution attempt (do not add `ExecutionState="blocked"`);
- the original Task becomes/stays `waiting`;
- an intervention/manual-retry Human Task is created immediately;
- automatic retry is not consumed;
- the Task does not advance its enclosing Choice/Sequence.

On manual retry, clear stale per-attempt fields before redispatch:

```text
attention
outcome
result
acceptedOutputArtifactVersionIds
currentExecutionId
```

Do not delete completed application receipts. Operational blocked must not have created a completed application receipt in the first place.

### Human completion provenance

Add full `completedBy?: ActorRef` to Task runtime persistence. Provider stores provenance; it does not decide whether a particular actor type is authorized for the business transition. Consumer finalize services enforce domain authority using Transition Policy.

### Session view

Public Session view SHALL expose `resultsByStepId`. Consumer outcome projection must not reverse-engineer private scope internals.

### JSON schema validator

Provider's runtime schema validation for the subset used here must actually enforce at least:

- `additionalProperties: false`
- `minLength`
- existing type/required/enum rules

## 4. Operation identity and retry semantics

Consumer operation identity is:

```text
<sessionId>/<stepId>/1
```

for this static workflow.

Technical retry and intervention/manual retry reuse the same operation ID. A semantic retry is a new Session and therefore a new operation identity.

Completed application operations persist receipts. Technical failure and operational blocked do not persist a completed receipt.

## 5. Policy provenance

Real versioned Policy State is required. Add/use these exact streams:

```text
policy / corpus
policy / classification
policy / keyword-selection
policy / account-candidate
policy / promotion-production
policy / deployment-production
```

No pseudo policy IDs such as `corpus-auto-policy`, `human-review-policy`, `production-promotion-policy`, or `deployment-verify-policy` may be written to Decisions.

Policy resolution rules:

- Corpus policy: pin at `comment-data-update` Session start.
- Classification policy: pin at Session start and preserve as Proposal dependency.
- Keyword Selection policy: pin at Session start and preserve as Proposal dependency.
- Account policy: pin at Session start and include in Release identity as required.
- Promotion policy: resolve only when `13-propose-production-promotion` creates a new immutable Proposal; persist as Proposal dependency.
- Deployment policy: resolve only when `20-record-deployment-state` creates a new immutable Proposal; persist as Proposal dependency.

The durable Proposal is the semantic boundary. Technical retry with the same deterministic proposal ID reuses the existing Proposal and does not resolve a newer head/policy.

Finalize uses the Proposal's policy dependency as the sole authority source. A legacy request policy ID, if temporarily accepted, must exactly equal the Proposal dependency; v2 workflow does not pass one.

Every authoritative service boundary validates the exact expected stream, not merely `domain === "policy"`. Missing or cross-stream policy versions fail closed. At Session start, missing required pinned policy prevents Session creation. At a later Promotion/Deployment boundary, missing policy yields operational blocked/intervention.

## 6. Session pinning

`comment-data-update@2` Session input adds required `pinned.corpusPolicyVersionId` and validates every supplied version against its exact stream.

Required exact stream checks include:

```text
initialCorpusVersionId            -> corpus/comments
classificationVersionId          -> classification/comments
keywordSelectionVersionId        -> keyword-selection/filter-keywords
corpusPolicyVersionId             -> policy/corpus
classificationPolicyVersionId     -> policy/classification
keywordPolicyVersionId            -> policy/keyword-selection
accountPolicyVersionId            -> policy/account-candidate
projectionDefinitionVersionId     -> projection-definition/release
```

`deploy-promoted-release@2` has a separate Session input:

```ts
{
  promotionVersionId: string;
  releaseId: string;
  target: { deploymentTarget: "production" };
}
```

The Session starter obtains `promotionVersionId` and `releaseId` from the same current Promotion head observation. Caller does not independently choose them.

Deployment trigger requires both current Promotion version and release to match the pinned pair. This detects ABA (`R1 -> R2 -> R1`).

## 7. Business outcome projection

Provider terminal primitives remain business-agnostic. Noop may carry a static marker such as:

```json
{"terminalStatus":"superseded","conflictAt":"promotion"}
```

Consumer projects the final API outcome from completed Session view + `resultsByStepId` + terminal marker.

Examples:

- `deployed`: release ID from record result; `changed = (20-record...stateResult === "committed")`.
- `not_promoted`: static marker + release ID from Promotion finalize/propose result.
- `change_rejected`: marker names classification or keyword-selection.
- `superseded`: marker supplies `conflictAt`.
- `deployment_failed`: marker + release/deployment request refs from trigger/wait/verify path.

`deployment_failed` requires a non-empty `releaseId` in the public outcome helper/schema.
