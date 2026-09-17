# 02 — Implementation Tickets
Each ticket is implementation-sized. Requirement ownership remains the normative PR0–PR5 owner gate; sub-PR IDs below do not change `traceability-v3.json`. A ticket is complete only when its local mandatory verification IDs pass and implementation evidence is recorded. Cross-cutting `V3-E2E*` IDs are finally executed by PR4-D.

## PR0-A — Freeze normative handoff and revision preflight

**Depends on:** none  
**Goal:** Store the immutable normative package/hash and distinguish schemaVersion from TARGET_REVISION.  
**Requirements:** `V3-REQ-REV-005`  
**Verification:** `V3-RV05`

**Code surfaces**

- add: `docs/active/issues/comment_db_implementation_v3/handoff/`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR0-B — Implementation evidence ledger and normative lint

**Depends on:** `PR0-A`  
**Goal:** Track implementation evidence outside the normative package and enforce requirement/verification coverage.  
**Requirements:** `V3-REQ-REV-007`  
**Verification:** `V3-RV07`

**Code surfaces**

- add: `docs/active/issues/comment_db_implementation_v3/implementation-evidence-v3.json`
- add: `package/tests/v3-handoff-integrity.test.js`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR1-A — Provider additive compatibility prerequisites

**Depends on:** `PR0-B`  
**Goal:** Add logicalPath, optional bindings, receipt lookup and external-event parity without consumer business semantics.  
**Requirements:** `V3-REQ-ART-007`, `V3-REQ-DEPLOY-002`, `V3-REQ-REV-006`  
**Verification:** `V3-HF06`, `V3-DE02`, `V3-RV06`

**Code surfaces**

- add: none
- modify: `../../work-orchestrator/package (provider workspace; exact files determined there)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR2-A — V3 machine contracts and result validator

**Depends on:** `PR0-B`  
**Goal:** Compile normative JSON schemas/rules into runtime validation; reject forbidden stale refs before task completion.  
**Requirements:** `V3-REQ-RESULT-001`, `V3-REQ-RESULT-002`, `V3-REQ-ART-011`  
**Verification:** `V3-RS01`, `V3-RS02`, `V3-HF10`

**Code surfaces**

- add: `package/src/workflow/v3/contracts.js`
- add: `package/src/workflow/v3/result-rules.js`
- add: `package/tests/workflow-v3-contracts.test.js`
- modify: `package/src/workflow/index.js (additive export only)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR2-B — V3 Definition, Session and terminal outcome

**Depends on:** `PR2-A`  
**Goal:** Build comment-data-update@TARGET_REVISION side-by-side; keep deploy-promoted-release@2 and all v2 hashes frozen.  
**Requirements:** `V3-REQ-SESSION-001`, `V3-REQ-SESSION-002`, `V3-REQ-SESSION-003`, `V3-REQ-SESSION-004`, `V3-REQ-SESSION-005`, `V3-REQ-SESSION-006`, `V3-REQ-SESSION-007`, `V3-REQ-REV-001`, `V3-REQ-REV-002`, `V3-REQ-REV-003`, `V3-REQ-REV-004`  
**Verification:** `V3-S01`, `V3-S02`, `V3-S03`, `V3-E2E03`, `V3-S04`, `V3-S05`, `V3-S06`, `V3-RV01`, `V3-RV02`, `V3-RV03`, `V3-RV04`

**Code surfaces**

