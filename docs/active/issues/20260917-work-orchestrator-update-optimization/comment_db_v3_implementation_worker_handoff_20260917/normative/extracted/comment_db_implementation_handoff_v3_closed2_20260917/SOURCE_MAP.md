# Source Map

This handoff was derived from the supplied 2026-09-17 discussion snapshot plus verified repository source used during the design discussion.

Key consumer areas:

- `package/src/workflow/definitions.js`, compatibility/session input
- `package/src/application/services.js`, deployment/release services
- `package/src/state/control-plane.js`, schema
- existing collector input contract `tiktokCommentBatch-1.0.0`
- existing three-class workset/response tooling
- existing keyword candidate handoff workflow/schema, compatibility-pinned by `V3-REQ-KEY-003` to `unow-dev/mi-comopt@398a904069af3e5e1386e412811f9a8275af1d7a`
- normative v2 Comment DB handoff (historical baseline)
- Integrated Labeling Handoff v1.5.0 (operational evidence/legacy validation context)

Key provider areas:

- `src/contracts.ts`
- `src/domain.ts`
- `src/registry.ts`
- `src/runtime.ts`
- `src/temporal-client.ts`
- `src/temporal-workflow.ts`
- `src/temporal-activities.ts`
- `src/workspace.ts`

The supplied discussion-set explicitly excluded some old candidate-generation/manual-handoff/publication/UI compatibility paths. The v3 design therefore used actual operational sequence evidence discovered during discussion, not merely omissions from the snapshot, to preserve Human -> external model -> Human review boundaries.
