# Review checklist / rejection triggers

Reject the implementation if any of the following appears:

- wrapper parsing inside `src/database/**` or `src/processing/**`
- format auto-detection between legacy snapshot and new wrapper
- item-by-item calls to `importRawInput`
- reserialization of each item as stored raw payload
- generic `?? ""` or `?? 0` fallback for source fields
- `Number(null)` on any of the seven newly nullable DB reads
- `reportedCount = stats.commentCount`, `loadedCount`, or array length
- `.trim()`, Unicode normalization, or Date conversion on raw DTO strings
- comment or snapshot sorting in the adapter
- adapter-level dedupe
- schema constraint `level === 1` based only on the current dataset
- invented schemas for currently opaque rich-array elements
- weakening the legacy `tiktokRawSnapshot-1.0.0` schema to accept wrapper nulls
- widening DB nullability beyond the seven agreed fields without separate evidence/decision
- committing the supplied real `new-comments.json`

A PR is structurally acceptable when wrapper knowledge stops at Collector/composition-root boundaries, generic DB changes are limited to the seven nullability fields, and the full wrapper enters `importRawInput` once.
