import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MemoryDeploymentAdapter,
  PERMISSIONS,
  SERVICE_CAPABILITIES,
  STREAM_KEYS,
  StateControlPlane,
  canonicalJson,
  createApplicationServiceAgentAdapter,
  deriveAccountCandidatesFromControlPlane,
  projectCompletedSessionOutcome,
  registerProductionWorkDefinitions,
  resolvePinnedSessionInput,
} from "tiktok-filter-keywords/src/comment-db-state.js";
import { migrate as migrateLegacyState } from "tiktok-filter-keywords/scripts/migrate-state-control-plane.mjs";
import { openCommentDatabase, openCommentDatabaseReadOnly } from "tiktok-filter-keywords/src/database/comment-database.js";
import { DeploymentApplicationService } from "tiktok-filter-keywords/src/application/deployment-services.js";
import { FileReleaseArtifactStore } from "tiktok-filter-keywords/src/release/artifact-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDemoRoot = path.join(repositoryRoot, "var");

function parseArgs(argv) {
  const args = { sourceDb: undefined, db: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-db") {
      args.sourceDb = argv[index + 1];
      index += 1;
    } else if (arg === "--db") {
      args.db = argv[index + 1];
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
  console.log("Usage: node scripts/run-comment-data-update-demo.mjs [--source-db PATH] [--db PATH]");
  console.log("  source-db はread-onlyでコピー元として扱います。省略時は合成fixtureを生成します。");
  console.log("  db を指定しない場合は demo/var に分離demo DBを作成します。");
}

async function assertSourceDatabase(sourceDb) {
  const db = await openCommentDatabaseReadOnly(sourceDb);
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    assert.equal(integrity.integrity_check, "ok");
  } finally {
    db.close();
  }
}

async function seedLegacyDatabase(target) {
  const db = await openCommentDatabase(target);
  const observations = [
    { username: "demo-user-a", handle: "@demo_a", commentText: "同じ迷惑コメント", postedAt: "2026-09-16T09:00:00Z", postedDate: "2026-09-16", label: "direct_nuisance" },
    { username: "demo-user-a", handle: "@demo_a", commentText: "同じ迷惑コメント 2", postedAt: "2026-09-16T09:01:00Z", postedDate: "2026-09-16", label: "direct_nuisance" },
    { username: "demo-user-b", handle: "@demo_b", commentText: "反応コメント", postedAt: "2026-09-16T09:02:00Z", postedDate: "2026-09-16", label: "reactive" },
    { username: "demo-user-c", handle: "@demo_c", commentText: "通常コメント", postedAt: "2026-09-16T09:03:00Z", postedDate: "2026-09-16", label: "normal" },
  ];
  const rawPayload = { schemaVersion: 1, observations: observations.map(({ commentText, postedAt }) => ({ source: "demo", postRef: "demo-post", collectedAt: postedAt, commentText })) };
  const payloadBytes = Buffer.from(JSON.stringify(rawPayload), "utf8");
  const payloadSha256 = createHash("sha256").update(payloadBytes).digest("hex");
  const keywords = [
    { candidate_id: "kw_demo_001", keyword: "同じ迷惑コメント", variants: ["同じ迷惑コメント"], category_id: "demo", selection_state: "selected" },
    { candidate_id: "kw_demo_002", keyword: "フォローして", variants: ["フォローして"], category_id: "demo", selection_state: "selected" },
    { candidate_id: "kw_demo_003", keyword: "反応コメント", variants: ["反応コメント"], category_id: "demo", selection_state: "selected" },
  ];
  const now = "2026-09-16T09:10:00Z";
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO raw_inputs (payload_sha256, payload_bytes, byte_length, input_format, imported_at) VALUES (?, ?, ?, ?, ?)").run(payloadSha256, payloadBytes, payloadBytes.length, "tiktokRawSnapshot-1.0.0", now);
    db.prepare("INSERT INTO raw_snapshots (snapshot_id, materialization_kind, platform, payload_sha256, snapshot_index, extracted_at, source_page_url, source_canonical_url, item_source, loaded_count, reported_count, coverage_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, "rich-snapshot", "demo", payloadSha256, 0, now, "https://demo.invalid/post", "https://demo.invalid/post", "demo-fixture", observations.length, observations.length, "synthetic demo fixture");
    const insertObservation = db.prepare("INSERT INTO snapshot_comment_observations (observation_id, snapshot_id, source_index, comment_pk, level, comment_id_raw, video_id_raw, parent_comment_id_raw, username, handle, user_id_raw, comment_text, posted_at, created_at, posted_date, like_count, reply_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertLabel = db.prepare("INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)");
    observations.forEach((item, index) => {
      const observationId = index + 1;
      insertObservation.run(observationId, 1, index, null, 0, `demo-comment-${observationId}`, "demo-video", "", item.username, item.handle, `demo-user-${observationId}`, item.commentText, item.postedAt, item.postedAt, item.postedDate, 0, 0);
      insertLabel.run(observationId, item.label);
    });
    const json = (value) => canonicalJson(value);
    db.prepare("INSERT INTO keyword_candidate_publications (run_id, snapshot_id, request_id, input_fingerprint, source_dataset_artifact_sha256, base_run_id, published_at, applied_at, is_current, handoff_manifest_json, candidate_generation_request_json, candidate_proposal_json, run_manifest_json, current_meta_json, filter_keyword_candidates_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "run_demo_seed", 1, "cgr_demo_seed", `sha256:${payloadSha256}`, `sha256:${payloadSha256}`, "run_demo_base", now, now, 1,
      json({ schema_version: 1, source: "demo" }), json({ schema_version: 1, source: "demo" }), json({ schema_version: 1, actions: keywords }), json({ schema_version: 1, source: "demo" }), json({ schema_version: 1, run_id: "run_demo_seed" }), json(keywords),
    );
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    db.close();
    throw error;
  }
  db.close();
}

