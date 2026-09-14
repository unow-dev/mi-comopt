# Implementer Checklist

Use this as the final handoff checklist.

- [x] Read `README.md` and the normative hierarchy.
- [x] Do not implement a custom workflow runtime in Comment DB.
- [x] Build/validate both WorkDefinitions with stable step IDs.
- [x] Keep Orchestrator Registry separate from Comment DB authority.
- [x] Add generic State Control Plane tables and typed state tables.
- [x] Enforce Proposal -> Decision -> Commit and optimistic concurrency.
- [x] Add application operation receipts and stable operation IDs.
- [x] Ensure domain mutation + receipt are one DB transaction.
- [x] Do not hold DB transactions over external model/deployment calls.
- [x] Implement exact-version query/build APIs; avoid implicit current reads.
- [x] Keep Account Candidate derived.
- [x] Implement release bundle dedupe and release-owned artifact references.
- [x] Require human production promotion.
- [x] Implement idempotent/reconcilable deployment ensure + independent verify.
- [x] Implement recovery `deploy-promoted-release` definition.
- [x] Migrate domain-by-domain with no authoritative dual-write.
- [x] Treat legacy current markers as non-authoritative after cutover.
- [ ] Pass every mandatory acceptance row A01-A32 in the production orchestrator environment.
- [x] Fail closed when `work-orchestrator` cannot exactly represent required semantics.
