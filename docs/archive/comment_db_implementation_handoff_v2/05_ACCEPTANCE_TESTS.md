# Mandatory Acceptance Test Matrix

All rows are implementation acceptance criteria, not optional examples.

| ID | Scenario | Required assertion |
|---|---|---|
| A01 | Normal auto-commit path | Required states advance, release materializes, production promotion/deployment completes, final outcome `deployed`. |
| A02 | Classification human accept | Proposal remains immutable; authorized human accepts; finalize records formal Decision and exactly one state transition. |
| A03 | Classification human reject | Rejected Decision recorded; Classification head unchanged; downstream keyword/release path does not run. |
| A04 | Keyword human accept | Same guarantees as A02 for Keyword Selection. |
| A05 | Keyword human reject | Same guarantees as A03 for Keyword Selection. |
| A06 | Promotion accept | Production Promotion State points to exact reviewed Release; deployment path starts. |
| A07 | Promotion reject | Promotion head unchanged; final business outcome `not_promoted`; no deployment request. |
| A08 | Head changes during human wait | Accepted old Proposal fails commit guard; Proposal/Decision are not rebased; final outcome `superseded`. |
| A09 | Domain commit succeeds then worker crashes before Task success is recorded | Technical retry reuses operation ID and prior result; exactly one Version/Transition/Head advancement. |
| A10 | Same operation ID, different request | `IDEMPOTENCY_CONFLICT`; no domain mutation. |
| A11 | Assessment technical failure before persistence | Retry within configured max attempts; no authoritative state mutation from failed attempt. |
| A12 | Retry exhaustion | Orchestrator task becomes intervention/manual-retry state according to compatibility mapping; no automatic business mutation. |
| A13 | Same proposed semantics as current head | No new State Version; result routes `continue` with domain state result `unchanged`. |
| A14 | Rollback to old semantics | New version/transition created; semantic hash may match historical version; head never moved backward. |
| A15 | Same exact release bundle requested twice | Existing Release Bundle reused; no duplicate release identity. |
| A16 | Promote already desired release | No new Promotion Version. |
| A17 | Deploy trigger external request succeeds but process crashes before receipt | Retry uses same deploymentRequestId and does not create a second deployment intent. |
| A18 | Duplicate deployment completed event | Harmless; no duplicate Deployment Version/Transition. |
| A19 | Deployment event status failed/cancelled | Promotion remains; Deployment head unchanged; outcome `deployment_failed`. |
| A20 | Deployment event succeeded, independent verify fails | Deployment head unchanged; outcome `deployment_failed`. |
| A21 | Deployment verify succeeds | Exactly one automated Deployment Proposal/Decision/Commit establishes actual release. |
| A22 | Already deployed at trigger time | Trigger routes `verify`, skips event wait, verify/record remain required/no-op-safe. |
| A23 | Recovery deployment | `deploy-promoted-release` does not rerun Corpus/Classification/Keyword/Promotion. |
| A24 | Pinned input isolation | New head/policy appearing after Session start does not silently alter running Session inputs. |
| A25 | Definition same revision changed | Validation/registration rejects changed canonical definition for registered revision. |
| A26 | Compatibility adapter cannot exactly map required retry/intervention semantics | Definition build/CI fails closed. |
| A27 | Unauthorized human accept | Formal Decision/Commit is rejected despite Orchestrator Human Task outcome. |
| A28 | Dependency role invalid for domain transition | Domain handler rejects commit; head unchanged. |
| A29 | Legacy cutover dual write attempt | Test detects/rejects legacy authoritative writer after cutover. |
| A30 | Legacy current marker consumer after cutover | Test/integration scan demonstrates consumers use State Head/explicit version instead. |
| A31 | Account candidate regeneration | Same authoritative inputs produce same derived result; no independent authoritative Account Candidate version is created. |
| A32 | Work Orchestrator Registry unavailable after business commit and later recovers | Re-driven Task obtains prior Comment DB application result via operation receipt without duplicate mutation. |

## Definition tests

Both WorkDefinitions must additionally pass:

```text
TypeScript typecheck
validateAndHashDefinition()
canonical/snapshot definition test
registerDefinition() acceptance test
```

## Migration tests

Each stream cutover must demonstrate all gates in `04_DB_SCHEMA_AND_MIGRATION.md` section 9 before the legacy write path is disabled/removed.
