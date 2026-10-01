# Work Orchestrator Business Workflow Contract

## 1. Definitions

### `comment-data-update`

Purpose: establish any required Corpus / Classification / Keyword Selection state, build verified release material, obtain production promotion approval, deploy, verify actual external state, and record Deployment State.

### `deploy-promoted-release`

Purpose: retry/recover deployment of the already desired/promoted release without rerunning Corpus, Classification, Keyword Selection, or Promotion.

## 2. Session input

Use `contracts/comment-data-update-session-input.schema.json`.

The Session starter resolves current heads/policies/projection definition before starting the Session. All pinned IDs are explicit.

## 3. Definition tree rule

Do not implement a flat outer sequence that continues after a terminal choice branch. The “continue” path MUST contain the remaining continuation inside the relevant choice branch.

Conceptually:

```text
classification
  choice
    stop -> branch ends
    continue -> keyword
                  choice
                    stop -> branch ends
                    continue -> release/promotion/deployment
```

This avoids requiring a goto/terminate primitive not present in the public step kinds.

## 4. Steps and contracts

| Step ID | Kind | Capability | Routing outcomes | Wall ms | Attempts |
|---|---|---|---|---:|---:|
| `01-ingest-evidence` | agent task | `evidence.ingest` | `continue`, `blocked` | 20000 | 3 |
| `02-update-corpus` | agent task | `corpus.update` | `continue`, `superseded`, `blocked` | 15000 | 2 |
| `03-update-classification` | agent task | `classification.assess` | `continue`, `review_required`, `superseded`, `blocked` | 25000 | 2 |
| `05-review-classification` | human task | — | `accept`, `reject` | no business timeout | 1 |
| `06-finalize-classification` | agent task | `classification.finalize` | `continue`, `rejected`, `superseded`, `blocked` | 15000 | 2 |
| `07-update-keyword-selection` | agent task | `keyword-selection.assess` | `continue`, `review_required`, `superseded`, `blocked` | 25000 | 2 |
| `09-review-keyword-selection` | human task | — | `accept`, `reject` | no business timeout | 1 |
| `10-finalize-keyword-selection` | agent task | `keyword-selection.finalize` | `continue`, `rejected`, `superseded`, `blocked` | 15000 | 2 |
| `11-build-release-bundle` | agent task | `release.build` | `continue`, `blocked` | 20000 | 2 |
| `12-materialize-release` | agent task | `release.materialize` | `continue`, `blocked` | 25000 | 3 |
| `13-review-production-promotion` | human task | — | `accept`, `reject` | no business timeout | 1 |
| `14-finalize-production-promotion` | agent task | `promotion.finalize` | `continue`, `rejected`, `superseded`, `blocked` | 15000 | 2 |
| `16-trigger-deployment` | agent task | `deployment.trigger` | `wait`, `verify`, `blocked` | 20000 | 3 |
| `18-wait-deployment-event` | waitEvent | — | event received | external wait | — |
| `19-verify-deployment` | agent task | `deployment.verify` | `continue`, `rejected`, `blocked` | 20000 | 2 |
| `20-record-deployment-state` | agent task | `deployment.record` | `continue`, `superseded`, `blocked` | 15000 | 2 |

Number gaps are intentional and preserve stable IDs after removing earlier conceptual routing pseudo-steps.

## 5. Routing patterns

### Reviewable state update

Classification and Keyword Selection use the same workflow shape:

```text
assess/update
  continue -> next continuation
  review_required -> human review
                       accept/reject
                     -> finalize
                          continue -> next continuation
                          rejected -> terminal business outcome
                          superseded -> terminal business outcome
                          blocked -> operational intervention
  superseded -> terminal business outcome
  blocked -> operational intervention
```

Do not force the domain services themselves into one generic service. Sharing a Definition builder is allowed.

### Promotion

Production Promotion always requires a Human Task in this implementation:

```text
review-production-promotion
  accept/reject
      |
      v
finalize-production-promotion
  continue -> deployment
  rejected -> terminal:not_promoted
  superseded -> terminal:superseded
  blocked -> intervention
```

### Deployment

```text
trigger-deployment
  wait -> waitEvent(deployment.completed, deploymentRequestId)
             succeeded -> verify-deployment
             failed/cancelled -> terminal:deployment_failed
  verify -> verify-deployment
  blocked -> intervention

verify-deployment
  continue -> record-deployment-state
  rejected -> terminal:deployment_failed
  blocked -> intervention
```

`verify` from trigger means the adapter believes the target may already be serving the release and event waiting is unnecessary; the verifier still independently checks external reality.

## 6. Human review

Allowed Human outcomes are exactly `accept` and `reject`.

Human completion is only evidence/input to the finalize task. `completeHumanTask(..., "accept")` is NOT a Comment DB Decision.

Finalize must revalidate proposal existence, expected head, actor authority, Transition Policy, and review outcome.

## 7. Step result envelope

Use `contracts/work-step-result.schema.json` as the stable cross-step shape.

Workflow routing uses the Orchestrator task `outcome`. Domain details such as `committed`, `unchanged`, proposal ID, state-version ID, release ID, fingerprints, etc. are in result JSON.

Downstream step bindings SHOULD depend on stable fields (`refs`, fingerprints, explicit state result) rather than free-form `details`.

## 8. Permissions

Use semantic application permissions, not raw SQL permissions:

- `evidence:write`
- `state:read`
- `state:propose`
- `state:auto-decide`
- `state:commit`
- `release:build`
- `artifact:write`
- `deployment:trigger`
- `deployment:verify`

LLM-backed assessment workers SHALL NOT receive state commit permission unless the specific task contract explicitly and intentionally combines automated adjudication/commit under Transition Policy.

## 9. Worker strategy

At minimum distinguish:

- assessment-capable worker(s): potentially LLM/non-deterministic reasoning
- deterministic application worker: DB transitions, release build/materialization, deployment operations

The Work Orchestrator AgentAdapter may route internally by Task capability. The business specification does not equate `workerKind: agent` with an LLM.

## 10. Retry semantics

Technical exceptions retry within the same Task/Session and retain the same domain `operationId`.

Semantic conflict is not a technical retry: return `superseded` and start a new `comment-data-update` Session against newly resolved heads.

An external deployment attempt that actually failed is not retried by looping inside `comment-data-update`. Complete with `deployment_failed` and start `deploy-promoted-release` when retry is desired.

Retry exhaustion must result in operational intervention/manual retry semantics, not an automatic business-state mutation.

## 11. Deployment event contract

Use `contracts/deployment-completed-event.schema.json`.

`eventType = deployment.completed`

`correlationKey = deploymentRequestId`

Succeeded event is not sufficient to change Deployment State; verification remains mandatory.

Duplicate events must be harmless.

## 12. Terminal business outcome

Use `contracts/comment-data-update-outcome.schema.json`.

Outcome is derived from the Orchestrator Session view; do not duplicate it as authoritative Comment DB state.

`blocked` is not a terminal business outcome. It is an active operational state requiring retry/intervention/cancel.

## 13. Definition builders

Use a small compatibility/build layer, not a new generic DSL. Acceptable local helpers include:

```text
agentTask(...)
humanReview(...)
route(...)
reviewableStateUpdate(...)
deploymentFlow(...)
```

Every generated Definition must be typechecked, validated/hashed, snapshot-tested, then registered.
