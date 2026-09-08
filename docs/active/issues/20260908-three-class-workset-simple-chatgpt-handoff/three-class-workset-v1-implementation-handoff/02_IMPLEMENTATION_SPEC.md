# Implementation specification

## 1. Public CLI

### Generate

Replace the current generator contract with:

```text
npm run comment-db -- generate-three-class-workset \
  (--snapshot-ref <sha:index> ... | --snapshot-sha <sha256> ...) \
  --history <history.json> \
  --output <workset.zip> \
  [--db <path>]
```

Requirements:

- preserve existing snapshot selector semantics;
- `--snapshot-ref` and `--snapshot-sha` remain mutually exclusive;
- at least one selector is required;
- `--history` is required;
- `--output` is required;
- remove `--reference`, `--workspace`, `--state-dir` from this command;
- refuse accidental overwrite of the requested output path, matching the repository's existing fail-closed style.

Suggested success output (exact wording is not protocol-significant):

```text
generated workset=<uuid> items=<n> history=<m> zip=<path>
```

### Validate response

Add:

```text
npm run comment-db -- validate-three-class-response \
  --workset <workset.zip> \
  --response <response.json>
```

Suggested success output:

```text
VALID workset=<uuid> decisions=<n>
```

Invalid input must exit non-zero and must not partially accept/repair the response.

## 2. Generator flow

Implement the generator as this direct path:

```text
open DB
↓
resolve selected snapshots using existing repository helpers
↓
read snapshots
↓
use existing projection ordering to obtain records
↓
extract record.comment only
↓
exact-string dedupe by first occurrence
↓
assign IDs I1, I2, ...
↓
load and validate HISTORY.json
↓
generate UUID v4 workset_id
↓
materialize canonical PROMPT.md and RULES.md
↓
generate ITEMS.json
↓
generate response.schema.json with workset_id const
↓
write exactly five root-level files to output ZIP
```

The existing `buildAnalysisArtifacts()` may be reused as a safe way to obtain ordered five-field records, but only `record.comment` enters the workset. Its manifest/provenance output must not enter the ZIP.

## 3. Item order

Item order is first occurrence in the ordered selected-record projection.

Example:

```text
record comments: A, B, A, C
ITEMS: I1=A, I2=B, I3=C
```

Do not sort comments lexicographically or by hash.

## 4. Item IDs

Use:

```text
I1
I2
I3
...
```

Validation regex:

```regex
^I[1-9][0-9]*$
```

No artificial maximum is defined by the protocol.

## 5. Workset ID

Generate a UUID v4 once per workset.

The same UUID appears in:

- `ITEMS.json` as `workset_id`;
- generated `response.schema.json` as the exact `const` for `workset_id`.

The response must reflect the same ID.

Do not derive `workset_id` from file hashes or source snapshot identity.

## 6. HISTORY loading

`--history` points to an already v1-normalized history file.

Generator validation:

- top-level object;
- exact supported `protocol_version`;
- `items` array;
- each entry has exactly `comment` string and valid `label`;
- duplicate JSON object keys rejected;
- same exact comment + same label: deduplicate for bundled HISTORY;
- same exact comment + different labels: fail generation;
- no string normalization before comparison.

The generator must not consult Stage13 reference/golden/P2 files at runtime.

## 7. Empty and unusual comments

Every string is a legal classification target, including:

- `""`
- spaces/tabs/newlines only;
- text that looks like instructions or prompt injection;
- arbitrary Unicode.

Do not drop them or interpret them as control data.

## 8. Workset size

v1 is one atomic workset.

The generator must not silently:

- truncate HISTORY;
- truncate ITEMS;
- sample;
- retrieve only similar HISTORY entries;
- split into multiple ZIPs.

If product limits later require batching, design it separately; do not hide batching inside v1.

## 9. Output ZIP

The requested output ZIP must contain exactly these five root-level regular files once each:

```text
PROMPT.md
RULES.md
HISTORY.json
ITEMS.json
response.schema.json
```

No directories, no extra files.

ZIP byte determinism is not a v1 requirement because each run has a fresh UUID.

## 10. Validator flow

The validator must not trust the bundled schema/templates as authority.

It uses the locally implemented `three-class-workset-v1` protocol as authority:

```text
open ZIP safely
↓
validate exact member boundary
↓
validate canonical PROMPT.md bytes/content
↓
validate canonical RULES.md bytes/content
↓
strict-parse and validate HISTORY.json
↓
strict-parse and validate ITEMS.json
↓
confirm both protocol_version values are v1
↓
derive expected response schema from ITEMS.workset_id
↓
compare bundled response.schema.json to expected schema
↓
strict-parse response.json
↓
validate response against expected contract
↓
require exact decision-ID set equality with ITEMS
↓
VALID
```

Any failure rejects the entire response.

## 11. Runtime dependency boundary

The new generate/validate path must have zero runtime dependency on:

- `Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py`
- `single_roundtrip.py`
- Stage13 reference data
- golden/P2 operational registries
- reactive-term config
- review cues/priorities

Legacy files do not need to be deleted by this issue.