async function prepareDemoDatabase(sourceDb, requestedPath) {
  mkdirSync(defaultDemoRoot, { recursive: true });
  const target = requestedPath
    ? path.resolve(requestedPath)
    : path.join(mkdtempSync(path.join(defaultDemoRoot, "run-")), "comment-history.sqlite3");
  if (existsSync(target)) throw new Error(`demo DBは既に存在します。既存DBを上書きしません: ${target}`);
  mkdirSync(path.dirname(target), { recursive: true });
  if (sourceDb) {
    await assertSourceDatabase(sourceDb);
    copyFileSync(sourceDb, target);
  } else {
    await seedLegacyDatabase(target);
  }
  return target;
}

function headVersion(controlPlane, stream) {
  const head = controlPlane.resolveHead(stream);
  if (!head) throw new Error(`required State head is missing: ${stream.domain}/${stream.streamKey}`);
  return head.versionId;
}

function stateOf(controlPlane, versionId) {
  return controlPlane.readVersion(versionId)?.payload?.state ?? {};
}

function readDemoRecords(db) {
  const snapshotId = db.prepare("SELECT snapshot_id FROM keyword_candidate_publications WHERE is_current = 1").get()?.snapshot_id;
  if (!snapshotId) throw new Error("current keyword publicationのsnapshotが必要です");
  return db.prepare(
    `SELECT observations.observation_id AS observationId, username, handle, comment_text AS comment,
            posted_at AS postedAt, posted_date AS postedDate, label
       FROM snapshot_comment_observations AS observations
       LEFT JOIN snapshot_comment_three_class_labels AS labels
         ON labels.observation_id = observations.observation_id
      WHERE observations.snapshot_id = ?
      ORDER BY observations.source_index`,
  ).all(snapshotId).map((row) => ({ ...row, observationId: String(row.observationId) }));
}

class DemoAgentAdapter {
  constructor(delegate, controlPlane, records) {
    this.delegate = delegate;
    this.controlPlane = controlPlane;
    this.records = records;
  }

