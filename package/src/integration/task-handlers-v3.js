import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  EvidenceApplicationServiceV3,
  CorpusApplicationServiceV3,
  ClassificationHandoffService,
  ClassificationApplicationServiceV3,
  KeywordHandoffService,
  KeywordSelectionApplicationServiceV3,
  ReleaseApplicationServiceV3,
  PromotionApplicationServiceV3,
  DeploymentQueueServiceV3,
} from "../application/index.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { createV3OperationContext } from "../application/v3/context.js";
import { validateV3WorkStepResult } from "../workflow/v3/result-rules.js";

function submittedArtifact(value) {
  return value?.result?.artifact ?? value?.artifact ?? null;
}

function artifactBytes(artifactStore, artifact) {
  if (!artifact || typeof artifact.blobHash !== "string" || !artifactStore || typeof artifactStore.read !== "function") return null;
  const blobHash = artifact.blobHash.replace(/^sha256:/, "");
  try {
    return artifactStore.read(blobHash);
  } catch {
    return null;
  }
}

function parseJsonArtifact(artifactStore, value) {
  const artifact = submittedArtifact(value);
  const bytes = artifactBytes(artifactStore, artifact);
  if (!bytes) return null;
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
}

function enrichHumanInputs(capability, inputs, artifactStore) {
  const enriched = { ...inputs };
  if (capability === "evidence.ingest") {
    const artifact = submittedArtifact(inputs.inputArtifact);
    const payload = parseJsonArtifact(artifactStore, inputs.inputArtifact);
    if (artifact) enriched.inputArtifact = artifact;
    if (payload) enriched.commentBatch = payload;
  }
  if (capability === "classification.assess") {
    const response = parseJsonArtifact(artifactStore, inputs.response);
    if (response?.decisions && typeof response.decisions === "object" && !Array.isArray(response.decisions)) {
      enriched.proposedState = {
        schema_version: 1,
        labels: Object.entries(response.decisions).map(([observationId, label]) => ({ observationId, label })),
      };
    }
    if (response) enriched.response = response;
  }
  if (capability === "keyword-selection.assess") {
    const proposal = parseJsonArtifact(artifactStore, inputs.proposal);
    if (Array.isArray(proposal?.actions)) {
      enriched.proposedState = {
        schema_version: 1,
        entries: proposal.actions
          .filter((action) => action && typeof action.keyword === "string")
          .map((action) => ({
            ...action,
            selection_state: action.action === "retire" ? "retired" : action.selection_state ?? "selected",
          })),
      };
    }
    if (proposal) enriched.proposal = proposal;
  }
  return enriched;
}

function producedArtifactForResult(result, artifactStore) {
  const artifact = result?.details?.artifact;
  if (!artifact || typeof artifact.logicalPath !== "string" || typeof artifact.blobHash !== "string" || !artifactStore || typeof artifactStore.read !== "function") return undefined;
  try {
    return [{ content: artifactStore.read(artifact.blobHash.replace(/^sha256:/, "")), logicalPath: artifact.logicalPath, mediaType: "application/zip" }];
  } catch {
    return undefined;
  }
}

function attachProducedArtifacts(result, artifacts, workspace) {
  if (!artifacts || artifacts.length === 0) return {};
  if (!workspace) return { artifacts };
  for (const artifact of artifacts) {
    if (artifact.logicalPath.includes("/") || artifact.logicalPath.includes("\\") || artifact.logicalPath === "." || artifact.logicalPath === "..") throw stateError("ARTIFACT_INVALID", "v3 agent logicalPath must be a single output file name");
    writeFileSync(path.join(workspace.outputPath, artifact.logicalPath), artifact.content, { flag: "wx" });
  }
  return {};
}

export const V3_SERVICE_CAPABILITIES = Object.freeze([
  "evidence.ingest", "corpus.update", "classification.handoff.prepare", "classification.assess", "classification.finalize",
  "keyword-selection.handoff.prepare", "keyword-selection.assess", "keyword-selection.finalize", "release.build", "release.materialize",
  "promotion.propose", "promotion.finalize", "deployment.trigger", "deployment.verify", "deployment.record",
]);

function routingForResult(stepId, result) {
  if (stepId === "03a-prepare-classification-handoff" || stepId === "07a-prepare-keyword-handoff") {
    if (result.stateResult === "reused") return "reuse";
    if (result.stateResult === "succeeded") return "ready_without_handoff";
    if (result.stateResult === "created") return "handoff_required";
  }
  if (result.stateResult === "review_required") return "review_required";
  if (result.stateResult === "rejected") return "rejected";
  if (result.stateResult === "conflict") return "superseded";
  if (result.stateResult === "triggered") return "wait";
  if (result.stateResult === "already_deployed") return "verify";
  if (result.stateResult === "deployment_failed" || result.stateResult === "not_verified") return "deployment_failed";
  return "continue";
}

