import { fileURLToPath } from "node:url";

import {
  STREAM_KEYS,
  StateControlPlane,
  PolicyApplicationService,
  backfillClassificationGenesis,
  backfillKeywordSelectionGenesis,
  canonicalJson,
  createDefaultOperationContext,
  deterministicId,
  normalizeKeywordEntries,
  normalizeLabels,
  MIGRATION_STATUSES,
  recordCutover,
  semanticSha256,
  verifyGenesisSemanticEquivalence,
} from "../src/comment-db-state.js";
import { openCommentDatabase, openCommentDatabaseReadOnly } from "../src/database/comment-database.js";

const DEFAULT_DB_PATH = undefined;
const MIGRATION_PREFIX = "migration:state-control-plane:v1";

// These policies are an explicit compatibility baseline for records that are
// being imported from the legacy Comment DB. Cutover and retirement remain a
// separate human decision.
const MIGRATION_POLICIES = Object.freeze({
  corpus: { schema_version: 1, auto_commit: true, legacy_compatibility: true },
  classification: { schema_version: 1, auto_commit: true, legacy_compatibility: true },
  "keyword-selection": { schema_version: 1, auto_commit: true, legacy_compatibility: true },
  "account-candidate": {
    schema_version: 1,
    policy_version: "1.0.0",
    candidate_label: "direct_nuisance",
    minimum_behavior_events: 2,
    evidence_sample_size: 2,
    legacy_compatibility: true,
  },
  "promotion-production": {
    schema_version: 1,
    authorization: { allowed_actor_types: ["human"] },
    legacy_compatibility: true,
  },
  "deployment-production": { schema_version: 1, auto_commit: true, legacy_compatibility: true },
  "projection-definition": { schema_version: 1, projection: "release-v1", legacy_compatibility: true },
});

