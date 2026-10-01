# Source Map

This file explains which packaged source materials informed the handoff and how they should be used.

## Normative vs contextual

The normative implementation contract is contained in the numbered handoff documents and `contracts/`. Everything in `references/` and `source_context/` is contextual evidence only.

## Work Orchestrator reference

- `references/WORK_ORCHESTRATOR_API_REFERENCE.md`
- `references/WORK_ORCHESTRATOR_README.md`

Use these to map the compatibility adapter to the installed/public package API. The handoff intentionally does not guess undocumented enum literals.

## Superseded design reference

- `references/DESIGN_SPEC_V1_SUPERSEDED.md`

Useful for discussion history and broader rationale. Its custom Workflow Runtime material is superseded by v2 and MUST NOT override the normative v2 handoff.

## Issue/update-flow source context

- `source_context/ISSUE_BODY.md`
- `source_context/WORK_TASK_SEQUENCE_AS_IS.md`
- `source_context/SEQUENCE_DIAGRAM_AS_IS.md`
- `source_context/DISCUSSION_SET_CONTENTS.md`

These preserve the original problem framing and As-Is procedure.

## Repository excerpts

`source_context/repo_excerpt/` contains selected implementation files relevant to migration/cutover, including:

- Comment DB migrations 001-008
- current Comment DB and classification/keyword repositories
- keyword candidate update/candidate workflows
- account-block candidate workflow
- optimicom UI release source/release builders
- release export/verify scripts
- Pages workflow
- package scripts/dependencies

These files are a snapshot of the supplied discussion set and are not automatically updated if the repository evolves.
