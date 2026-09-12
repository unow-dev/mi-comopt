# Acceptance Tests

この文書は完了判定の正本。件数の現在値（24,622 / 86 / 60等）を固定仕様としてassertしない。

## A. Database / source snapshot

### AT-01 Schema v8 required

Given schema v7 DB,
when UI exporter runs,
then it fails before artifact publication and does not migrate/write the DB.

Given explicit migration command,
when it succeeds,
then `PRAGMA user_version == 8`.

### AT-02 Read-only export

Record DB file bytes/mtime or equivalent integrity before export.
Run export.
Assert no DB content mutation occurred.

### AT-03 Single current publication

No current publication → export failure.
Invalid/multiple-current state → export failure.

### AT-04 Snapshot binding

Exporter uses `current publication.snapshot_id` and publishes its `{payload_sha256,snapshot_index}`. It must not select a newer unrelated snapshot.

### AT-05 Complete labeling

For source snapshot:

```text
observations.length == snapshot.loaded_count
labels.length == observations.length
source_index == 0..N-1
all labels ∈ {normal, reactive, direct_nuisance}
```

Any violation → export failure.

### AT-06 Exact source dataset reproduction

Regenerated `prettyJson(sourceDataset)` bytes SHA must equal current publication `source_dataset_artifact_sha256`.

1-byte/field/order/label mismatch → export failure.

---

## B. Artifacts / release

### AT-07 Comments artifact identity

Published Comments artifact bytes are exactly the deterministic source dataset bytes; no alternate comments business projection is used.

### AT-08 Keyword semantic verification

Parsed DB `filter_keyword_candidates_json` must satisfy existing keyword publication invariants and `contentSha256(parsed)` must equal `current_meta.candidates_content_sha256`.

### AT-09 Keyword order preservation

Published keyword array order equals DB-current publication array order byte/parse-wise. UI does not business-resort candidates.

### AT-10 Account reuse

Exporter transforms each source record only by removing `source_index`, then calls existing account candidate function with canonical policy 1.0.0.

A test fixture must prove candidate output equals direct invocation of existing `buildAccountCandidates()`.

### AT-11 Account count is not hard-coded

Modify fixture input so candidate count changes. Release `record_count` and UI count follow generated array; no assertion/branch requires 60.

### AT-12 Overview totals

For every period:

```text
normal + reactive + direct_nuisance == observation_count
```

and each count equals direct aggregation of source dataset records within the calendar window.

### AT-13 Missing day is null, not zero

Fixture with a date gap:

```json
{"date":"...","observation_count":null,"counts":null}
```

Chart adapter receives a gap/null, not three zeros.

Fixture with observations but no direct nuisance:

```text
direct_nuisance == 0
```

These two states must remain distinguishable.

### AT-14 Coverage

All days observed → `coverage=complete`.
At least one null day → `coverage=partial`.

### AT-15 Artifact determinism

Run export twice against identical DB/policies.

All four data artifact bytes and their SHA/path names are identical.

`optimicom-ui-release.json.generated_at` may differ.

### AT-16 Manifest-last publication

Simulate failure while writing/copying an artifact before release-root replace.

Assert previously published `optimicom-ui-release.json` remains active and valid.

### AT-17 Local release verifier

Tamper each artifact one at a time. Verification must fail on byte SHA and/or shape/count mismatch.

### AT-18 Existing release non-regression

Existing `data-release.json` v1 validators/tests and `publish:joint-data` tests remain green without schema migration to v2.

---

## C. Runtime loading

### AT-19 Release pinning

Load release A. Simulate server release changing to B. Navigate among screens.

Assert page lifetime continues using artifact URLs from A until reload.

### AT-20 Lazy loading

Initial Home load fetches release root only.

Navigating to each data screen fetches only its first-needed artifact. Revisiting does not refetch successful artifact.

### AT-21 Failure isolation

Release root failure → data application fatal state and **no sample fallback**.

Comments artifact failure → Comments error only; previously valid Overview/Keywords/Accounts remain usable.

---

## D. Overview UI

### AT-22 No unsupported derived claims

Production rendered UI/source must not contain business displays equivalent to:

```text
Optimicom Score
82 / 100
GOOD
AI 推奨対応
Priority A / B / C
6-class labels
前週比 derived from unsupported contract
```

Static documentation comments are not the target; production user-facing UI is.

### AT-23 Data anchor copy

Header shows `データ基準日: <source max postedDate>` and does not use browser `new Date()` as “最終集計日時”.

Overview title does not claim real-time “いま”.

### AT-24 Partial coverage display

When selected period coverage is partial, UI shows `部分観測` while still showing observed counts. Missing days do not display as zero.

---

## E. Comments UI

### AT-25 Three-class filters

Filters are exactly semantically:

```text
すべて / 通常 / 二次反応 / 一次迷惑
```

No six-class tabs.

### AT-26 Search and pagination

Search covers comment, username, handle.
Filter/search applies before pagination.
Page size is 50.
Zero results produce empty state, not error.

### AT-27 Order

Rendered result order follows `postedDate DESC`, then `source_index ASC`.
UI does not claim exact same-day chronological ordering.

---

## F. Keywords UI

### AT-28 Recommendation, not risk

Filters/display use `高推奨 / 中推奨 / 任意` from artifact. No high/mid “risk” mapping.

### AT-29 Structured evidence only

Details use category/D/R/N/precision/variants. No generated AI reason text.

### AT-30 NEW clock

With injected clock:

- introduced 13 days 23h ago → NEW
- exactly 14 days ago → not NEW
- future introduced_at → not NEW
- null → not NEW

### AT-31 Copy semantics

Clipboard success → `copied_at` and UI “コピー済み”.
Clipboard failure → no state change.
UI never changes to “追加済み”.

---

## G. Accounts UI

### AT-32 No risk model

No risk filter/badge derived from count.

### AT-33 Evidence, not history

Modal shows `evidence_sample` under “候補判定の根拠”. It must not label this as complete posting/history data.

### AT-34 Copy vs blocked mark

Copy success changes `copied_at` only.
It does not set `blocked_marked_at`.

Explicit mark action sets `blocked_marked_at`.
Toggle off clears/sets null only for blocked mark; copied state remains.

The UI always communicates that browser-local mark is not verified TikTok state.

---

## H. Local storage robustness

### AT-35 Empty/malformed

Missing key → empty state.
Malformed JSON → app continues with empty local state + nonfatal warning.

### AT-36 Unknown schema

`schema_version != 1` → local persistence disabled and unknown data is not overwritten.
DB-derived UI remains usable.

### AT-37 Storage access failure

Throwing `SecurityError`/storage write error disables persistence only; data screens continue.

### AT-38 Local state cannot alter source data

Deleting/changing localStorage cannot change:

- observation counts
- labels
- candidate inclusion
- recommendation
- evidence

---

## I. Production/sample removal and build gates

### AT-39 No production sample dependency

Production target bundle has no runtime dependency on `src/data.js` sample business values. The file may be deleted; preferred outcome is removal.

No error path imports sample values.

### AT-40 No sample feature flag

There is no production runtime flag to switch back to sample business data. Rollback is deployment-level.

### AT-41 Full tests green

Required:

- existing package Node tests
- new UI publication tests
- target React Vitest/jsdom tests
- target Vite build
- local release verification

No known failures accepted by skip/allowlist solely to ship this issue.

### AT-42 Deployed verification

Deployment verifier fetches release root + all four artifacts and validates exact byte SHA and record counts. Release is not considered successfully deployed until this passes.
