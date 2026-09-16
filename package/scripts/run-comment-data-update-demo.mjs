import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
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
} from "../src/comment-db-state.js";
import { openCommentDatabase, openCommentDatabaseReadOnly } from "../src/database/comment-database.js";
import { DeploymentApplicationService } from "../src/application/deployment-services.js";
import { FileReleaseArtifactStore } from "../src/release/artifact-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultSourceDb = path.join(repositoryRoot, "var", "comment-history.sqlite3");

function parseArgs(argv) {
  const args = { sourceDb: defaultSourceDb, db: undefined };
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
  console.log("  source-db はread-onlyでコピー元として扱い、指定しない場合は var/comment-history.sqlite3 を使用します。");
  console.log("  db を指定しない場合は /tmp に分離demo DBを作成します。");
}

async function assertSourceDatabase(sourceDb) {
  const db = await openCommentDatabaseReadOnly(sourceDb);
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    assert.equal(integrity.integrity_check, "ok");
    assert.ok(db.prepare("SELECT 1 FROM state_stream_heads LIMIT 1").get(), "移行済みState Control Planeが必要です");
  } finally {
    db.close();
  }
}

function prepareDemoDatabase(sourceDb, requestedPath) {
  const target = requestedPath
    ? path.resolve(requestedPath)
    : path.join(mkdtempSync(path.join(tmpdir(), "tiktok-filter-keywords-demo-")), "comment-history.sqlite3");
  if (existsSync(target)) throw new Error(`demo DBは既に存在します。既存DBを上書きしません: ${target}`);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(sourceDb, target);
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

class DemoAgentAdapter {
  constructor(delegate, controlPlane) {
    this.delegate = delegate;
    this.controlPlane = controlPlane;
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
  await assertSourceDatabase(sourceDb);
  const demoDbPath = prepareDemoDatabase(sourceDb, dbPath);
  const db = await openCommentDatabase(demoDbPath, { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  const deploymentAdapter = new MemoryDeploymentAdapter();
  const externalDeploymentService = new DeploymentApplicationService(controlPlane, { adapter: deploymentAdapter });
  const artifactRoot = path.join(path.dirname(demoDbPath), "artifacts");
  const applicationAdapter = createApplicationServiceAgentAdapter({
    controlPlane,
    deploymentAdapter,
    artifactStore: new FileReleaseArtifactStore(artifactRoot),
    artifactBuilder: createArtifactBuilder(controlPlane),
  });
  const agentAdapter = new DemoAgentAdapter(applicationAdapter, controlPlane);
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
      evidenceSource: { kind: "legacy-comment-db", sourceRef: "raw_snapshots/9" },
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
      sourceDb,
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
