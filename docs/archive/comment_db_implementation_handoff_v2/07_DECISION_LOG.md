# Adopted Decision Log

This is a concise implementation-oriented record. Normative details are in the numbered specifications.

| Topic | Adopted | Rejected / reason |
|---|---|---|
| System mental model | Authoritative-state evolution | Generic ETL framing hides adjudication/current semantics |
| Current state | Mutable head to immutable versions | Copied mutable current rows as authority |
| Commit history | Linear per stream | Branching committed truth |
| Rollback | New version/transition | Moving head backward |
| Proposal conflict | New proposal against new head | Silent rebase of accepted proposal |
| Event sourcing | Version + transition log + head | Full replay-based event sourcing is unnecessary |
| Storage model | Generic control plane + typed domain tables | All-generic JSON or duplicated control machinery |
| Account Candidate | Derived view | Independent authoritative stream without independent judgment |
| Release | Immutable exact-version bundle | “latest” resolution inside release build |
| Promotion vs Deployment | desired vs actual separate streams | Treating deployment success/failure as promotion rollback |
| Orchestration | `work-orchestrator` WorkDefinition/Runtime | Custom workflow runtime in Comment DB |
| Workflow graph | Typed business definitions + small builders | Giant FSM; custom generic DSL; fully dynamic DAG |
| Production runtime | Temporal-backed Work Orchestrator | Long-lived in-process-only workflow |
| Session semantic conflict | End as superseded, new Session | Rebase/loop against newly read current in same logical attempt |
| Human outcome | Input to formal finalize/Decision | Human Task completion == domain Decision |
| Retry | TaskContract controls technical retry | Layered opaque retry loops |
| Distributed transaction | Stable operation ID + domain receipt | 2PC across Orchestrator Registry and Comment DB |
| Deployment idempotency | Adapter `ensure` semantics | Fire-and-forget trigger on every retry |
| Workflow outcomes | Routing vocabulary separated from domain result | Domain result strings directly drive all branch shape |
| Definition structure | Nested continuation under choice | Flat sequence that can continue after terminal branch |
| Migration | Domain-by-domain strangler, single authority | Big bang or authoritative dual write |
| Historical migration | Genesis when history unprovable | Fabricating decisions/transitions |
| Library undocumented literals | Compatibility adapter + fail closed | Guessing enum values in normative business design |
