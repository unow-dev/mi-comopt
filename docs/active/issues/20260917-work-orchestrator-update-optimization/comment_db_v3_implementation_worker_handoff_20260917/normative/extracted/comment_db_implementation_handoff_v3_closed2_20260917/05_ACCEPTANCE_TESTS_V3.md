# Mandatory Acceptance Tests v3

All IDs in this document are mandatory unless explicitly marked otherwise. v2 `Axx` IDs remain historical and are not reused.

## Authority

| ID | Requirements | Assertion |
|---|---|---|
| V3-AU01 | AUTH-001, AUTH-002 | Runtime state and business state remain separate; Human Task completion alone creates no Comment DB Decision/Commit. |
| V3-AU02 | AUTH-003, AUTH-005 | No dual authority; Workspace/provider outbox and consumer deployment outbox remain separate. |
| V3-AU03 | AUTH-004 | Release business artifact authority/lifetime is consumer-owned, not WO ArtifactStore. |

## Application service / result contracts

| ID | Requirements | Assertion |
|---|---|---|
| V3-SV01 | SVC-001 | operationId is exactly `<sessionId>/<stepId>`; technical retries/reclaims reuse it; JCS key order does not change the hash; absent optional predecessor is omitted (not normalized to null); ephemeral runtime metadata is excluded; same business DTO replays prior result and a changed business DTO produces `IDEMPOTENCY_CONFLICT` with zero mutation. |
| V3-SV02 | SVC-002 | Instrumented integration test proves no external model/service call occurs while a Comment DB write transaction is open. |
| V3-RS01 | RESULT-001 | WorkStepResult schema + rules reject invalid state/result/ref combinations, missing refs, and route/state-forbidden extra refs before Task completion; 06/10 superseded accepts only the exact empty pass-through set or exact `{proposalId,decisionId}` Human-accept-conflict set; `details` and removed generic fingerprints cannot become authoritative bindings. |
| V3-RS02 | RESULT-002 | Terminal outcome schema rejects missing/unknown rejection stage, missing/unknown superseded conflictAt, and stray stage/conflict fields on deployed/not_promoted/deployment_failed. |

## Session

| ID | Requirements | Assertion |
|---|---|---|
| V3-S01 | SESSION-001,002 | Production facade pins update@TARGET_REVISION resolved by registry/hash algorithm and recovery deploy@2. |
| V3-S02 | SESSION-003 | Session schema requires all state/policy/projection pins; nullable Version IDs accept `null` or non-empty string and reject empty/sentinel values. |
| V3-S03 | SESSION-004 | Running Session does not adopt later heads/policies. |
| V3-S04 | SESSION-005 | Implicit multi-snapshot merge rejected. |
| V3-S05 | SESSION-006 | Input contract is producer-neutral. |
| V3-S06 | SESSION-007 | Actor provenance comes from WO history, not duplicated Session semantic field. |

## Human file handoff

| ID | Requirements | Assertion |
|---|---|---|
| V3-HF01 | ART-001,002 | 00/03b/07b are file transport; allowed outcome only `submitted`. |
| V3-HF02 | ART-003 | Invalid output leaves Task active; no completion receipt. |
| V3-HF03 | ART-004 | Validated-byte SHA equals submitted ArtifactVersion blobHash. |
| V3-HF04 | ART-005 | Stale/reclaimed Execution artifact cannot complete current Human task. |
| V3-HF05 | ART-006 | Accepted artifacts propagate 00->01, 03b->03, 07b->07 locally and in Temporal. |
| V3-HF06 | ART-007 | Agent logicalPath preserved locally and in Temporal. |
| V3-HF07 | ART-008 | Step 00 requires exactly `comment-batch.json`. |
| V3-HF08 | ART-009 | Step 03b requires exactly `response.json`. |
| V3-HF09 | ART-010 | Step 07b requires exactly `candidate_proposal.json`. |
| V3-HF10 | ART-011 | Human artifact completion result accepts exactly `executionId + artifact` identity fields and rejects redundant/unknown top-level fields. |

