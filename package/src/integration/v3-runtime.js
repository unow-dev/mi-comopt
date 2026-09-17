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
  registerCommentDataUpdateDefinitionV3,
  resolveTargetRevision,
} from "../workflow/v3/definitions.js";
import { resolvePinnedSessionInputV3, validateCommentDataUpdateSessionInputV3 } from "../workflow/v3/session-input.js";
import { createV3ApplicationServiceAgentAdapter, V3_SERVICE_CAPABILITIES } from "./task-handlers-v3.js";
import { MemoryDeploymentAdapter } from "../deployment/adapter.js";
import { MemoryReleaseArtifactStore } from "../release/artifact-store.js";
import { stateError } from "../state/errors.js";
import { canonicalJson } from "../state/canonical.js";

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

export function createV3LocalRuntime({ controlPlane, registry = new Registry(), artifactStore = ArtifactStore.temporary(), workspace = undefined, deploymentAdapter = new MemoryDeploymentAdapter(), releaseArtifactStore = new MemoryReleaseArtifactStore(), artifactBuilder = undefined, classificationWorksetBuilder = undefined, revision = undefined, worker = undefined } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const { definition, revision: targetRevision } = registerV3Definition({ registry, revision });
  const artifactVersionStore = createV3ArtifactVersionStore(artifactStore);
  const agentAdapter = createV3ApplicationServiceAgentAdapter({
    controlPlane,
    deploymentAdapter,
    artifactStore: artifactVersionStore,
    releaseArtifactStore,
    artifactBuilder: artifactBuilder ?? (({ bundle }) => ({ "release.json": Buffer.from(canonicalJson(bundle)) })),
    classificationWorksetBuilder,
  });
  const runtime = new WorkOrchestrator({
    registry,
    artifactStore,
    workspace,
    agentAdapter,
    workers: [worker ?? v3ApplicationWorkerProfile()],
  });
  return { runtime, registry, artifactStore, workspace, releaseArtifactStore, agentAdapter, definition, revision: targetRevision };
}

/** Build the same v3 application adapter for a Temporal Worker. The provider
 * registry/artifact store stay the runtime authority; the consumer control
 * plane remains the business authority captured by the adapter closure. */
export function createV3TemporalRuntime({ controlPlane, registry, artifactStore, client = undefined, deploymentAdapter = new MemoryDeploymentAdapter(), releaseArtifactStore = new MemoryReleaseArtifactStore(), artifactBuilder = undefined, classificationWorksetBuilder = undefined, revision = undefined, worker = undefined } = {}) {
  if (!controlPlane || !registry || !artifactStore) throw stateError("CONFIGURATION_ERROR", "controlPlane, Registry and ArtifactStore are required");
  const { definition, revision: targetRevision } = registerV3Definition({ registry, revision });
  const artifactVersionStore = createV3ArtifactVersionStore(artifactStore);
  const agentAdapter = createV3ApplicationServiceAgentAdapter({
    controlPlane,
    deploymentAdapter,
    artifactStore: artifactVersionStore,
    releaseArtifactStore,
    artifactBuilder: artifactBuilder ?? (({ bundle }) => ({ "release.json": Buffer.from(canonicalJson(bundle)) })),
    classificationWorksetBuilder,
  });
  const workers = [worker ?? v3ApplicationWorkerProfile()];
  const activities = createTemporalActivities({ registry, artifactStore, workers, agentAdapter });
  const runtime = client && typeof client.start === "function"
    ? { registry, start: (input) => client.start(input) }
    : undefined;
  return { runtime, client, activities, agentAdapter, workers, registry, artifactStore, releaseArtifactStore, definition, revision: targetRevision };
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

export function buildV3DefinitionForRuntime({ revision = 3 } = {}) {
  return buildCommentDataUpdateDefinitionV3({ revision });
}
