# Review Changes

This revision applies the post-handoff review decisions.

## Adopted corrections

1. **Production recovery is mandatory for this issue.**
   The prior wording allowed production recovery to be conditional. Because the incident already contains a broken production corpus head, the issue cannot close without executing recovery and verifying the deployed corrected release.

2. **Added a concrete recovery CLI contract.**
   The existing operator currently exposes `start / sessions / tasks / human-task`; implementation must add top-level `recovery` commands rather than relying on undocumented ad-hoc scripts.

3. **Added non-mutating `recovery plan` and plan fingerprint binding.**
   Review Round 2 refined the sequence to `freeze -> drain -> plan -> start`, so the plan is created after normal session activity has stopped. `recovery start` still rejects stale or changed plans before corpus mutation. See `13_REVIEW_ROUND_2.md`.

4. **Added mandatory `recovery verify`.**
   A status command can merely echo stored state. `verify` must re-read state, generated artifacts, and served deployment identity. A successful immutable verification receipt is required before unfreeze and issue closure.

5. **Narrowed Recovery comment-label authority.**
   Same-comment inheritance during recovery is scoped to current recovery data and DB-global comment history is prohibited. Review Round 2 further refined exact-label recovery to current exact five-field dedupe groups, including labels found only on dedupe losers. See `13_REVIEW_ROUND_2.md`.

6. **Added ChatGPT safety evidence to the production close gate.**
   `previouslyResolvedItemCount` must be zero in the final recovery verification evidence.

## No change

The following core decisions remain unchanged:

- ordered immutable snapshot corpus;
- five-field exact first-win dedupe;
- no normalization;
- complete versioned classification state;
- Source Dataset v2 as downstream authority;
- cross-pin / source SHA release gates;
- no rollback to the known-broken semantics;
- workflow revision and legacy CLI semantics remain out of scope unless required by the new recovery command surface.
