# Comment Database MVP — Implementation Handoff

This package is the implementation handoff for the issue **「収集コメントのデータベース化」**.

## Start here

1. Read `IMPLEMENTATION_HANDOFF.md`.
2. Implement the schema in `schema/001_init.sql`.
3. Implement the normalized import boundary exactly as specified.
4. Run the test plan in `TEST_PLAN.md` and satisfy `ACCEPTANCE_CRITERIA.md`.
5. Do **not** expand the MVP into collector-specific parsing, comment deduplication, filter-evaluation persistence, keyword-hit persistence, FTS, or retention automation.

## Source facts used

The supplied source bundle establishes only these implementation facts:

- The issue asks for a repository-local database for accumulated comments, search, keyword investigation, and trend analysis.
- SQLite is the preferred initial database candidate.
- Real database files must not be committed to Git; schema/migrations/initialization instructions should be versioned.
- Data minimization and privacy requirements must be considered.
- The repository is an npm workspace and requires Node `>=24 <25`.
- `package/` is the deliverable boundary.
- The supplied bundle does **not** contain the collector implementation or an existing comment-record schema.

Because the collector contract is not present, this MVP defines a small normalized import boundary and keeps collector-specific adaptation out of scope.

## Package contents

- `IMPLEMENTATION_HANDOFF.md` — authoritative implementation specification
- `DECISIONS.md` — adopted/rejected design alternatives
- `ACCEPTANCE_CRITERIA.md` — completion gate
- `TEST_PLAN.md` — required automated tests
- `FOLLOW_UP_COLLECTOR_ADAPTER.md` — separate follow-up scope
- `schema/001_init.sql` — migration 001 to implement
- `examples/normalized-comments.v1.json` — valid input example
- `source_context/ISSUE_BODY.md` — original supplied issue body

If any document conflicts with `IMPLEMENTATION_HANDOFF.md`, the handoff specification wins.