- add: `package/src/workflow/v3/definitions.js`
- add: `package/src/workflow/v3/session-input.js`
- add: `package/src/workflow/v3/outcomes.js`
- add: `package/src/workflow/v3/index.js`
- add: `package/tests/workflow-v3-definition.test.js`
- modify: `package/src/workflow/index.js (additive export only)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR2-C — Validated Human artifact completion

**Depends on:** `PR1-A`, `PR2-A`  
**Goal:** Validate bytes/name/cardinality/protocol, snapshot exact bytes, and complete Human Task with exact ArtifactVersion.  
**Requirements:** `V3-REQ-ART-001`, `V3-REQ-ART-002`, `V3-REQ-ART-003`, `V3-REQ-ART-004`, `V3-REQ-ART-005`, `V3-REQ-ART-006`, `V3-REQ-ART-008`, `V3-REQ-ART-009`, `V3-REQ-ART-010`  
**Verification:** `V3-HF01`, `V3-HF02`, `V3-HF03`, `V3-HF04`, `V3-HF05`, `V3-HF07`, `V3-HF08`, `V3-HF09`

**Code surfaces**

- add: `package/src/integration/human-artifact-completion-v3.js`
- add: `package/tests/human-artifact-v3.test.js`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR3-A — V3 authority and application idempotency base

**Depends on:** `PR2-A`, `PR2-B`  
**Goal:** Use operationId=sessionId/stepId, stable JCS business DTO hashes, and enforce transaction/external-call boundary.  
**Requirements:** `V3-REQ-AUTH-001`, `V3-REQ-AUTH-002`, `V3-REQ-AUTH-003`, `V3-REQ-AUTH-004`, `V3-REQ-AUTH-005`, `V3-REQ-SVC-001`, `V3-REQ-SVC-002`  
**Verification:** `V3-AU01`, `V3-E2E01`, `V3-E2E02`, `V3-AU02`, `V3-AU03`, `V3-SV01`, `V3-SV02`

**Code surfaces**

- add: `package/src/application/v3/result.js`
- add: `package/src/application/v3/context.js`
- add: `package/src/application/v3/index.js`
- add: `package/tests/application-v3-authority.test.js`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR3-B — Dependency-aware commit mode

**Depends on:** `PR3-A`  
**Goal:** Add semantic_and_dependencies no-op mode while preserving semantic-only default for v2.  
**Requirements:** `V3-REQ-DEP-001`, `V3-REQ-DEP-002`, `V3-REQ-DEP-003`, `V3-REQ-DEP-004`, `V3-REQ-DEP-005`, `V3-REQ-DEP-006`, `V3-REQ-DEP-007`, `V3-REQ-DEP-008`, `V3-REQ-DEP-009`  
**Verification:** `V3-DEP01`, `V3-DEP02`, `V3-DEP03`, `V3-DEP04`, `V3-DEP05`, `V3-DEP06`, `V3-DEP07`, `V3-E2E03`, `V3-DEP08`

**Code surfaces**

- add: `package/tests/application-v3-dependencies.test.js`
- modify: `package/src/state/control-plane.js`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR3-C — Classification v3 workflow services

**Depends on:** `PR2-C`, `PR3-A`, `PR3-B`  
**Goal:** Implement prepare/reuse/workset/assess/Human-finalize semantics with exact pinned dependencies.  
**Requirements:** `V3-REQ-CLASS-001`, `V3-REQ-CLASS-002`, `V3-REQ-CLASS-003`, `V3-REQ-CLASS-004`, `V3-REQ-CLASS-005`, `V3-REQ-CLASS-006`, `V3-REQ-CLASS-007`  
**Verification:** `V3-CL01`, `V3-CL02`, `V3-CL03`, `V3-CL04`, `V3-CL05`, `V3-E2E02`

**Code surfaces**

- add: `package/src/application/v3/classification-service.js`
- add: `package/src/application/v3/classification-handoff.js`
- add: `package/tests/classification-v3.test.js`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR3-D — Keyword Selection v3 workflow services

**Depends on:** `PR2-C`, `PR3-A`, `PR3-B`  
**Goal:** Reuse pinned candidate-handoff v1 protocol and implement exact-input handoff/review/finalize semantics.  
**Requirements:** `V3-REQ-KEY-001`, `V3-REQ-KEY-002`, `V3-REQ-KEY-003`, `V3-REQ-KEY-004`, `V3-REQ-KEY-005`, `V3-REQ-KEY-006`, `V3-REQ-KEY-007`  
**Verification:** `V3-KW01`, `V3-KW02`, `V3-KW03`, `V3-KW04`, `V3-KW05`, `V3-E2E02`

**Code surfaces**

- add: `package/src/application/v3/keyword-service.js`
- add: `package/src/application/v3/keyword-handoff.js`
- add: `package/tests/keyword-v3.test.js`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR3-E — V3 agent adapter and capability wiring

**Depends on:** `PR3-C`, `PR3-D`  
**Goal:** Bind v3 capabilities with one top-level side-effect command per Agent step; no businessAttempt or blocked routing.  
**Requirements:** No exclusive requirement ownership; integration/evidence ticket.  
**Verification:** Covered by dependency tickets.

**Code surfaces**

- add: `package/src/integration/task-handlers-v3.js`
- add: `package/tests/task-handlers-v3.test.js`
- modify: `package/src/integration/index.js (additive export only)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR4-A — Deterministic Release v3 identity/materialization

**Depends on:** `PR3-E`  
**Goal:** Create eight-pin JCS releaseKey identity mapping and immutable deterministic materialization using existing artifact store.  
**Requirements:** `V3-REQ-REL-001`, `V3-REQ-REL-002`, `V3-REQ-REL-003`, `V3-REQ-REL-004`, `V3-REQ-REL-005`, `V3-REQ-REL-006`, `V3-REQ-REL-007`, `V3-REQ-REL-008`  
**Verification:** `V3-RL01`, `V3-RL02`, `V3-RL03`, `V3-RL04`, `V3-RL05`, `V3-E2E02`, `V3-RL06`, `V3-RL07`

