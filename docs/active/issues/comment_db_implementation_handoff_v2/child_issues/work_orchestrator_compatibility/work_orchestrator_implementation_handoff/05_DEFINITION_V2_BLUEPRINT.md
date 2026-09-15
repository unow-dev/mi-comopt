# Revision-2 WorkDefinition Blueprint

This is the required logical tree. Exact generated IDs must be unique after branch duplication; business step IDs below are stable.

## 1. Common v2 builder rules

Use semantic input-binding records:

```js
inputBindings: {
  releaseId: STEP_BINDING("...", "/refs/releaseId")
}
```

Never use positional arrays or generated `input0` names.

Helpers:

```text
SESSION_BINDING(path)
STEP_BINDING(stepId, path)
TASK_BINDING(stepId, path)
NOOP(marker)
```

Root task completion binding uses `TASK_BINDING(id, "")`.

Do not use `suffixStepTree()` to rewrite arbitrary subtrees. Builders receive authoritative upstream bindings as parameters, because reviewed paths change which step owns the final version.

`blocked` never appears as a Choice branch in v2.

## 2. `comment-data-update@2`

```text
01-ingest-evidence
02-update-corpus
02-route-corpus [decision = TASK 02 /outcome]
├─ superseded -> noop {terminalStatus:superseded, conflictAt:corpus}
└─ continue
   03-update-classification
   03-route-classification [TASK 03 /outcome]
   ├─ superseded -> noop {terminalStatus:superseded, conflictAt:classification}
   ├─ continue
   │  └─ keywordContinuation(classificationVersion = STEP 03 /refs/classificationVersionId)
   └─ review_required
      05-review-classification
      06-finalize-classification
      06-route-classification-finalize [TASK 06 /outcome]
      ├─ rejected   -> noop {terminalStatus:change_rejected, stage:classification}
      ├─ superseded -> noop {terminalStatus:superseded, conflictAt:classification}
      └─ continue
         └─ keywordContinuation(classificationVersion = STEP 06 /refs/classificationVersionId)
```

### Keyword continuation

```text
07-update-keyword-selection
07-route-keyword-selection [TASK 07 /outcome]
├─ superseded -> noop {terminalStatus:superseded, conflictAt:keyword-selection}
├─ continue
│  └─ releaseContinuation(keywordVersion = STEP 07 /refs/keywordSelectionVersionId)
└─ review_required
   09-review-keyword-selection
   10-finalize-keyword-selection
   10-route-keyword-finalize [TASK 10 /outcome]
   ├─ rejected   -> noop {terminalStatus:change_rejected, stage:keyword-selection}
   ├─ superseded -> noop {terminalStatus:superseded, conflictAt:keyword-selection}
   └─ continue
      └─ releaseContinuation(keywordVersion = STEP 10 /refs/keywordSelectionVersionId)
```

Human reject is never routed around finalize. Both accept and reject complete the Human Task, then finalize records formal Decision.

### Release / Promotion continuation

```text
11-build-release-bundle
12-materialize-release
13-propose-production-promotion
13-route-production-proposal [TASK 13-propose /outcome]
├─ superseded -> noop {terminalStatus:superseded, conflictAt:promotion}
└─ continue
   13-review-production-promotion
   14-finalize-production-promotion
   14-route-production-promotion [TASK 14 /outcome]
   ├─ rejected   -> noop {terminalStatus:not_promoted}
   ├─ superseded -> noop {terminalStatus:superseded, conflictAt:promotion}
   └─ continue   -> deploymentContinuation(
                       promotionVersion = STEP 14 /refs/promotionVersionId,
                       release = STEP 14 /refs/releaseId)
```

Promotion Proposal exists before Human review and pins Promotion head + Promotion policy.

### Deployment continuation

