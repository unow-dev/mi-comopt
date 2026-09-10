# three-class-workset labeled-comment exclusion — implementation handoff

This package is the implementation handoff for the issue in `reference/discussion-set/ISSUE_BODY.md`.

Start with `HANDOFF.md`. It is the normative implementation specification produced by the discussion. `ACCEPTANCE_TESTS.md` expands the required regression cases. The `reference/discussion-set/` directory is the supplied source snapshot used to close the design.

## Status

Design closure: 100%.

No unresolved product or data-semantics choices are intentionally left to the implementer. Local helper names and code factoring may vary if behavior remains exactly equivalent to `HANDOFF.md`.

## Important repository note

The supplied discussion set's `src/database/comment-database.js` declares schema version 7 and references `007-keyword-candidate-publications.sql`, but the 007 SQL file itself is not included in the snapshot. In the real repository, do not reconstruct or modify 007 from this handoff. Add migration 008 after the repository's existing 007.
