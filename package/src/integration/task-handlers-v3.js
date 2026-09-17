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

export const V3_SERVICE_CAPABILITIES = Object.freeze([
  "evidence.ingest", "corpus.update", "classification.handoff.prepare", "classification.assess", "classification.finalize",
  "keyword-selection.handoff.prepare", "keyword-selection.assess", "keyword-selection.finalize", "release.build", "release.materialize",
  "promotion.propose", "promotion.finalize", "deployment.trigger", "deployment.verify", "deployment.record",
]);

function routingForResult(result) {
  if (result.stateResult === "review_required") return "review_required";
  if (result.stateResult === "rejected") return "rejected";
  if (result.stateResult === "conflict") return "superseded";
  if (result.stateResult === "triggered") return "wait";
  if (result.stateResult === "already_deployed") return "verify";
  if (result.stateResult === "deployment_failed" || result.stateResult === "not_verified") return "deployment_failed";
  return "continue";
}

export function createV3ApplicationServiceTaskHandlers({ controlPlane, deploymentAdapter, artifactStore, artifactBuilder } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const evidence = new EvidenceApplicationServiceV3(controlPlane);
  const corpus = new CorpusApplicationServiceV3(controlPlane);
  const classificationHandoff = new ClassificationHandoffService(controlPlane, artifactStore);
  const classification = new ClassificationApplicationServiceV3(controlPlane);
  const keywordHandoff = new KeywordHandoffService(controlPlane, artifactStore);
  const keyword = new KeywordSelectionApplicationServiceV3(controlPlane);
  const release = new ReleaseApplicationServiceV3(controlPlane, { artifactStore, artifactBuilder });
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
  constructor(options = {}) { this.taskHandlers = createV3ApplicationServiceTaskHandlers(options); }

  async run(request) {
    const capability = request?.task?.contract?.requiredCapabilities?.[0];
    if (request?.task?.contract?.requiredCapabilities?.length !== 1 || !V3_SERVICE_CAPABILITIES.includes(capability)) return { status: "failed", failure: "AGENT_CAPABILITY_CONTRACT_INVALID" };
    const context = createV3OperationContext({ sessionId: request.session.sessionId, workDefinitionId: request.session.workDefinitionId, workDefinitionRevision: request.session.definitionRevision, stepId: request.task.stepId, actor: { actorId: "application-service", actorType: "service" }, permissions: request.grant?.permissions ?? [] });
    try {
      const handler = this.taskHandlers.handlers[capability];
      if (typeof handler !== "function") throw stateError("CAPABILITY_NOT_BOUND", `no v3 handler for ${capability}`);
      const result = await handler(context, request.task.inputs ?? {});
      const checked = validateV3WorkStepResult({ stepId: request.task.stepId, routingOutcome: routingForResult(result), result });
      return { status: "succeeded", outcome: routingForResult(checked), result: checked };
    } catch (error) {
      const code = error instanceof StateControlPlaneError ? error.code : undefined;
      return { status: "failed", failure: { code: code ?? "APPLICATION_SERVICE_ERROR", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async cancel() { return { confirmed: false }; }
}

export function createV3ApplicationServiceAgentAdapter(options = {}) { return new ApplicationServiceAgentAdapterV3(options); }