```text
16-trigger-deployment
16-route-deployment-trigger [TASK 16 /outcome]
├─ superseded        -> noop {terminalStatus:superseded, conflictAt:promotion}
├─ deployment_failed -> noop {terminalStatus:deployment_failed}
├─ verify             -> verifyAndRecord(already-serving)
└─ wait
   18-wait-deployment-event
     eventType = deployment.completed
     correlationKey = STEP 16 /refs/deploymentRequestId
   18-route-deployment-event [STEP 18 /status]
   ├─ failed    -> noop {terminalStatus:deployment_failed}
   ├─ cancelled -> noop {terminalStatus:deployment_failed}
   └─ succeeded -> verifyAndRecord(event)
```

`verifyAndRecord`:

```text
19-verify-deployment
19-route-verification [TASK 19 /outcome]
├─ rejected -> noop {terminalStatus:deployment_failed}
└─ continue
   20-record-deployment-state
   20-route-deployment-record [TASK 20 /outcome]
   ├─ superseded -> noop {terminalStatus:superseded, conflictAt:deployment}
   └─ continue   -> noop {terminalStatus:deployed}
```

## 3. `deploy-promoted-release@2`

Start directly at the same deployment continuation with bindings:

```text
promotionVersionId = SESSION /promotionVersionId
releaseId          = SESSION /releaseId
target             = SESSION /target/deploymentTarget
```

It must not run Corpus, Classification, Keyword Selection, Release build, or Promotion.

## 4. Required semantic input bindings

| Step | Required input keys |
|---|---|
| 01 | `updateRequestId`, `evidenceSource` |
| 02 | `evidenceIds`, `initialCorpusVersionId`, `corpusPolicyVersionId` |
| 03 | `corpusVersionId`, `classificationVersionId`, `classificationPolicyVersionId` |
| 05 | `proposalId`, `assessmentId`, review material as needed |
| 06 | `proposalId`, `review = TASK(05, "")` |
| 07 | `classificationVersionId`, `corpusVersionId`, `keywordSelectionVersionId`, `keywordPolicyVersionId` |
| 09 | `proposalId`, `assessmentId`, review material as needed |
| 10 | `proposalId`, `review = TASK(09, "")` |
| 11 | `corpusVersionId`, `classificationVersionId`, `keywordSelectionVersionId`, `projectionDefinitionVersionId`, `classificationPolicyVersionId`, `keywordPolicyVersionId`, `accountPolicyVersionId` |
| 12 | `releaseId` |
| 13-propose | `releaseId`, `target` |
| 13-review | `proposalId`, `releaseId`, review material as needed |
| 14 | `proposalId`, `releaseId`, `review = TASK(13-review, "")` |
| 16 | `promotionVersionId`, `releaseId`, `target` |
| 19 event path | `releaseId`, `target`, `externalRunRef` from event when available |
| 19 already-serving | `releaseId`, `target` |
| 20 | `releaseId`, `verificationRef`, `target` |

Do not pass a Transition Policy ID to finalize tasks as a choice. Finalize reads Proposal dependency.

## 5. Branch duplication / suffixes

Because the static tree is not a DAG, downstream continuation is duplicated. Generate via parameterized builders, not blind subtree rewriting.

Required release-continuation contexts are logically:

```text
auto classification + auto keyword
auto classification + reviewed keyword
reviewed classification + auto keyword
reviewed classification + reviewed keyword
```

IDs may use deterministic suffixes such as:

```text
""
"after-keyword-review"
"after-classification-review"
"after-classification-review-after-keyword-review"
```

The already-serving verification path may add `-already-serving` within each context.

Snapshot tests, not prose, are the final guard for exact generated IDs.

## 6. Routing outcome sets

Allowed normal successful Agent routing outcomes per step:

```text
01: continue
02: continue | superseded
03: continue | review_required | superseded
06: continue | rejected | superseded
07: continue | review_required | superseded
10: continue | rejected | superseded
13-propose: continue | superseded
14: continue | rejected | superseded
16: wait | verify | superseded | deployment_failed
19: continue | rejected
20: continue | superseded
```

Operational blocked is outside these sets and handled by AgentRunResult status/intervention.
