# Source baseline used for this handoff

Prepared against repository `unow-dev/mi-comopt` main and the supplied discussion snapshot on 2026-09-05.

Known current GitHub blob SHAs observed during handoff preparation:

```text
package/src/database/comment-database.js
  2bf8d5257dc8537fad24a61fafd912c31946f936

package/db/comment-database/001-init.sql
  dd6374a60eb28b6ef28333f6cb2b6ce003e527c2

package/scripts/comment-database.mjs
  ac96d1078d6eb9b4c0dedf3a2730404a2e034327

package/package.json
  0d33a72a01aa86a2ba0464a1174eaff968d4357d

.gitignore
  ece39330dc2147086e949ff2295dc2c855bf3c79

docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py
  97fffda2de4aa3a007d0a076b7e314cba49dff5b

package/src/processing/account-block-candidates/account-block-candidate-workflow.js
  0b5f1464977cc84993209053011f7a923c968e4e
```

If any of these changed before implementation starts, rebase/inspect the changed contract before applying the file plan. The handoff's domain decisions remain normative unless the changed upstream contract creates a direct contradiction.

Current Stage13 contract verified from main:

```text
FIELDS = username, handle, comment, postedAt, postedDate
raw Stage13 input is top-level JSON array
record must contain exactly those five fields
```

Current account candidate dataset contract verified from main:

```text
username, handle, comment, postedAt, postedDate, label
```

This is why DB-only metadata must not leak into analysis records.
