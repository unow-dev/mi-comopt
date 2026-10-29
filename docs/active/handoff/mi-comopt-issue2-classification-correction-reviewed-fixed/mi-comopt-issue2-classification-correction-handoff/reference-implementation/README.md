# Standalone Domain reference

This directory contains an independent implementation of the pure classification-correction transformation. It is **not** wired into `mi-comopt`'s State Control Plane, Work Orchestrator, human review or production pipeline.

From the handoff directory:

```bash
node --test reference-implementation/*.test.mjs
```

Its schema is `{schema_version:1,labels:[...]}`. Integration must use the repository's own `normalizeLabels()` convention, check the pinned Corpus and Classification authorities, and enforce the commit-time and human review guards described in `08_CRITICAL_REVIEW_AND_REPAIRS.md`.
