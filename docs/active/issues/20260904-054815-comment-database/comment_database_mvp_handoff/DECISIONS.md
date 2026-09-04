# Decision Record

These decisions are closed for the MVP. Do not reopen them during implementation without explicitly changing issue scope.

| Topic | Adopted | Rejected alternatives | Reason |
|---|---|---|---|
| Database | SQLite | External/server DB | Local single-user MVP; issue itself identifies SQLite as initial candidate. |
| Runtime | Node 24 + built-in `node:sqlite` | Python runtime; third-party SQLite package | Workspace already requires Node 24; avoid new runtime/dependency. |
| Persistence unit | Comment observation | Guessed unique comment | Collector/native comment-ID contract is absent; guessed dedupe can merge distinct comments. |
| Collector integration | Separate adapter/follow-up | Collector-specific parsing in DB | Collector implementation is not in supplied sources. |
| Input | Versioned normalized JSON | Arbitrary collector JSON | Keeps DB boundary stable and testable. |
| Cross-import dedupe | None | Text/hash-based comment dedupe | No reliable comment identity is established. |
| Re-import idempotency | Canonical normalized payload SHA-256 | Raw file SHA; no idempotency | Ignores JSON formatting/order while preserving duplicate multiplicity. |
| Stored identity data | No username/handle/profile | Persist account identity | Not required for MVP use cases; data minimization. |
| Filter decisions | Not stored | Free-form decision column | Decision schema/version is unspecified. |
| Detected keywords | Not stored | Keyword-hit column | Derived from a changing keyword set. |
| Search | Ordinary SQLite/LIKE | FTS5 | Start simple; add only after measured need. |
| Migration tracking | `PRAGMA user_version` | Migration framework dependency | Adequate for small local MVP. |
| DB location | repo-root `var/` | committed DB in package | Mutable real data must stay out of deliverable/Git. |
| Schema/code location | `package/` | repo-root source module | `package/` is the stated deliverable boundary. |
| Timestamp storage | UTC ISO via `toISOString()` | Local time; timezone-less string | Makes time analysis unambiguous. |
| Transaction | One payload = one transaction | Row-by-row commits | Prevent partial imports. |
