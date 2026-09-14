# Implementer Checklist

Use this as the final handoff checklist.

- [ ] Read `README.md` and the normative hierarchy.
- [ ] Do not implement a custom workflow runtime in Comment DB.
- [ ] Build/validate both WorkDefinitions with stable step IDs.
- [ ] Keep Orchestrator Registry separate from Comment DB authority.
- [ ] Add generic State Control Plane tables and typed state tables.
- [ ] Enforce Proposal -> Decision -> Commit and optimistic concurrency.
- [ ] Add application operation receipts and stable operation IDs.
- [ ] Ensure domain mutation + receipt are one DB transaction.
- [ ] Do not hold DB transactions over external model/deployment calls.
- [ ] Implement exact-version query/build APIs; avoid implicit current reads.
- [ ] Keep Account Candidate derived.
- [ ] Implement release bundle dedupe and release-owned artifact references.
- [ ] Require human production promotion.
- [ ] Implement idempotent/reconcilable deployment ensure + independent verify.
- [ ] Implement recovery `deploy-promoted-release` definition.
- [ ] Migrate domain-by-domain with no authoritative dual-write.
- [ ] Treat legacy current markers as non-authoritative after cutover.
- [ ] Pass every mandatory acceptance row A01-A32.
- [ ] Fail closed when `work-orchestrator` cannot exactly represent required semantics.