**Code surfaces**

- add: `package/src/application/v3/release-service.js`
- add: `package/db/comment-database/010-comment-db-v3.sql`
- add: `package/tests/release-v3.test.js`
- modify: `package/src/state/schema.js (additive tables only)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR4-B — Promotion v3 Decision/CAS finalization

**Depends on:** `PR4-A`  
**Goal:** Persist Human Decision before guarded Commit; retain accepted Decision on head conflict; reuse current Promotion Version for same Release.  
**Requirements:** `V3-REQ-REL-009`  
**Verification:** `V3-RL08`, `V3-E2E03`

**Code surfaces**

- add: `package/src/application/v3/promotion-service.js`
- add: `package/tests/promotion-v3.test.js`
- modify: none

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR4-C — Deployment v3 ledger, FIFO and outbox

**Depends on:** `PR4-B`, `PR1-A`  
**Goal:** Use accepted Promotion Decision x target identity, target-local monotonic sequence, durable FIFO single-flight, receipt-first delivery and verify/record guards.  
**Requirements:** `V3-REQ-DEPLOY-001`, `V3-REQ-DEPLOY-003`, `V3-REQ-DEPLOY-004`, `V3-REQ-DEPLOY-005`, `V3-REQ-DEPLOY-006`, `V3-REQ-DEPLOY-007`, `V3-REQ-DEPLOY-008`, `V3-REQ-DEPLOY-009`, `V3-REQ-DEPLOY-010`, `V3-REQ-DEPLOY-011`, `V3-REQ-DEPLOY-012`  
**Verification:** `V3-DE01`, `V3-DE03`, `V3-DE04`, `V3-DE05`, `V3-DE06`, `V3-DE07`, `V3-DE08`, `V3-DE09`, `V3-E2E04`, `V3-DE10`, `V3-DE11`, `V3-DE12`

**Code surfaces**

- add: `package/src/application/v3/deployment-service.js`
- add: `package/src/deployment/ledger-v3.js`
- add: `package/src/deployment/outbox-v3.js`
- add: `package/tests/deployment-v3.test.js`
- modify: `package/db/comment-database/010-comment-db-v3.sql`
- modify: `package/src/state/schema.js (additive tables only)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR4-D — V3 runtime and full E2E integration

**Depends on:** `PR4-C`, `PR3-E`  
**Goal:** Wire local/Temporal execution, conditional Human steps and event flow; run all V3-E2E01..04 while production default remains v2.  
**Requirements:** No exclusive requirement ownership; integration/evidence ticket.  
**Verification:** `V3-E2E01`, `V3-E2E02`, `V3-E2E03`, `V3-E2E04`

**Code surfaces**

- add: `package/tests/comment-db-v3-e2e.test.js`
- modify: `package/src/integration/index.js (additive export only)`
- modify: `runtime registration/start facade (v3 remains production-unreachable)`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR5-A — Freeze v2 starts and drain

**Depends on:** `PR4-D`  
**Goal:** Freeze new comment-data-update@2 starts and prove nonterminal v2 sessions drain to zero.  
**Requirements:** `V3-REQ-CUT-001`, `V3-REQ-CUT-002`  
**Verification:** `V3-CUT01`, `V3-CUT02`

**Code surfaces**

- add: `package/scripts/comment-db-v3-cutover.mjs`
- add: `package/tests/cutover-v3.test.js`
- modify: `production start policy/config`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR5-B — Authority cutover and v3 start enable

**Depends on:** `PR5-A`  
**Goal:** Disable legacy authority before enabling comment-data-update@TARGET_REVISION; prove no dual-authority window.  
**Requirements:** `V3-REQ-CUT-003`, `V3-REQ-CUT-004`  
**Verification:** `V3-CUT03`, `V3-CUT04`

**Code surfaces**

- add: none
- modify: `production start policy/config`
- modify: `legacy authority writer gates`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.

## PR5-C — Production smoke and fix-forward controls

**Depends on:** `PR5-B`  
**Goal:** Run smoke; on failure freeze new starts and fix-forward only; never mutate a registered Definition or restore legacy authority.  
**Requirements:** `V3-REQ-CUT-005`, `V3-REQ-CUT-006`, `V3-REQ-CUT-007`  
**Verification:** `V3-CUT05`, `V3-CUT06`, `V3-CUT07`

**Code surfaces**

- add: none
- modify: `cutover/smoke runbook tooling`

**Merge gate**

The ticket's local verification IDs pass; all touched v2 regression/hash tests pass; `implementation-evidence-v3.json` has implementation refs for every owned requirement; no later ticket is required to keep `main` safe.