  async run(request) {
    const capability = request.task.contract.requiredCapabilities[0];
    const inputs = { ...(request.task.inputs ?? {}) };
    if (capability === "corpus.update") {
      const prior = stateOf(this.controlPlane, inputs.initialCorpusVersionId);
      inputs.state = {
        ...prior,
        schema_version: prior.schema_version ?? 1,
        snapshot_refs: [...(prior.snapshot_refs ?? [])],
        evidence_ids: [...new Set([...(prior.evidence_ids ?? []), ...(inputs.evidenceIds ?? [])])],
        records: prior.records ?? this.records,
      };
    } else if (capability === "classification.assess") {
      inputs.proposedState = stateOf(this.controlPlane, inputs.classificationVersionId);
    } else if (capability === "keyword-selection.assess") {
      inputs.proposedState = stateOf(this.controlPlane, inputs.keywordSelectionVersionId);
    }
    return this.delegate.run({ ...request, task: { ...request.task, inputs } });
  }

  async cancel(request) {
    return this.delegate.cancel(request);
  }
}

function createArtifactBuilder(controlPlane) {
  return ({ releaseId, bundle }) => {
    const versionIds = Object.fromEntries(bundle.members.map((member) => [member.role, member.versionId]));
    const corpus = controlPlane.readVersion(versionIds.corpus);
    const classification = controlPlane.readVersion(versionIds.classification);
    const keywordSelection = controlPlane.readVersion(versionIds.keyword_selection);
    const accountCandidates = deriveAccountCandidatesFromControlPlane(controlPlane, {
      corpusVersionId: versionIds.corpus,
      classificationVersionId: versionIds.classification,
      accountPolicyVersionId: versionIds["policy:account_candidate"],
    });
    return {
      comments: canonicalJson({ schema_version: 1, releaseId, corpusVersionId: corpus.versionId, state: corpus.payload.state }),
      keywords: canonicalJson({ schema_version: 1, releaseId, keywordSelectionVersionId: keywordSelection.versionId, state: keywordSelection.payload.state }),
      accounts: canonicalJson({ schema_version: 1, releaseId, authoritativeInputs: accountCandidates.authoritativeInputs, candidates: accountCandidates.candidates }),
      classifications: canonicalJson({ schema_version: 1, releaseId, classificationVersionId: classification.versionId, state: classification.payload.state }),
    };
  };
}

