# Validation contract

## Principle

`validate-three-class-response` validates both the workset and the response.

The local v1 implementation is the authority. The bundled `response.schema.json` is not trusted to define what v1 means.

## Strict JSON parsing

Reject duplicate object keys in all JSON that the validator consumes:

- `HISTORY.json`
- `ITEMS.json`
- `response.schema.json`
- `response.json`

Do not rely on ordinary last-key-wins `JSON.parse()` semantics unless a duplicate-key detection layer precedes it.

## Workset validation sequence

Reject unless all hold:

1. ZIP can be opened safely.
2. ZIP has exactly five entries.
3. Entry names exactly equal:
   - `PROMPT.md`
   - `RULES.md`
   - `HISTORY.json`
   - `ITEMS.json`
   - `response.schema.json`
4. No duplicate member name.
5. No directory, nested path, absolute path, traversal path, backslash ambiguity, or symlink entry.
6. `PROMPT.md` equals the canonical v1 prompt bundled with the implementation.
7. `RULES.md` equals the canonical v1 rules bundled with the implementation.
8. `HISTORY.json` is valid v1 history.
9. `ITEMS.json` is valid v1 items.
10. HISTORY and ITEMS both declare `three-class-workset-v1`.
11. `workset_id` is valid UUID v4.
12. Item IDs are unique and match `^I[1-9][0-9]*$`.
13. ITEMS contains no exact duplicate comment.
14. HISTORY contains no same-comment/different-label conflict.
15. Generate the expected v1 response schema locally from `workset_id`.
16. Bundled `response.schema.json` structurally equals the expected generated schema.

For canonical JSON comparison of the schema, parse strictly and compare the data structure rather than relying on whitespace/indentation, unless the implementation intentionally chooses canonical bytes for both generator and validator.

## Response validation sequence

After the workset itself is valid:

1. strict-parse `response.json`;
2. top-level object only;
3. exact top-level properties `workset_id`, `decisions`;
4. `response.workset_id == ITEMS.workset_id`;
5. `decisions` is an object;
6. every decision key matches the item-ID syntax;
7. every value is one of the three labels;
8. no additional fields;
9. exact set equality:

```text
set(response.decisions.keys()) == set(ITEMS.items[*].id)
```

This set check is mandatory even though a response schema is bundled.

## Atomic rejection

Any failed check makes the whole response invalid.

The validator must not:

- accept a subset;
- drop extra keys;
- synthesize missing decisions;
- rewrite invalid labels;
- prefer HISTORY labels;
- repair malformed JSON.

## Empty workset

`items: []` is valid and requires exactly:

```json
{
  "workset_id": "<same uuid>",
  "decisions": {}
}
```

## Suggested error families

Exact names may follow repository conventions, but keep failures distinguishable at least by category:

- CLI argument error
- unsafe/invalid archive
- protocol/template mismatch
- invalid HISTORY
- invalid ITEMS
- invalid bundled schema
- invalid response JSON/schema
- workset ID mismatch
- decision coverage mismatch

No error category should trigger side effects because this validator is read-only.
