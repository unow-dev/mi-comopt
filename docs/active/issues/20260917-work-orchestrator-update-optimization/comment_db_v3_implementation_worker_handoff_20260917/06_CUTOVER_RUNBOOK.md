# 06 — Cutover Runbook Constraints

This is execution guidance; the normative CUT requirements remain authoritative.

## Preconditions

PR4-D is merged, all 79 mandatory verification IDs pass on the candidate commit, TARGET_REVISION has been resolved by the registry/hash algorithm, its canonical hash is recorded, provider compatibility is pinned/passing, and production v2 Definition hashes still match the frozen values.

## Sequence

PR5-A freezes new `comment-data-update@2` starts and drains all nonterminal v2 update sessions to zero. PR5-B disables legacy Comment DB authority writers and proves they are off before enabling production starts for `comment-data-update@TARGET_REVISION`. There is no overlap window. PR5-C starts one controlled production smoke session, verifies authoritative DB state, reviewed Release, Promotion, Deployment event/verification/record, and evidence ledger output.

## Failure behavior

If smoke or post-cutover verification fails, freeze new v3 starts immediately. Do not re-enable legacy authority and do not route business work back to revision 2. Fix forward. If the canonical registered Definition itself must change, allocate the next free immutable revision using the normative TARGET_REVISION search rule.
