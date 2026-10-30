import { batchRequestFingerprint } from "../three-class/classification-correction-batch.js";
import { batchOperationKey, readBatchRegistration } from "../application/v3/correction-batch-service.js";
import {
  ArtifactStore,
  createTemporalActivities,
  Registry,
  WorkOrchestrator,
  validateAndHashDefinition,
} from "work-orchestrator";
import { PERMISSIONS } from "../application/services.js";
import {
  buildCommentDataUpdateDefinitionV3,
  registerClassificationCorrectionDefinitionV3,
  registerCommentDataUpdateDefinitionV3,
  resolveTargetRevision,
  V3_REVISION,
} from "../workflow/v3/definitions.js";
import { resolveCorrectionBatchSessionInput, resolveCorrectionSessionInput, resolvePinnedSessionInputV3, validateClassificationCorrectionSessionInputV3, validateCommentDataUpdateSessionInputV3 } from "../workflow/v3/session-input.js";
import { createV3ApplicationServiceAgentAdapter, V3_SERVICE_CAPABILITIES } from "./task-handlers-v3.js";
import { MemoryDeploymentAdapter } from "../deployment/adapter.js";
import { MemoryReleaseArtifactStore } from "../release/artifact-store.js";
import { stateError } from "../state/errors.js";
import { canonicalJson } from "../state/canonical.js";
import { assertV3CorpusPreflight, assertV3FeatureStartAllowed, assertV3StartAllowed } from "../migration/v3-cutover.js";

/** Bridge the provider content-addressed store to the consumer's artifact
 * version writer used by v3 handoff services. Business Release artifacts do
 * not use this bridge and remain consumer-owned. */
export function createV3ArtifactVersionStore(providerArtifactStore) {
  if (!providerArtifactStore || typeof providerArtifactStore.stage !== "function" || typeof providerArtifactStore.finalize !== "function" || typeof providerArtifactStore.read !== "function") {
    throw stateError("CONFIGURATION_ERROR", "provider ArtifactStore is required");
  }
  return {
    write({ artifactVersionId, logicalPath, content, metadata = {} }) {
      const staged = providerArtifactStore.stage(content, metadata.mediaType ?? "application/octet-stream");
      providerArtifactStore.finalize(staged);
      return { artifactVersionId, logicalPath, blobHash: staged.blobHash, size: staged.size, ...metadata };
    },
    read(blobHash) {
      return providerArtifactStore.read(String(blobHash).replace(/^sha256:/, ""));
    },
  };
}

export function v3ApplicationWorkerProfile({ workerId = "comment-db-v3-application", revision = 1 } = {}) {
  return {
    workerId,
    revision,
    enabled: true,
    capabilities: [...V3_SERVICE_CAPABILITIES],
    enforceablePermissions: [...PERMISSIONS],
    enforceableBudgets: [],
    routingPriority: 1,
  };
}

export function registerV3Definition({ registry, revision = undefined } = {}) {
  if (!registry) throw stateError("REGISTRY_UNAVAILABLE", "a provider Registry is required");
  const targetRevision = revision ?? resolveTargetRevision({ registry, publicApi: { validateAndHashDefinition } });
  const definition = registerCommentDataUpdateDefinitionV3({ registry, publicApi: { validateAndHashDefinition }, revision: targetRevision });
  return { definition, revision: targetRevision };
}

export function createV3LocalRuntime({ controlPlane, registry = new Registry(), artifactStore = ArtifactStore.temporary(), workspace = undefined, deploymentAdapter = new MemoryDeploymentAdapter(), releaseArtifactStore = new MemoryReleaseArtifactStore(), artifactBuilder = undefined, classificationWorksetBuilder = undefined, keywordHandoffBuilder = undefined, revision = undefined, worker = undefined } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const { definition, revision: targetRevision } = registerV3Definition({ registry, revision });
  const correctionDefinition = registerClassificationCorrectionDefinitionV3({ registry, publicApi: { validateAndHashDefinition }, revision: 1 });
  const correctionBatchDefinition = registerClassificationCorrectionDefinitionV3({ registry, publicApi: { validateAndHashDefinition }, revision: 2 });
  const artifactVersionStore = createV3ArtifactVersionStore(artifactStore);
  const agentAdapter = createV3ApplicationServiceAgentAdapter({
    controlPlane,
    registry,
    deploymentAdapter,
    artifactStore: artifactVersionStore,
    releaseArtifactStore,
    artifactBuilder: artifactBuilder ?? (({ bundle }) => ({ "release.json": Buffer.from(canonicalJson(bundle)) })),
    classificationWorksetBuilder,
    keywordHandoffBuilder,
  });
  const runtime = new WorkOrchestrator({
    registry,
    artifactStore,
    workspace,
    agentAdapter,
    workers: [worker ?? v3ApplicationWorkerProfile()],
  });
  return { runtime, registry, artifactStore, workspace, releaseArtifactStore, agentAdapter, definition, correctionDefinition, correctionBatchDefinition, revision: targetRevision };
}