## Classification

| ID | Requirements | Assertion |
|---|---|---|
| V3-CL01 | CLASS-001 | 03a routing modes exactly match contract. |
| V3-CL02 | CLASS-002,003 | exact context allows reuse; zero unresolved targets allows ready_without_handoff. |
| V3-CL03 | CLASS-004,005 | workset v1 package/response strict identity validation. |
| V3-CL04 | CLASS-006 | semantic payload change always reaches step 05. |
| V3-CL05 | CLASS-007 | reject records rejected Decision, no Commit/head change, terminal change_rejected even if head advanced during Human wait. |

## Keyword Selection

| ID | Requirements | Assertion |
|---|---|---|
| V3-KW01 | KEY-001,002 | exact-input reuse only; any exact input change requires handoff. |
| V3-KW02 | KEY-003,004 | candidate-handoff v1 remains compatibility-equivalent to the pinned `398a904...` repository baseline (request generation/fingerprint/proposal validation); manifest excluded; request/fingerprint strict match. |
| V3-KW03 | KEY-005 | `actions: []` valid and can produce unchanged semantic state. |
| V3-KW04 | KEY-006 | semantic payload change always reaches step 09. |
| V3-KW05 | KEY-007 | reject records rejected Decision, no Commit/head change, terminal change_rejected even if head advanced during Human wait. |

## Dependency semantics

| ID | Requirements | Assertion |
|---|---|---|
| V3-DEP01 | DEP-001,002 | same payload+deps => unchanged, no new Version/Transition. |
| V3-DEP02 | DEP-003 | same payload + changed deps => new Proposal/Decision/Version/Transition. |
| V3-DEP03 | DEP-004 | dependency refresh system Decision only if pinned policy permits. |
| V3-DEP04 | DEP-005 | payload change cannot auto-commit via request/policy generic flags. |
| V3-DEP05 | DEP-006 | Classification requires exact one Corpus + one Classification Policy dependency. |
| V3-DEP06 | DEP-007 | Keyword requires exact one Corpus + one Classification + one Keyword Policy dependency. |
| V3-DEP07 | DEP-008 | changed head => superseded, never stale unchanged; Human accept Decision already recorded is retained while Commit is skipped. |
| V3-DEP08 | DEP-009 | default semantic no-op regression unchanged outside v3 domain mode. |

## Release and promotion

| ID | Requirements | Assertion |
|---|---|---|
| V3-RL01 | REL-001,002 | Release uses exact state/policy/projection inputs and never resolves latest/current. |
| V3-RL02 | REL-003 | Account Candidate deterministic regeneration; no independent state stream. |
| V3-RL03 | REL-004 | Production review includes all required diffs/artifacts/validation/target. |
| V3-RL04 | REL-005 | Accept binds exact reviewed Release to production promotion. |
| V3-RL05 | REL-006 | Reject -> not_promoted; no same-session edit/rebase. |
| V3-RL06 | REL-007 | Same eight named pins under JCS produce one releaseKey/Release under concurrent find-or-create; one pin change produces a different key. |
| V3-RL07 | REL-008 | Same pins/Projection Definition produce identical authoritative artifact bytes across time/timezone/host; existing exact materialization returns already_materialized; tamper/mismatch fails without overwrite. |
| V3-RL08 | REL-009 | Promotion Proposal pins Release + expected head; reject records Decision/no Commit; accept+head conflict records accepted Decision/no Commit/superseded; exact already-current Release reuses Promotion Version. |

## Deployment

