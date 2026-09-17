# Decision Log v3

This file records rationale only and has no normative force.

1. **Update revision is resolved mechanically from revision 3 upward; deploy remains revision 2.** The update graph changes materially, and `TARGET_REVISION` is the first absent or hash-identical immutable registry slot selected by `V3-REQ-REV-007`; deployment recovery graph does not change.
2. **Actual operations -> artifact lifecycle -> DB authority -> Orchestrator mapping.** WorkDefinition alone is not evidence that omitted operational handoffs do not exist.
3. **File transport is not business approval.** 00/03b/07b are separate from 05/09/13-review.
4. **External model never writes authoritative state.** Its artifact is validated into Assessment/Proposal; Human/System Decision and Commit remain separate.
5. **Existing three-class workset v1 and candidate-handoff v1 are reused.** Do not invent new model-response protocols unless required.
6. **Changed Classification/Keyword payload always receives Human review.** Generic auto-commit must not bypass operational adoption boundaries.
7. **Dependency-only changes create new state provenance.** Reusing an old State Version would incorrectly preserve old dependency lineage.
8. **Production Account Candidate adoption is combined with release-level production review.** A second separate approval gate was rejected as duplicative.
9. **No formal-reject loop in the same Session.** Corrective semantic work starts a new Session with new pins.
10. **Validated Human artifact completion uses existing ArtifactStore primitives plus preflight hash comparison.** A provider business-validator API was rejected.
11. **Optional InputBinding is preferred to exponential downstream subtree duplication.** It is additive and preserves strict default semantics.
12. **No production DB shadow dual-run.** Rehearsal uses cloned/disposable DB.
13. **Cutover prioritizes single authority over continuous new-start availability.** A short start freeze is acceptable.
14. **Post-cutover rollback is fix-forward.** Revision 2/legacy authority is not a business rollback target.
15. **v3 handoff is self-contained.** v2 is historical/reference, not required implementation reading.
16. **WorkStepResult refs use exact route/state key sets, not minimum sets.** Extra authoritative refs were rejected because stale IDs can otherwise leak across conflict routes.
17. **Idempotency hashes a stable business DTO, not incidental transport state.** Optional absent predecessors remain omitted; ephemeral runtime metadata does not participate.
18. **Keyword candidate-handoff v1 is compatibility-pinned instead of re-specified.** Reusing the exact existing protocol baseline avoids creating a subtly different v1.
19. **Terminal outcome payloads are closed discriminated shapes.** Rejection stage and superseded conflict location are mandatory; irrelevant discriminators are rejected.
20. **Human artifact submission result does not duplicate contract identity.** The task result schema is the contract/version authority; the payload contains only active execution identity and accepted ArtifactVersion identity.