/** Build the same v3 application adapter for a Temporal Worker. The provider
 * registry/artifact store stay the runtime authority; the consumer control
 * plane remains the business authority captured by the adapter closure. */
export function createV3TemporalRuntime({ controlPlane, registry, artifactStore, client = undefined, deploymentAdapter = new MemoryDeploymentAdapter(), releaseArtifactStore = new MemoryReleaseArtifactStore(), artifactBuilder = undefined, classificationWorksetBuilder = undefined, keywordHandoffBuilder = undefined, revision = undefined, worker = undefined } = {}) {
  if (!controlPlane || !registry || !artifactStore) throw stateError("CONFIGURATION_ERROR", "controlPlane, Registry and ArtifactStore are required");
  const { definition, revision: targetRevision } = registerV3Definition({ registry, revision });
  const correctionDefinition = registerClassificationCorrectionDefinitionV3({ registry, publicApi: { validateAndHashDefinition }, revision: 1 });
  const correctionBatchDefinition = registerClassificationCorrectionDefinitionV3({ registry, publicApi: { validateAndHashDefinition }, revision: 2 });
  const artifactVersionStore = createV3ArtifactVersionStore(artifactStore);
  const agentAdapter = createV3ApplicationServiceAgentAdapter({
    controlPlane,
    registry,
    deploymentAdapter,
    artifactStore: artifactVersionStore,
    releaseArtifactStore,
    artifactBuilder: artifactBuilder ?? (({ bundle }) => ({ "release.json": Buffer.from(canonicalJson(bundle)) })),
    classificationWorksetBuilder,
    keywordHandoffBuilder,
  });
  const workers = [worker ?? v3ApplicationWorkerProfile()];
  const activities = createTemporalActivities({ registry, artifactStore, workers, agentAdapter });
  const runtime = client && typeof client.start === "function"
    ? { registry, start: (input) => client.start(input) }
    : undefined;
  return { runtime, client, activities, agentAdapter, workers, registry, artifactStore, releaseArtifactStore, definition, correctionDefinition, correctionBatchDefinition, revision: targetRevision };
}

export function prepareV3SessionInput({ controlPlane, input } = {}) {
  return resolvePinnedSessionInputV3(controlPlane, input);
}

/** Start either the local provider runtime or a Temporal client with the
 * same pinned, producer-neutral Session input. */
export async function startCommentDataUpdateV3({ runtime, controlPlane, sessionId, input, actor = { actorId: "system", actorType: "system" }, revision = undefined, inputArtifacts = [], bootstrapManifest = undefined, commandId = undefined } = {}) {
  if (!runtime || !controlPlane || typeof sessionId !== "string" || sessionId.length === 0) throw stateError("CONFIGURATION_ERROR", "runtime, controlPlane and sessionId are required");
  const sessionInput = validateCommentDataUpdateSessionInputV3(input);
  const targetRevision = revision ?? resolveTargetRevision({ registry: runtime.registry, publicApi: { validateAndHashDefinition } });
  assertV3CorpusPreflight(controlPlane);
  assertV3StartAllowed(controlPlane, targetRevision);
  const startInput = {
    sessionId,
    workDefinitionId: "comment-data-update",
    revision: targetRevision,
    input: sessionInput,
    actor,
    inputArtifacts,
    ...(bootstrapManifest ? { bootstrapManifest } : {}),
    ...(commandId ? { commandId } : {}),
  };
  if (typeof runtime.startSession === "function") return runtime.startSession(startInput);
  if (typeof runtime.start === "function") return runtime.start(startInput);
  throw stateError("CONFIGURATION_ERROR", "runtime does not support local or Temporal session start");
}