| ID | Requirements | Assertion |
|---|---|---|
| V3-DE01 | DEPLOY-001 | retries/crashes retain same deployment intent/request ID. |
| V3-DE02 | DEPLOY-002 | local/Temporal event command ID parity `event:<eventId>`. |
| V3-DE03 | DEPLOY-003 | event delivery retry is receipt-first. |
| V3-DE04 | DEPLOY-004 | accepted/terminal/permanent/transient dispositions correct. |
| V3-DE05 | DEPLOY-005 | duplicate success event causes no duplicate Deployment transition. |
| V3-DE06 | DEPLOY-006 | failed/cancelled/verify-fail leaves Deployment head unchanged. |
| V3-DE07 | DEPLOY-007 | already-serving still performs verify+record. |
| V3-DE08 | DEPLOY-008 | Continue-As-New identity uses session/workflow ID, not Temporal run ID in DB authority. |
| V3-DE09 | DEPLOY-009 | Concurrent ensure for same accepted Decision+target yields one deploymentRequestId/sequence; different intents on same target get unique monotonic sequences. |
| V3-DE10 | DEPLOY-010 | With two dispatchers, same target has at most one external active deployment; newer sequence waits; stale queued request makes zero external calls and ends superseded. |
| V3-DE11 | DEPLOY-011 | Head advance before/during/after verify prevents Deployment commit; old sequence cannot roll back Deployment head; repeated same request returns reuse. |
| V3-DE12 | DEPLOY-012 | superseded is distinct from failure; definitive provider/verification failure may become deployment_failed; uncertainty/dead-letter/hash conflict/integrity/result-contract failures remain execution/integration conditions. |

## Revision/provider compatibility

| ID | Requirements | Assertion |
|---|---|---|
| V3-RV01 | REV-001 | registered revision immutable. |
| V3-RV02 | REV-002 | comment-data-update@2 hash unchanged. |
| V3-RV03 | REV-003 | deploy-promoted-release@2 hash unchanged. |
| V3-RV04 | REV-004 | registered canonical Definition contract is immutable; any canonical change uses a new higher revision. |
| V3-RV05 | REV-005 | schemaVersion=2 and TARGET_REVISION remain distinct concepts. |
| V3-RV06 | REV-006 | optional binding: unselected predecessor omitted; executed predecessor propagates value/artifact; bad executed path fails; default strict behavior unchanged; local/Temporal parity. |
| V3-RV07 | REV-007 | All 85 requirements have traceability + mandatory verification; supporting docs introduce no unregistered RFC-2119 obligations; TARGET_REVISION search reuses equal hash, skips conflicting immutable slots, and never overwrites a registered revision. |

## Cutover

| ID | Requirements | Assertion |
|---|---|---|
| V3-CUT01 | CUT-001 | v2 starts frozen before TARGET_REVISION enable. |
| V3-CUT02 | CUT-002 | nonterminal update@2 count is zero. |
| V3-CUT03 | CUT-003 | v3 enabled and legacy writer enabled never simultaneously true. |
| V3-CUT04 | CUT-004 | legacy authority disabled before v3 production start enable. |
| V3-CUT05 | CUT-005 | rollback/runbook has no legacy-authority/revision-2 business restart. |
| V3-CUT06 | CUT-006 | canonical Definition fix allocates a new higher immutable revision; it never mutates TARGET_REVISION. |
| V3-CUT07 | CUT-007 | smoke failure freezes new starts and fix-forwards. |

## Full Temporal E2E

| ID | Requirements | Assertion |
|---|---|---|
| V3-E2E01 | cross-cutting | Normal artifact -> Classification handoff/review -> Keyword handoff/review -> production accept -> deployment -> deployed. |
| V3-E2E02 | AUTH-001,002; CLASS-007; KEY-007; REL-006 | Each Human reject boundary prevents downstream execution. |
| V3-E2E03 | SESSION-004; DEP-008; REL-009 | Concurrent head advance during Human wait preserves the formal Human Decision where applicable, prevents stale Commit, and ends superseded without rebase. |
| V3-E2E04 | DEPLOY-009,010,011,012 | Two-dispatcher same-target race plus newer promotion never allows an older deployment result to overwrite newer Deployment authority. |
