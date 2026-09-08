# Code change map

Paths below are repository-relative to the supplied package structure.

## `package/scripts/comment-database.mjs`

### Change command registry and usage

For `generate-three-class-workset`:

```diff
- --reference
- --workspace
- --state-dir
+ --history
+ --output
```

Add command:

```text
validate-three-class-response --workset <zip> --response <json>
```

### Parsing

- add `--history`, `--workset`, `--response` options;
- keep snapshot selector validation for generator;
- validator does not require DB/snapshot arguments;
- reject unsupported legacy options on generator.

### Dispatch

Generator calls the rewritten adapter with:

```js
{
  dbPath,
  snapshotRefs,
  snapshotShas,
  historyPath,
  outputPath,
}
```

Validator calls a new validator function with:

```js
{
  worksetPath,
  responsePath,
}
```

## `package/scripts/adapters/three-class-workset.js`

This is a rewrite of responsibilities, not a small wrapper change.

### Remove from new runtime path

- `PIPELINE_PATH`
- `prepare-single-roundtrip`
- `referencePath`
- `stateDir`
- workspace staging contract
- request manifest / prepare receipt checks
- request ID bindings
- provenance creation
- old workset manifest handling
- old finalize/handoff state assumptions

### Keep/reuse where useful

- repository DB helpers;
- selected snapshot resolution and reads;
- existing projection ordering through `buildAnalysisArtifacts()` or an equivalent direct projection call;
- fail-closed file output style.

### Add

- canonical v1 prompt/rules loading;
- strict v1 history parser/validator;
- exact comment dedupe;
- sequential ID generation;
- UUID v4 generation;
- ITEMS creation;
- response schema creation;
- exactly-five-file ZIP creation;
- response/workset validator entry point (or delegate to a focused module).

Recommended design is to split protocol validation/schema helpers into a small dedicated module if this keeps the adapter readable. The exact module name is implementation detail.

## `package/scripts/pack-three-class-workset.py`

Two acceptable implementation choices:

### Option A — simplify and retain Python packer

Make it package exactly five explicitly supplied regular files and no workspace traversal.

### Option B — replace packaging in Node

Remove the Python dependency from the new path if an existing safe ZIP dependency/utility is already available.

The protocol does not require Python. Choose the least invasive implementation that satisfies archive safety tests.

Do not preserve old `request/`, `provenance/`, manifest, content-hash ID, or workspace enumeration logic.

## `package/templates/three-class-workset/`

Replace old README-oriented template with canonical v1 templates:

```text
PROMPT.md
RULES.md
```

`response.schema.json` is generated per workset because `workset_id` is run-specific. Keep a schema-template/helper in code or repository as convenient.

`HISTORY.json` and `ITEMS.json` are generated inputs, not static templates.

## `package/src/processing/analysis-input/raw-snapshot-projection.js`

No product-level change required.

The current stable projection/order can be reused locally. Only its `comment` field crosses the new ChatGPT boundary.

Do not put projection manifest or the remaining fields into the ZIP.

## `package/tests/three-class-workset.test.js`

Replace old pipeline/provenance/workspace contract tests rather than layering the new contract on top.

The new test suite is defined in `07_ACCEPTANCE_TESTS.md`.

## Legacy integrated-labeling files

Do not need deletion in this issue:

```text
docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py
docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/src/single_roundtrip.py
...
```

But the new generator/validator must work when these are unavailable.

## One-shot migration

Add a one-shot script or migration utility outside the runtime workset path to produce v1 HISTORY from the existing legacy adjudications.

It may depend on the legacy reference/key formula only for migration. Runtime must not.