async function runDemo({ sourceDb, dbPath }) {
  const demoDbPath = await prepareDemoDatabase(sourceDb, dbPath);
  const db = await openCommentDatabase(demoDbPath, { stateControlPlane: true });
  if (!db.prepare("SELECT 1 FROM state_stream_heads LIMIT 1").get()) migrateLegacyState(db);
  const controlPlane = new StateControlPlane(db);
  const demoRecords = readDemoRecords(db);
  const sourceSnapshotId = db.prepare("SELECT snapshot_id FROM keyword_candidate_publications WHERE is_current = 1").get().snapshot_id;
  const deploymentAdapter = new MemoryDeploymentAdapter();
  const externalDeploymentService = new DeploymentApplicationService(controlPlane, { adapter: deploymentAdapter });
  const artifactRoot = path.join(path.dirname(demoDbPath), "artifacts");
  const applicationAdapter = createApplicationServiceAgentAdapter({
    controlPlane,
    deploymentAdapter,
    artifactStore: new FileReleaseArtifactStore(artifactRoot),
    artifactBuilder: createArtifactBuilder(controlPlane),
  });
  const agentAdapter = new DemoAgentAdapter(applicationAdapter, controlPlane, demoRecords);
  const worker = {
    workerId: "demo-application-service",
    revision: 1,
    enabled: true,
    capabilities: [...SERVICE_CAPABILITIES],
    enforceablePermissions: [...PERMISSIONS],
    enforceableBudgets: [],
    routingPriority: 1,
    physicalAvailable: true,
  };

  try {
    const publicApi = await import("work-orchestrator");
    const orchestrator = new publicApi.WorkOrchestrator({ agentAdapter, workers: [worker] });
    const definitions = await registerProductionWorkDefinitions({ publicApi, orchestrator });
    const sessionId = `demo-comment-data-update-${Date.now()}`;
    const pinned = resolvePinnedSessionInput(controlPlane, {
      updateRequestId: `${sessionId}:request`,
      evidenceSource: { kind: "legacy-comment-db", sourceRef: `raw_snapshots/${sourceSnapshotId}` },
      pinned: {
        initialCorpusVersionId: headVersion(controlPlane, STREAM_KEYS.corpus),
        classificationVersionId: headVersion(controlPlane, STREAM_KEYS.classification),
        keywordSelectionVersionId: headVersion(controlPlane, STREAM_KEYS.keywordSelection),
        corpusPolicyVersionId: headVersion(controlPlane, STREAM_KEYS.corpusPolicy),
        classificationPolicyVersionId: headVersion(controlPlane, STREAM_KEYS.classificationPolicy),
        keywordPolicyVersionId: headVersion(controlPlane, STREAM_KEYS.keywordPolicy),
        accountPolicyVersionId: headVersion(controlPlane, STREAM_KEYS.accountPolicy),
        projectionDefinitionVersionId: headVersion(controlPlane, STREAM_KEYS.projectionDefinition),
      },
    });

    await orchestrator.startSession({
      sessionId,
      workDefinitionId: "comment-data-update",
      revision: 2,
      input: pinned,
    });

    let state = orchestrator.state(sessionId);
    const promotionReview = Object.values(state.tasks).find((task) => task.stepId === "13-review-production-promotion" && task.state !== "completed");
    assert.ok(promotionReview, "demo should reach the Production Promotion human task");
    await orchestrator.claimTask(sessionId, promotionReview.taskId, { actorId: "demo-reviewer", actorType: "human" });
    await orchestrator.completeHumanTask(sessionId, promotionReview.taskId, { actorId: "demo-reviewer", actorType: "human" }, "accept", { rationale: "demo approval" });

    state = orchestrator.state(sessionId);
    const wait = Object.values(state.waits).find((candidate) => candidate.state === "waiting" && candidate.eventType === "deployment.completed");
    assert.ok(wait, "demo should wait for deployment.completed");
    const request = db.prepare("SELECT * FROM deployment_requests WHERE workflow_session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId);
    assert.ok(request, "deployment ledger entry is required");
    const external = deploymentAdapter.complete(request.deployment_request_id);
    externalDeploymentService.receiveCompletedEvent({
      eventType: "deployment.completed",
      correlationKey: request.deployment_request_id,
      payload: {
        deploymentRequestId: request.deployment_request_id,
        target: "production",
        releaseId: request.release_id,
        status: "succeeded",
        externalRunRef: external.externalRunRef,
        completedAt: new Date().toISOString(),
      },
    });
    const delivery = await externalDeploymentService.deliverPendingEvents(async (workflowSessionId, event, eventId) => {
      await orchestrator.receiveExternalEvent(workflowSessionId, event, { actorId: "demo-deployment-system", actorType: "external" }, `demo-event:${eventId}`);
    });

    const view = orchestrator.getSessionView(sessionId);
    const outcome = projectCompletedSessionOutcome(view);
    assert.equal(view.session.state, "completed");
    assert.equal(outcome.status, "deployed");
    assert.equal(delivery.pending, 0);
    assert.equal(db.prepare("SELECT status FROM deployment_requests WHERE deployment_request_id = ?").get(request.deployment_request_id).status, "succeeded");
    assert.ok(controlPlane.resolveHead(STREAM_KEYS.deployment));

    return {
      sourceDb: sourceDb ?? "synthetic-fixture",
      demoDb: demoDbPath,
      artifactRoot,
      definitionHashes: Object.fromEntries(definitions.map((definition) => [definition.workDefinitionId, definition.definitionHash])),
      sessionId,
      sessionState: view.session.state,
      outcome,
      releaseId: request.release_id,
      deploymentRequestId: request.deployment_request_id,
      delivery,
      heads: {
        corpus: controlPlane.resolveHead(STREAM_KEYS.corpus)?.versionId,
        classification: controlPlane.resolveHead(STREAM_KEYS.classification)?.versionId,
        keywordSelection: controlPlane.resolveHead(STREAM_KEYS.keywordSelection)?.versionId,
        promotion: controlPlane.resolveHead(STREAM_KEYS.promotion)?.versionId,
        deployment: controlPlane.resolveHead(STREAM_KEYS.deployment)?.versionId,
      },
    };
  } finally {
    db.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }
  console.log(JSON.stringify(await runDemo(args), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

export { DemoAgentAdapter, runDemo };
