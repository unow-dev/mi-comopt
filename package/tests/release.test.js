import assert from "node:assert/strict";
import test from "node:test";
import { validateRawSnapshot, validateReleaseRecord } from "../scripts/release-utils.mjs";

const row = {
  username: "user",
  handle: "@user",
  comment: "comment",
  postedAt: "2026-09-05T00:00:00Z",
  postedDate: "2026-09-05",
};

test("release raw validator requires five string fields and preserves duplicates", () => {
  assert.equal(validateRawSnapshot([row, { ...row }]).length, 2);
  for (const field of Object.keys(row)) {
    assert.throws(() => validateRawSnapshot([{ ...row, [field]: null }]), /must be a JSON string/);
  }
  assert.throws(() => validateRawSnapshot([{ ...row, extra: "nope" }]), /fields do not match/);
});

test("release record validator enforces the shared dataset identity", () => {
  const sha = `sha256:${"a".repeat(64)}`;
  const release = {
    schema_version: 1,
    updated_at: "2026-09-05T00:00:00Z",
    raw: { sha256: sha, record_count: 2, scope_id: "scope", source_ref: "fixture://raw" },
    stage13: { sha256: sha, reference_sha256: sha },
    three_class: { sha256: sha },
    keyword: { run_id: "run_123e4567-e89b-42d3-a456-426614174000", published_at: "2026-09-05T00:00:00Z", dataset_sha256: sha },
    account: { run_id: "run_223e4567-e89b-42d3-a456-426614174000", published_at: "2026-09-05T00:00:01Z", dataset_sha256: sha },
  };
  assert.equal(validateReleaseRecord(release), release);
  assert.throws(() => validateReleaseRecord({ ...release, account: { ...release.account, dataset_sha256: `sha256:${"b".repeat(64)}` } }), /dataset SHA values must match/);
});
