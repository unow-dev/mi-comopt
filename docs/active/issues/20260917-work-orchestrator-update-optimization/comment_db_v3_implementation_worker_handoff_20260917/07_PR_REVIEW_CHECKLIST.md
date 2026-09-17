# 07 — PR Review Checklist

Use this checklist for every sub-PR.

- The PR names its ticket ID and normative requirement IDs.
- The PR is based on or reconciled against the recorded consumer baseline; unexpected drift is called out.
- No frozen v2 Definition canonical hash changes.
- No `deploy-promoted-release@2` semantic change.
- v3 changes are production-unreachable before PR5 unless the ticket is a cutover ticket.
- No dual-write or dual-authority fallback is introduced.
- Shared primitive changes have explicit v2 regression tests.
- v3 WorkStepResult is created through the v3 result constructor and passes exact result-rules validation.
- Idempotent commands reuse the same operation ID and business request hash on technical retry.
- External calls occur outside Comment DB write transactions.
- Human Task completion evidence is not mistaken for Comment DB Decision.
- New DB changes are additive/idempotent and do not reinterpret existing v2 deployment rows.
- All ticket-local verification IDs pass and are recorded in the implementation evidence ledger.
- `main` remains safe if no later ticket ever merges.
