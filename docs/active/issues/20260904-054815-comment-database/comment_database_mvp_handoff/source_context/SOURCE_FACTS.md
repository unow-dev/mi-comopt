# Supplied Source Facts

These are the only repository/source assumptions used by this handoff.

## From `ISSUE_BODY.md`

- Goal: safely accumulate collected comments in-repository for filter-keyword investigation, comment search, and trend analysis.
- Candidate persisted information includes comment body, collection time, related post, filter decision, and detected keyword.
- Personal-identifying data should be minimized and justified.
- SQLite is the proposed initial local DB.
- Real DB files should be excluded from Git while schema/migrations/init instructions are versioned.
- Source-service terms/privacy requirements must be checked.

## From workspace files

- root package is an npm workspace containing `package/`.
- Node engine requirement is `>=24 <25`.
- `package/README.md` says `package/` is the deliverable boundary.
- Current package dependencies are React/ReactDOM; there is no SQLite dependency in the supplied package metadata.

## Not supplied

- Collector implementation.
- Collector output schema.
- Stable source-native comment-ID contract.
- Existing comment persistence schema.
- Filter-decision value/version contract.
- Per-comment detected-keyword artifact contract.

The handoff intentionally does not invent these missing contracts.