export function createV3ApplicationServiceTaskHandlers({ controlPlane, deploymentAdapter, artifactStore, releaseArtifactStore = artifactStore, artifactBuilder, classificationWorksetBuilder } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const evidence = new EvidenceApplicationServiceV3(controlPlane);
  const corpus = new CorpusApplicationServiceV3(controlPlane);
  const classificationHandoff = new ClassificationHandoffService(controlPlane, artifactStore, { worksetBuilder: classificationWorksetBuilder });
  const classification = new ClassificationApplicationServiceV3(controlPlane);
  const keywordHandoff = new KeywordHandoffService(controlPlane, artifactStore);
  const keyword = new KeywordSelectionApplicationServiceV3(controlPlane);
  const release = new ReleaseApplicationServiceV3(controlPlane, { artifactStore: releaseArtifactStore, artifactBuilder });
  const promotion = new PromotionApplicationServiceV3(controlPlane);
  const deployment = deploymentAdapter ? new DeploymentQueueServiceV3(controlPlane, { adapter: deploymentAdapter }) : null;
  const handlers = {
    "evidence.ingest": (ctx, input) => evidence.ingest(ctx, input),
    "corpus.update": (ctx, input) => corpus.update(ctx, input),
    "classification.handoff.prepare": (ctx, input) => classificationHandoff.prepare(ctx, input),
    "classification.assess": (ctx, input) => classification.assess(ctx, input),
    "classification.finalize": (ctx, input) => classification.finalize(ctx, input),
    "keyword-selection.handoff.prepare": (ctx, input) => keywordHandoff.prepare(ctx, input),
    "keyword-selection.assess": (ctx, input) => keyword.assess(ctx, input),
    "keyword-selection.finalize": (ctx, input) => keyword.finalize(ctx, input),
    "release.build": (ctx, input) => release.build(ctx, input),
    "release.materialize": (ctx, input) => release.materialize(ctx, input),
    "promotion.propose": (ctx, input) => promotion.propose(ctx, input),
    "promotion.finalize": (ctx, input) => promotion.finalize(ctx, input),
  };
  if (deployment) {
    handlers["deployment.trigger"] = (ctx, input) => deployment.trigger(ctx, input);
    handlers["deployment.verify"] = (ctx, input) => deployment.verify(ctx, input);
    handlers["deployment.record"] = (ctx, input) => deployment.record(ctx, input);
  }
  return { handlers, services: { evidence, corpus, classificationHandoff, classification, keywordHandoff, keyword, release, promotion, deployment } };
}

export class ApplicationServiceAgentAdapterV3 {
  constructor(options = {}) {
    this.taskHandlers = createV3ApplicationServiceTaskHandlers(options);
    this.artifactStore = options.artifactStore;
  }

  async run(request) {
    const capability = request?.task?.contract?.requiredCapabilities?.[0];
    if (request?.task?.contract?.requiredCapabilities?.length !== 1 || !V3_SERVICE_CAPABILITIES.includes(capability)) return { status: "failed", failure: "AGENT_CAPABILITY_CONTRACT_INVALID" };
    const context = createV3OperationContext({ sessionId: request.session.sessionId, workDefinitionId: request.session.workDefinitionId, workDefinitionRevision: request.session.definitionRevision, stepId: request.task.stepId, actor: { actorId: "application-service", actorType: "service" }, permissions: request.grant?.permissions ?? [] });
    try {
      const handler = this.taskHandlers.handlers[capability];
      if (typeof handler !== "function") throw stateError("CAPABILITY_NOT_BOUND", `no v3 handler for ${capability}`);
      const result = await handler(context, enrichHumanInputs(capability, request.task.inputs ?? {}, this.artifactStore));
      const checked = validateV3WorkStepResult({ stepId: request.task.stepId, routingOutcome: routingForResult(request.task.stepId, result), result });
      const artifacts = producedArtifactForResult(checked, this.artifactStore);
      return { status: "succeeded", outcome: routingForResult(request.task.stepId, checked), result: checked, ...attachProducedArtifacts(checked, artifacts, request.workspace) };
    } catch (error) {
      const code = error instanceof StateControlPlaneError ? error.code : undefined;
      return { status: "failed", failure: { code: code ?? "APPLICATION_SERVICE_ERROR", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async cancel() { return { confirmed: false }; }
}

export function createV3ApplicationServiceAgentAdapter(options = {}) { return new ApplicationServiceAgentAdapterV3(options); }
