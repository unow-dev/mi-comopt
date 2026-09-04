# Verified Source Facts

このhandoffで直接確認したsource facts。

## Source archive

Input archive:

```text
layered_architecture_discussion_set.zip
```

SHA-256:

```text
08fabbcbc17d90dc134fb4af866a79b2455f71250543cc5d2b38411ae2797d63
```

## Package

- `package/package.json` は `private: true`。
- package scripts:
  - `candidate-workflow`
  - `account-candidate-workflow`
  - `comment-db`
  - `verify:data`
- workspace root engine requirementはNode `>=24 <25`。

## Current responsibility mixing

`src/lib/` に以下が同居している。

- candidate processing
- update flow
- artifact validation
- account candidate processing
- Comment DB
- NEW badge UI logic
- filesystem publication

## Account provenance

- account CLIは `../src/lib/account-block-candidate-workflow.js` をimport。
- `verify-data.mjs` も同じ旧pathをimport。
- committed manifest generator SHAとaccount CLI script SHAが一致する。

## UI

`src/App.jsx` は以下を直接importしている。

- `./data/filterKeywordCandidates.json`
- `./data/accountBlockCandidates.json`
- `./data/candidateWorkflowConfig.json`

さらに以下のraw artifact fieldsを直接参照している。

- `candidate_id`
- `introduced_at`
- `direct_nuisance_hits`
- `reactive_hits`
- `normal_hits`
- `precision_excluding_reactive`
- `match_type`
- `direct_nuisance_count`
- `evidence_sample`
- `new_keyword_display_days`

## NEW badge duplication

`DEFAULT_NEW_KEYWORD_DISPLAY_DAYS` / `isNewCandidate()` は:

- `src/lib/new-badge.js`
- `src/lib/candidate-workflow.js`

の双方に存在する。

## Comment DB

Comment DBは既存handoffで以下が既に決定済み。

- SQLite / Node 24 built-in `node:sqlite`
- normalized versioned JSONをDB境界とする
- collector固有parsingは別adapter/follow-up
- collector implementation/output schemaはsupplied sourceにない