function parseArgs(argv) {
  const args = { dbPath: DEFAULT_DB_PATH, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--db") {
      args.dbPath = argv[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`不明な引数です: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage: node scripts/migrate-state-control-plane.mjs [--db PATH] [--apply]");
  console.log("  --apply  Genesis/Verified と互換ポリシーをDBへ反映する（省略時はread-only確認のみ）");
}

function migrationOperationId(kind) {
  return `${MIGRATION_PREFIX}:${kind}`;
}

function readLegacySource(db) {
  const publicationRows = db.prepare(
    `SELECT run_id AS publication_id, run_id, snapshot_id, filter_keyword_candidates_json
       FROM keyword_candidate_publications
      WHERE is_current = 1`,
  ).all();
  if (publicationRows.length !== 1) throw new Error(`current keyword publication は1件必要です（実際: ${publicationRows.length}件）`);

  const publication = publicationRows[0];
  const snapshot = db.prepare(
    `SELECT snapshot_id, snapshot_index, payload_sha256
       FROM raw_snapshots
      WHERE snapshot_id = ?`,
  ).get(publication.snapshot_id);
  if (!snapshot) throw new Error("raw_snapshots に移行対象がありません");

  const observations = db.prepare(
    "SELECT COUNT(*) AS count FROM snapshot_comment_observations WHERE snapshot_id = ?",
  ).get(snapshot.snapshot_id);
  const labels = db.prepare(
    `SELECT observation_id AS observationId, label
       FROM snapshot_comment_three_class_labels
      WHERE observation_id IN (
        SELECT observation_id
          FROM snapshot_comment_observations
         WHERE snapshot_id = ?
      )
      ORDER BY observation_id`,
  ).all(snapshot.snapshot_id);

  let entries;
  try {
    entries = JSON.parse(publication.filter_keyword_candidates_json);
  } catch (error) {
    throw new Error(`current keyword publication のJSONが不正です: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error("current keyword publication は配列である必要があります");

  return {
    snapshot,
    observationCount: Number(observations.count),
    labels,
    publication: { ...publication, entries },
  };
}

function ensureStreams(controlPlane) {
  for (const stream of Object.values(STREAM_KEYS)) controlPlane.ensureStream(stream);
}

function ensurePolicyVersions(controlPlane) {
  const service = new PolicyApplicationService(controlPlane);
  const versions = {};
  for (const [policyKind, policy] of Object.entries(MIGRATION_POLICIES)) {
    const context = createDefaultOperationContext({
      operationId: migrationOperationId(`policy:${policyKind}`),
      workflowSessionId: `${MIGRATION_PREFIX}:session`,
      workDefinitionId: "comment-db-state-migration",
      stepId: `policy-${policyKind}`,
      workDefinitionRevision: 2,
    });
    versions[policyKind] = service.register(context, { policyKind, policy }).versionId;
  }
  return versions;
}

function ensureGenesis(controlPlane, streamKey, expectedVersionId, create) {
  const stream = controlPlane.ensureStream(STREAM_KEYS[streamKey]);
  const head = controlPlane.resolveHead(stream.stream_id);
  if (!head) return create(stream.stream_id);
  if (head.versionId !== expectedVersionId) {
    throw new Error(`${stream.domain}/${stream.streamKey} に既存head ${head.versionId} があり、移行対象 ${expectedVersionId} と一致しません`);
  }
  return { stateResult: "unchanged", versionId: head.versionId, semanticSha256: head.semanticSha256, reused: true };
}

function ensureMigrationStatus(controlPlane, streamId, status, options) {
  const current = controlPlane.db.prepare("SELECT status FROM state_cutovers WHERE stream_id = ?").get(streamId);
  if (current && MIGRATION_STATUSES.indexOf(current.status) >= MIGRATION_STATUSES.indexOf(status)) {
    return { streamId, status: current.status, unchanged: true };
  }
  return recordCutover(controlPlane, {
    streamId,
    status,
    ...options,
    operationId: migrationOperationId(`status:${streamId}:${status}`),
  });
}

function createCorpusGenesis(controlPlane, source, policyVersionId) {
  const state = {
    schema_version: 1,
    snapshot_refs: [`${source.snapshot.payload_sha256}:${source.snapshot.snapshot_index}`],
    evidence_ids: [],
  };
  const versionId = deterministicId("corpus", semanticSha256(state));
  const result = ensureGenesis(controlPlane, "corpus", versionId, (streamId) => controlPlane.createGenesis({
    streamId,
    versionId,
    payload: { schema_version: 1, state, migration: { source: "legacy-comment-db", legacyRef: `raw_snapshots/${source.snapshot.snapshot_id}` } },
    dependencies: [{ role: "policy", versionId: policyVersionId }],
    operationId: migrationOperationId("genesis:corpus"),
    domainHandler: {
      persist: ({ db, versionId: id, payload }) => {
        db.prepare("INSERT INTO corpus_states (version_id, state_json) VALUES (?, ?)").run(id, canonicalJson(payload.state));
        for (const snapshotRef of payload.state.snapshot_refs ?? payload.state.snapshotRefs ?? []) {
          db.prepare("INSERT INTO corpus_state_snapshots (version_id, snapshot_ref) VALUES (?, ?)").run(id, String(snapshotRef));
        }
      },
    },
  }));
  return { ...result, state };
}

function migrate(db) {
  const source = readLegacySource(db);
  const controlPlane = new StateControlPlane(db);
  ensureStreams(controlPlane);
  const policies = ensurePolicyVersions(controlPlane);
  const corpus = createCorpusGenesis(controlPlane, source, policies.corpus);

  const classificationState = normalizeLabels({ schema_version: 1, labels: source.labels });
  const classificationVersionId = deterministicId("classification", semanticSha256(classificationState));
  const classification = ensureGenesis(
    controlPlane,
    "classification",
    classificationVersionId,
    () => backfillClassificationGenesis(controlPlane, {
      labels: source.labels,
      corpusVersionId: corpus.versionId,
      policyVersionId: policies.classification,
      legacyRef: `raw_snapshots/${source.snapshot.snapshot_id}/three-class-labels`,
      versionId: classificationVersionId,
      operationId: migrationOperationId("genesis:classification"),
    }),
  );
  const classificationVerification = verifyGenesisSemanticEquivalence(controlPlane, classification.versionId, classificationState);
  if (!classificationVerification.equivalent) throw new Error("Classificationのsemantic equivalence検証に失敗しました");

  const keywordState = normalizeKeywordEntries({ schema_version: 1, entries: source.publication.entries });
  const keywordVersionId = deterministicId("keyword-selection", semanticSha256(keywordState));
  const keyword = ensureGenesis(
    controlPlane,
    "keywordSelection",
    keywordVersionId,
    () => backfillKeywordSelectionGenesis(controlPlane, {
      entries: source.publication.entries,
      corpusVersionId: corpus.versionId,
      classificationVersionId: classification.versionId,
      policyVersionId: policies["keyword-selection"],
      legacyRef: `keyword_candidate_publications/${source.publication.publication_id}`,
      versionId: keywordVersionId,
      operationId: migrationOperationId("genesis:keyword-selection"),
    }),
  );
  const keywordVerification = verifyGenesisSemanticEquivalence(controlPlane, keyword.versionId, keywordState);
  if (!keywordVerification.equivalent) throw new Error("Keyword Selectionのsemantic equivalence検証に失敗しました");

  const corpusStream = controlPlane.ensureStream(STREAM_KEYS.corpus);
  const classificationStream = controlPlane.ensureStream(STREAM_KEYS.classification);
  const keywordStream = controlPlane.ensureStream(STREAM_KEYS.keywordSelection);
  const commonNotes = {
    migration: MIGRATION_PREFIX,
    sourceSnapshotId: source.snapshot.snapshot_id,
    sourcePayloadSha256: source.snapshot.payload_sha256,
    sourceObservationCount: source.observationCount,
  };
  ensureMigrationStatus(controlPlane, corpusStream.stream_id, "backfilled", { legacyWriterEnabled: true, notes: { ...commonNotes, semanticEquivalenceVerified: true, equivalenceBasis: "raw-snapshot-adoption" } });
  ensureMigrationStatus(controlPlane, corpusStream.stream_id, "verified", { legacyWriterEnabled: true, notes: { ...commonNotes, semanticEquivalenceVerified: true, equivalenceBasis: "raw-snapshot-adoption", genesisVersionId: corpus.versionId } });
  ensureMigrationStatus(controlPlane, classificationStream.stream_id, "backfilled", { legacyWriterEnabled: true, notes: { ...commonNotes, labelCount: source.labels.length, genesisVersionId: classification.versionId } });
  ensureMigrationStatus(controlPlane, classificationStream.stream_id, "verified", { legacyWriterEnabled: true, notes: { ...commonNotes, semanticEquivalenceVerified: classificationVerification.equivalent, semanticFingerprint: classificationVerification.actualFingerprint, genesisVersionId: classification.versionId } });
  ensureMigrationStatus(controlPlane, keywordStream.stream_id, "backfilled", { legacyWriterEnabled: true, notes: { ...commonNotes, publicationId: source.publication.publication_id, keywordCount: keywordState.entries.length, genesisVersionId: keyword.versionId } });
  ensureMigrationStatus(controlPlane, keywordStream.stream_id, "verified", { legacyWriterEnabled: true, notes: { ...commonNotes, semanticEquivalenceVerified: keywordVerification.equivalent, semanticFingerprint: keywordVerification.actualFingerprint, publicationId: source.publication.publication_id, genesisVersionId: keyword.versionId } });

  return {
    source: {
      snapshotId: source.snapshot.snapshot_id,
      snapshotIndex: source.snapshot.snapshot_index,
      payloadSha256: source.snapshot.payload_sha256,
      observationCount: source.observationCount,
      labelCount: source.labels.length,
      publicationId: source.publication.publication_id,
      publicationRunId: source.publication.run_id,
      keywordCount: keywordState.entries.length,
    },
    policies,
    versions: { corpus: corpus.versionId, classification: classification.versionId, keywordSelection: keyword.versionId },
    semanticVerification: { classification: classificationVerification, keywordSelection: keywordVerification },
    cutover: "not_recorded",
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.apply) {
    const db = await openCommentDatabaseReadOnly(args.dbPath);
    try {
      const source = readLegacySource(db);
      console.log(JSON.stringify({ mode: "read-only", source: {
        snapshotId: source.snapshot.snapshot_id,
        payloadSha256: source.snapshot.payload_sha256,
        observationCount: source.observationCount,
        labelCount: source.labels.length,
        publicationId: source.publication.publication_id,
        keywordCount: source.publication.entries.length,
      } }, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  const db = await openCommentDatabase(args.dbPath, { stateControlPlane: true });
  try {
    console.log(JSON.stringify({ mode: "apply", result: migrate(db) }, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

export { MIGRATION_POLICIES, migrate, readLegacySource };