export async function startClassificationCorrectionV3({ runtime, controlPlane, sessionId, command, authenticatedActor, pinned = {}, revision = 1, commandId = undefined } = {}) {
  if (!runtime || !controlPlane || typeof sessionId !== "string" || sessionId.length === 0) throw stateError("CONFIGURATION_ERROR", "runtime, controlPlane and sessionId are required");
  if (revision !== 1) throw stateError("DEFINITION_REVISION_INVALID", "classification-correction currently supports revision 1 only");
  if (!authenticatedActor || authenticatedActor.actorType !== "human" || typeof authenticatedActor.actorId !== "string" || authenticatedActor.actorId.trim().length === 0) throw stateError("UNAUTHORIZED_ACTOR", "authenticated human actor is required");
  const input = resolveCorrectionSessionInput(controlPlane, { command, requestedBy: authenticatedActor, pinned, target: { promotionStream: "production", deploymentTarget: "production" } });
  validateClassificationCorrectionSessionInputV3(input);
  assertV3CorpusPreflight(controlPlane);
  assertV3FeatureStartAllowed(controlPlane);
  const startInput = {
    sessionId,
    workDefinitionId: "classification-correction",
    revision,
    input,
    actor: { actorId: authenticatedActor.actorId, actorType: "human" },
    ...(commandId ? { commandId } : {}),
  };
  if (typeof runtime.startSession === "function") return runtime.startSession(startInput);
  if (typeof runtime.start === "function") return runtime.start(startInput);
  throw stateError("CONFIGURATION_ERROR", "runtime does not support local or Temporal session start");
}

export function buildV3DefinitionForRuntime({ revision = V3_REVISION } = {}) {
  return buildCommentDataUpdateDefinitionV3({ revision });
}


/** One durable owner Session per business operation. Re-sending from another
 * Session ID returns the owner, including after a commit/start response loss. */
export async function startClassificationCorrectionBatchV3({ runtime, controlPlane, sessionId, command, authenticatedActor, pinned = {} } = {}) {
  if (!runtime || !controlPlane || typeof sessionId !== "string" || !sessionId.length) throw stateError("CONFIGURATION_ERROR", "runtime, controlPlane and sessionId are required");
  assertV3CorpusPreflight(controlPlane);
  assertV3FeatureStartAllowed(controlPlane);
  const prior = readBatchRegistration(controlPlane, command?.correctionOperationId);
  const input = resolveCorrectionBatchSessionInput(controlPlane, { command, authenticatedActor, pinned, savedInput: prior?.input });
  const requestFingerprint = batchRequestFingerprint(input);
  const requestedState = !prior && runtime.registry?.getRuntimeState(sessionId);
  if (requestedState) throw stateError("IDEMPOTENCY_CONFLICT", "requested Session ID already belongs to another operation");
  const registered = controlPlane.runIdempotent({ operationId: batchOperationKey(input.correctionOperationId, "registration"), operationKind: "correction-batch.register", request: { requestFingerprint } }, () => ({ sessionId, input, requestFingerprint }));
  const ownerId = registered.sessionId;
  const existing = runtime.registry?.getRuntimeState(ownerId);
  if (existing) {
    if (existing.session.workDefinitionId !== "classification-correction" || existing.session.definitionRevision !== 2 || canonicalJson(existing.session.input) !== canonicalJson(input)) throw stateError("IDEMPOTENCY_CONFLICT", "owner Session has different input");
    return { sessionId: ownerId, requestedSessionId: sessionId, revision: 2, reused: true };
  }
  const startInput = { sessionId: ownerId, workDefinitionId: "classification-correction", revision: 2, input: registered.input, actor: registered.input.requester, commandId: `start-correction-batch:${input.correctionOperationId}` };
  const response = typeof runtime.startSession === "function" ? await runtime.startSession(startInput) : await runtime.start(startInput);
  return { ...response, sessionId: ownerId, requestedSessionId: sessionId, revision: 2, reused: Boolean(prior) };
}
