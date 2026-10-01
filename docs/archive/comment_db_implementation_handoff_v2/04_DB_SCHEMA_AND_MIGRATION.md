# Comment DB Physical Schema and Migration Contract

## 1. State Control Plane tables

The minimal generic control plane contains seven tables:

```text
state_streams
state_versions
state_stream_heads
state_version_dependencies
state_proposals
state_decisions
state_transitions
```

### state_streams

```text
stream_id       PK
domain          NOT NULL
stream_key      NOT NULL
created_at      NOT NULL
UNIQUE(domain, stream_key)
```

### state_versions

```text
version_id       PK
stream_id        NOT NULL FK
version_no       NOT NULL
semantic_sha256  NOT NULL
origin_kind      NOT NULL  -- genesis_migration | commit
created_at       NOT NULL
UNIQUE(stream_id, version_no)
```

`semantic_sha256` is NOT unique within a stream.

### state_stream_heads

```text
stream_id        PK
head_version_id  NOT NULL
updated_at       NOT NULL
```

Use a same-stream integrity constraint, preferably composite FK support through a suitable unique key on State Version.

A stream may exist before its first head/version.

### state_version_dependencies

```text
version_id             NOT NULL
dependency_role        NOT NULL
dependency_version_id  NOT NULL
PRIMARY KEY(version_id, dependency_role, dependency_version_id)
```

Dependencies reference existing committed versions. Commit logic must prevent cycles; do not rely on a complex recursive DB constraint.

### state_proposals

```text
proposal_id                PK
stream_id                  NOT NULL
expected_head_version_id   NULL
proposed_semantic_sha256   NOT NULL
proposal_payload_json      NOT NULL
proposal_sha256            NOT NULL
created_at                 NOT NULL
```

Proposal payload includes its own schema/version.

### state_decisions

```text
decision_id                    PK
proposal_id                    NOT NULL UNIQUE
outcome                        NOT NULL -- accepted | rejected
authority_kind                 NOT NULL
authority_ref                  NOT NULL
transition_policy_version_id   NOT NULL
rationale                      NULL
decided_at                     NOT NULL
```

### state_transitions

```text
transition_id    PK
stream_id        NOT NULL
from_version_id  NULL
to_version_id    NOT NULL UNIQUE
decision_id      NOT NULL UNIQUE
committed_at     NOT NULL
```

Genesis versions have no incoming Transition.

## 2. Integration idempotency table

```text
application_operation_receipts
  operation_id      TEXT PRIMARY KEY
  operation_kind    TEXT NOT NULL
  request_sha256    TEXT NOT NULL
  result_json       TEXT NOT NULL
  completed_at      TEXT NOT NULL
```

A state-changing operation writes its completed receipt in the same transaction as the transition/head update.

## 3. Typed domain tables

### Corpus

```text
corpus_states(version_id PK/FK)
corpus_state_snapshots(version_id, snapshot_id, ...)
```

Raw snapshot/observation tables remain Evidence Plane.

### Classification

```text
classification_states(version_id PK/FK)
classification_state_labels(
  version_id,
  observation_id,
  label,
  PRIMARY KEY(version_id, observation_id)
)
```

### Keyword Selection

```text
keyword_selection_states(version_id PK/FK)
keyword_selection_entries(
  version_id,
  keyword,
  selection_state,
  ...,
  PRIMARY KEY(version_id, keyword)
)
```

Do not continue to treat `keyword_candidate_publications.is_current` as authority after cutover.

### Promotion / Deployment payloads

```text
promotion_states(version_id PK/FK, release_id NOT NULL)
deployment_states(version_id PK/FK, release_id NOT NULL, verification_ref ...)
```

## 4. Release tables

```text
release_bundles(
  release_id PK,
  bundle_sha256 UNIQUE NOT NULL,
  projection_definition_version_id NOT NULL,
  created_at NOT NULL
)

release_bundle_members(
  release_id,
  role,
  version_id,
  PRIMARY KEY(release_id, role)
)
```

Add release-artifact references/integrity metadata as needed, owned by Release/Application domain rather than Work Orchestrator ArtifactStore authority.

## 5. Existing structures

Existing raw snapshot/input/observation structures remain evidence and should be reused rather than rebuilt unnecessarily.

Current three-class label shape becomes the source for Classification Genesis. After cutover, legacy shape may remain as a compatibility projection only.

Current keyword publication row conflates state/head/run/proposal/artifact data. Migration decomposes it; after cutover, `is_current` is no longer authority and filesystem `current` is a projection/artifact convention only.

## 6. Migration policy

Use a strangler cutover per domain/stream:

```text
Legacy
  -> Backfilled
  -> Verified
  -> Cutover
  -> Legacy Read Compatibility
  -> Retired
```

Before cutover: legacy is authority and new model is shadow/backfilled.

After cutover: new model is sole authority. Any legacy-form output is generated from new state.

No authoritative dual write.

## 7. Genesis

When pre-migration logs cannot prove Proposal/Decision/Transition history, do not synthesize it.

Create:

```text
Genesis Version V1
origin_kind = genesis_migration
```

and retain legacy artifacts/timestamps as provenance/evidence.

## 8. Migration order

1. add State Control Plane + application operation receipts
2. establish Corpus semantic adoption layer
3. register/version policies
4. backfill Classification Genesis; verify; cut writes; provide legacy projection
5. decompose/backfill Keyword Selection Genesis; verify; cut authority
6. implement Release Bundle exact-version construction
7. cut Production Promotion to state stream
8. cut Deployment actual state to verified state stream
9. remove consumers of legacy current markers/direct-write paths

Account Candidate remains derived throughout.

## 9. Cutover gate per stream

A stream is cut over only when all are true:

1. legacy -> Genesis semantic equivalence verified
2. only new Commit path can change authority
3. no legacy direct authoritative write path remains
4. legacy-shaped output can be regenerated from new state
5. no consumer reads old current marker as authority
6. rollback/recovery cannot produce dual authority
7. mandatory acceptance tests for that stream pass
