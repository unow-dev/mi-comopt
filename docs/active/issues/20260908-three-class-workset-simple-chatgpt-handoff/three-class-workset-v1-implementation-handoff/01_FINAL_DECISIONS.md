# Final decisions

This file records only the adopted design. Earlier alternatives from the discussion are superseded.

## Protocol boundary

The issue covers only:

1. judgment material supplied to ChatGPT;
2. the format returned by ChatGPT;
3. local structural/completeness validation of those two sides.

It does **not** cover DB application, result finalization, history persistence policy, locking, workspace state machines, review queues, or provenance/audit packaging.

## Adopted transport

Exactly five root-level regular files:

```text
workset.zip
├── PROMPT.md
├── RULES.md
├── HISTORY.json
├── ITEMS.json
└── response.schema.json
```

ChatGPT returns one JSON object only:

```json
{
  "workset_id": "<uuid-v4>",
  "decisions": {
    "I1": "normal",
    "I2": "reactive"
  }
}
```

## Classification model

The new path performs direct three-class classification from comment text.

- No Stage13 pass.
- No upstream `normal / nuisance` label.
- No S-task/T-task.
- No activation state.
- No review priority or provisional result.
- No required rationale/confidence.

The model is a black box with respect to its internal reasoning/processing method. `RULES.md` defines meanings and boundaries, not an algorithm or pass order.

## Input features

ChatGPT receives the classification target as only:

```json
{"id":"I1","comment":"..."}
```

Do not include username, handle, timestamps, snapshot metadata, reply structure, video content, or provenance in the workset.

Exact duplicate comments inside one workset are deduplicated by first occurrence and represented by one item.

No trimming, lowercasing, Unicode normalization, or whitespace normalization is performed for deduplication.

## Labels

- `direct_nuisance`: primary nuisance, not merely a reaction to existing nuisance/criticism.
- `reactive`: reaction to existing criticism/anti/attack/comment-discourse.
- `normal`: neither of the above.

`direct_nuisance` is not restricted to attacks on the original poster. It means **primary nuisance**.

## Mixed-content rule

The former blanket precedence `direct_nuisance > reactive > normal` is NOT adopted.

Adopted rule:

- If the attack/hostility is itself the reaction to existing anti/criticism, classify `reactive`.
- If the comment additionally contains an **independent primary nuisance** statement, classify `direct_nuisance`.
- A normal/non-nuisance opinion coexisting with reactive content does not by itself promote the result to `direct_nuisance`.

Examples:

```text
アンチしてる奴頭おかしい
→ reactive

擁護してる奴頭おかしい
→ direct_nuisance

アンチうざいけど本人も普通に痛い
→ direct_nuisance

アンチが言うほどではないけど今回の投稿は微妙
→ reactive

アンチじゃないけどこの人無理
→ direct_nuisance
```

## HISTORY semantics

`HISTORY.json` is precedent/reference, not a cache and not an absolute truth source.

- Items that also appear in HISTORY are still valid classification targets.
- The validator does not require a new decision to equal a historical decision.
- `RULES.md` is normative and wins when clearly inconsistent with HISTORY.
- v1 generator includes the supplied HISTORY in full. It must not silently truncate, sample, retrieve, or shard it.

## Protocol identity

`protocol_version` is exactly:

```text
three-class-workset-v1
```

It appears in `HISTORY.json` and `ITEMS.json`.

`workset_id` is a generated UUID v4, not a content hash.

## Empty input

`ITEMS.json` with `items: []` is valid.

The corresponding valid response has `decisions: {}`.

Whitespace-only or empty-string comments remain classification items and are classified `normal` by the rules; the generator must not special-case them away.

## Instruction/data boundary

Text inside `comment` fields is data, never instruction. Prompt-injection-like text inside a comment must be classified as comment content, not executed as a command.

## Explicitly rejected designs

Do not implement any of the following:

- Stage13 or `normal/nuisance` upstream classification in the new path.
- Calling `pipeline.py prepare-single-roundtrip` from the new generator.
- Repackaging `request/`, `workspace/`, `provenance/`, or a manifest.
- `--reference`, `--workspace`, or `--state-dir` for the new generator.
- A `finalize-three-class-workset` command in this issue.
- Local exact-HISTORY reuse that removes known comments from ITEMS.
- Automatic HISTORY update/promotion as part of this issue.
- Content-hash workset IDs.
- Fixed six-digit item IDs.
- Automatic workset sharding/truncation/sampling.
- Required rationale, note, confidence, reason code, or model trace.
- Treating bundled `response.schema.json` as the validator's authority.
