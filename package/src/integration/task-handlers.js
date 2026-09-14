import {
  CorpusApplicationService,
  ClassificationApplicationService,
  KeywordSelectionApplicationService,
  EvidenceApplicationService,
  createDefaultOperationContext,
} from "../application/services.js";
import { ReleaseApplicationService } from "../application/release-services.js";
import { PromotionApplicationService } from "../application/release-services.js";
import { DeploymentApplicationService } from "../application/deployment-services.js";
import { stateError } from "../state/errors.js";

export const SERVICE_CAPABILITIES = Object.freeze([
  "evidence.ingest", "corpus.update", "classification.assess", "classification.finalize",
  "keyword-selection.assess", "keyword-selection.finalize", "release.build", "release.materialize",
  "promotion.finalize", "deployment.trigger", "deployment.verify", "deployment.record",
]);

export function operationIdForTask({ sessionId, stepId, businessAttempt = 1 }) {
  if (![sessionId, stepId].every((value) => typeof value === "string" && value.length > 0) || !Number.isSafeInteger(businessAttempt) || businessAttempt < 1) throw stateError("VALIDATION_ERROR", "sessionId, stepId, and businessAttempt are required");
  return `${sessionId}/${stepId}/${businessAttempt}`;
}

export function operationContextForTask({ sessionId, workDefinitionId, workDefinitionRevision, stepId, businessAttempt = 1, actor = undefined, permissions = undefined }) {
  return createDefaultOperationContext({
    operationId: operationIdForTask({ sessionId, stepId, businessAttempt }), workflowSessionId: sessionId,
    workDefinitionId, workDefinitionRevision, stepId, ...(actor === undefined ? {} : { actor }), ...(permissions === undefined ? {} : { permissions }),
  });
}

export function createApplicationServiceTaskHandlers({ controlPlane, deploymentAdapter, artifactStore, artifactBuilder } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const evidence = new EvidenceApplicationService(controlPlane);
  const corpus = new CorpusApplicationService(controlPlane);
  const classification = new ClassificationApplicationService(controlPlane);
  const keywordSelection = new KeywordSelectionApplicationService(controlPlane);
  const release = new ReleaseApplicationService(controlPlane, { artifactStore, artifactBuilder });
  const promotion = new PromotionApplicationService(controlPlane);
  const deployment = deploymentAdapter ? new DeploymentApplicationService(controlPlane, { adapter: deploymentAdapter }) : null;
  const handlers = {
    "evidence.ingest": (ctx, input) => evidence.ingest(ctx, input),
    "corpus.update": (ctx, input) => corpus.update(ctx, input),
    "classification.assess": (ctx, input) => classification.assess(ctx, input),
    "classification.finalize": (ctx, input) => classification.finalize(ctx, input),
    "keyword-selection.assess": (ctx, input) => keywordSelection.assess(ctx, input),
    "keyword-selection.finalize": (ctx, input) => keywordSelection.finalize(ctx, input),
    "release.build": (ctx, input) => release.build(ctx, input),
    "release.materialize": (ctx, input) => release.materialize(ctx, input),
    "promotion.finalize": (ctx, input) => promotion.finalize(ctx, input),
  };
  if (deployment) {
    handlers["deployment.trigger"] = (ctx, input) => deployment.trigger(ctx, input);
    handlers["deployment.verify"] = (ctx, input) => deployment.verify(ctx, input);
    handlers["deployment.record"] = (ctx, input) => deployment.record(ctx, input);
  }
  return {
    handlers,
    async run(capability, taskContext, input) {
      if (!SERVICE_CAPABILITIES.includes(capability) || typeof handlers[capability] !== "function") throw stateError("CAPABILITY_NOT_BOUND", `no application service handler for ${capability}`);
      const context = operationContextForTask({ ...taskContext, stepId: taskContext.stepId, businessAttempt: taskContext.businessAttempt ?? 1 });
      return handlers[capability](context, input);
    },
  };
}
