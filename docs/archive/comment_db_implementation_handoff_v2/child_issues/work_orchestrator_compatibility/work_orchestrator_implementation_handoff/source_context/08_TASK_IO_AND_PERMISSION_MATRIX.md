# Task I/O and Permission Matrix

This document fixes the minimum semantic input/output for every runtime step. Concrete `InputBinding` object syntax is implemented by the compatibility layer against the installed public `work-orchestrator` types.

## Common rule

Every Agent task receives `OperationContext` from the integration adapter in addition to the semantic input below. Every Agent task returns a routing outcome plus a result conforming to `contracts/work-step-result.schema.json` (or a task-specific narrowing of it).

`details` is diagnostic only and SHALL NOT be a required input for downstream authoritative processing.

| Step | Required semantic input | Required result refs/details | Permission set |
|---|---|---|---|
| `01-ingest-evidence` | `session.updateRequestId`, `session.evidenceSource` | `refs.evidenceIds`, input/output fingerprints | `evidence:write` |
| `02-update-corpus` | evidence IDs from 01, pinned `initialCorpusVersionId` | `refs.corpusVersionId` when changed/resolved; state result committed/unchanged/conflict/blocked | `state:read`, `state:propose`, `state:auto-decide`, `state:commit` |
| `03-update-classification` | corpus version from 02, pinned prior Classification version, pinned Classification Policy version | `assessmentId`; `proposalId` when change proposed; `classificationVersionId` when auto-committed/resolved | `state:read`, `state:propose`; add `state:auto-decide`, `state:commit` only for policy-authorized automatic path |
| `05-review-classification` | proposal ID from 03 plus human-readable assessment/projection refs needed for review | Human outcome `accept`/`reject`; actor comes from Human Task execution | Human task; no Agent permission |
| `06-finalize-classification` | proposal ID, Human outcome/actor from 05 | `decisionId`; `classificationVersionId` if committed | `state:read`, `state:commit` |
| `07-update-keyword-selection` | final Classification version from 03/06, corpus version, pinned prior Keyword Selection version, pinned Keyword Policy version | `assessmentId`; `proposalId`; `keywordSelectionVersionId` when auto-committed/resolved | `state:read`, `state:propose`; add `state:auto-decide`, `state:commit` only for authorized automatic path |
| `09-review-keyword-selection` | proposal ID from 07 plus review material refs | Human outcome `accept`/`reject` | Human task |
| `10-finalize-keyword-selection` | proposal ID, Human outcome/actor from 09 | `decisionId`; `keywordSelectionVersionId` if committed | `state:read`, `state:commit` |
| `11-build-release-bundle` | exact corpus/classification/keyword-selection versions, pinned policy versions as required by release semantics, pinned Projection Definition version | `releaseId`; bundle fingerprint | `state:read`, `release:build` |
| `12-materialize-release` | `releaseId` from 11 | `releaseId`; output fingerprint; release-artifact integrity/reference in stable result/ref or domain store | `release:build`, `artifact:write` |
| `13-review-production-promotion` | verified/materialized `releaseId`, expected Promotion head resolved for this promotion proposal | Human outcome `accept`/`reject` | Human task |
| `14-finalize-production-promotion` | `releaseId`, human review/actor, expected Promotion head | `decisionId`; `promotionVersionId` when committed | `state:read`, `state:commit` |
| `16-trigger-deployment` | promoted `releaseId`, target `production`, current/known deployment reference if available | `deploymentRequestId` for `wait`; release/target refs for `verify` | `state:read`, `deployment:trigger` |
| `18-wait-deployment-event` | correlation key = `deploymentRequestId` | event matching deployment event schema | waitEvent, no Agent permission |
| `19-verify-deployment` | `releaseId`, target, event/external run ref when available | `verificationRef` on successful verify | `state:read`, `deployment:verify` |
| `20-record-deployment-state` | verified `releaseId`, `verificationRef`, expected Deployment head | `decisionId`; `deploymentVersionId` when committed/resolved | `state:read`, `state:auto-decide`, `state:commit` |

## Resolved version precedence

Downstream steps SHALL use the version resulting from the current Session when present; otherwise they use the pinned version that was already authoritative.

Examples:

```text
Classification result committed -> use returned Classification version
Classification result unchanged -> use current/pinned Classification version confirmed by service
Human finalize committed -> use finalize returned Classification version
```

Do not make downstream builders infer “which version won” by reading current head again.

## Corpus decision policy

The initial implementation has no Human Corpus review step. `02-update-corpus` either:

- performs a policy-authorized automated Proposal/Decision/Commit,
- returns unchanged,
- returns superseded on concurrency conflict, or
- returns blocked for intervention.

Adding human Corpus review later changes the WorkDefinition graph and therefore requires a new Definition revision.

## Review material

Human Task input may include review-oriented projections/artifact references. Those are presentation inputs, not authority. The formal `proposalId` is the identifier consumed by the finalize service.
