# Task I/O and Permission Matrix v3

`S`=session binding, `R`=step result binding, `T`=task envelope binding, `?`=optional predecessor binding. Human tasks have no capabilities/permissions/budgets.

For Agent steps, this table is the human-readable summary of `contracts/work-step-result-v3-rules.json`. The JSON rules file is authoritative for allowed `(routingOutcome,stateResult)` combinations and exact permitted authoritative-ref sets.

| Step ID | Kind / capability | Authoritative inputs | Artifact lineage | Permissions | Allowed routing outcomes | Permitted authoritative refs |
|---|---|---|---|---|---|---|
| 00-receive-update-artifact | Human/file | S:updateRequestId,inputContract | output comment-batch.json | — | submitted | Human artifact submission result |
| 01-ingest-evidence | Agent `evidence.ingest` | T:00 | accepted 00 artifact | evidence:write | continue | evidenceIds, snapshotRef |
| 02-update-corpus | Agent `corpus.update` | R:01, S:pinned.initialCorpusVersionId, corpusPolicyVersionId | none | state:read,state:propose,state:auto-decide,state:commit | continue,superseded | continue/committed: corpusVersionId,proposalId,decisionId; continue/unchanged: corpusVersionId; superseded: none |
| 03a-prepare-classification-handoff | Agent `classification.handoff.prepare` | R:02, pinned Classification + Classification Policy | output three-class-workset.zip when required | state:read,artifact:write | reuse,ready_without_handoff,handoff_required,superseded | reuse: classificationVersionId; ready_without_handoff: none; handoff_required: worksetId; superseded: none |
| 03b-receive-classification-response | Human/file | T:03a | input workset artifact; output response.json | — | submitted | Human artifact submission result |
| 03-update-classification | Agent `classification.assess` | R:02,S:pins,T:03a,?T:03b | accepted response artifact if 03b ran | state:read,state:propose,state:auto-decide,state:commit | continue,review_required,superseded | continue/unchanged: assessmentId,classificationVersionId; continue/committed: assessmentId,proposalId,decisionId,classificationVersionId; review_required: assessmentId,proposalId; superseded: none |
| 05-review-classification | Human/decision | R/T:03 Proposal + Assessment | no file authority | — | accept,reject | rationale optional |
| 06-finalize-classification | Agent `classification.finalize` | T:03,?T:05 | none | state:read,state:commit | continue,rejected,superseded | continue/reused: classificationVersionId; continue/committed: classificationVersionId,proposalId,decisionId; rejected: proposalId,decisionId; superseded: none OR proposalId,decisionId |
| 07a-prepare-keyword-handoff | Agent `keyword-selection.handoff.prepare` | R:02,R:06,pinned Keyword + Policy | output keyword-candidate-handoff.zip when required | state:read,artifact:write | reuse,handoff_required,superseded | reuse: keywordSelectionVersionId; handoff_required: candidateRequestId,candidateInputFingerprint; superseded: none |
| 07b-receive-keyword-proposal | Human/file | T:07a | input handoff artifact; output candidate_proposal.json | — | submitted | Human artifact submission result |
| 07-update-keyword-selection | Agent `keyword-selection.assess` | R:02,R:06,S:pins,T:07a,?T:07b | accepted proposal artifact if 07b ran | state:read,state:propose,state:auto-decide,state:commit | continue,review_required,superseded | continue/unchanged: assessmentId,keywordSelectionVersionId; continue/committed: assessmentId,proposalId,decisionId,keywordSelectionVersionId; review_required: assessmentId,proposalId; superseded: none |
| 09-review-keyword-selection | Human/decision | R/T:07 Proposal + Assessment | — | — | accept,reject | rationale optional |
| 10-finalize-keyword-selection | Agent `keyword-selection.finalize` | T:07,?T:09 | — | state:read,state:commit | continue,rejected,superseded | continue/reused: keywordSelectionVersionId; continue/committed: keywordSelectionVersionId,proposalId,decisionId; rejected: proposalId,decisionId; superseded: none OR proposalId,decisionId |
| 11-build-release-bundle | Agent `release.build` | R:02,R:06,R:10 + all five policy/projection pins | consumer release refs only | state:read,release:build | continue | releaseId |
| 12-materialize-release | Agent `release.materialize` | R:11 | consumer release store is business authority | release:build,artifact:write | continue | releaseId |
| 13-propose-production-promotion | Agent `promotion.propose` | R:12,S:promotionStream | — | state:read,state:propose | continue | proposalId,releaseId |
| 13-review-production-promotion | Human/decision | Proposal 13 + Release review package | review package input | — | accept,reject | rationale optional |
| 14-finalize-production-promotion | Agent `promotion.finalize` | T:13 + T:13-review | — | state:read,state:commit | continue,rejected,superseded | continue: proposalId,decisionId,promotionVersionId,releaseId; rejected/superseded: proposalId,decisionId,releaseId |
| 16-trigger-deployment | Agent `deployment.trigger` | R:14 + target | — | state:read,deployment:trigger | wait,verify,superseded,deployment_failed | wait/verify: deploymentRequestId,releaseId,promotionVersionId; superseded: releaseId,promotionVersionId; deployment_failed: deploymentRequestId,releaseId,promotionVersionId |
| 18-wait-deployment-event | WaitEvent | R:16 deploymentRequestId | external event payload | — | succeeded,failed,cancelled,superseded event status | status; externalRunRef when provider run exists |
| 19-verify-deployment | Agent `deployment.verify` | T:16 + ?R:18 + target | — | state:read,deployment:verify | continue,superseded,deployment_failed | continue: verificationRef,deploymentRequestId,releaseId,promotionVersionId; superseded: deploymentRequestId,releaseId,promotionVersionId; deployment_failed/not_verified also verificationRef |
| 20-record-deployment-state | Agent `deployment.record` | R:19 + release + target | — | state:read,state:propose,state:auto-decide,state:commit | continue,superseded | continue: deploymentVersionId,deploymentRequestId,releaseId; superseded: deploymentRequestId,releaseId |

## Binding and result rules

- A downstream task has an explicit binding to a predecessor Human step when it inherits that predecessor's accepted ArtifactVersions (`V3-REQ-ART-006`).
- `optional:true` is used only for conditional predecessors (03b,05,07b,09,18) and follows `V3-REQ-REV-006`; it is not a general missing-data suppressor.
- `details` is not an authoritative binding source (`V3-REQ-RESULT-001`).
- Steps 06 and 10 return the resolved State Version ID on every `continue` path.
- Result rules enforce exact authoritative-ref key sets, so route/state-forbidden extra refs are rejected. For 06/10 `superseded`, the rules permit exactly either `{}` for upstream-conflict pass-through or `{proposalId,decisionId}` for Human-accept-after-review followed by Commit conflict; the finalizer domain contract and CL/KW acceptance tests verify that the correct set is chosen for the actual path.
