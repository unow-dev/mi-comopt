import { cloneJson } from "../state/canonical.js";
import { stateError } from "../state/errors.js";
import { assertDefinitionSnapshot, buildWorkDefinitions } from "./definitions.js";

function publicValidationError(definition, error) {
  const publicCode = typeof error?.code === "string" ? error.code : error?.name;
  const publicMessage = error instanceof Error ? error.message : String(error);
  const summary = publicMessage.split("; ").slice(0, 3).join("; ");
  return stateError(
    "WORK_ORCHESTRATOR_INCOMPATIBLE",
    `work-orchestrator rejected ${definition.workDefinitionId}@${definition.revision}: ${summary}`,
    { details: { workDefinitionId: definition.workDefinitionId, revision: definition.revision, publicCode, publicMessage } },
  );
}

export function createWorkOrchestratorCompatibility({ publicApi } = {}) {
  if (!publicApi || typeof publicApi.validateAndHashDefinition !== "function") throw stateError("WORK_ORCHESTRATOR_UNAVAILABLE", "public work-orchestrator validateAndHashDefinition is required");
  return {
    validate(definition) {
      const local = assertDefinitionSnapshot(definition);
      let external;
      try {
        external = publicApi.validateAndHashDefinition(cloneJson(local));
      } catch (error) {
        throw publicValidationError(local, error);
      }
      if (!external || external.definitionHash !== local.definitionHash) throw stateError("DEFINITION_HASH_MISMATCH", `public Work Orchestrator changed the canonical definition hash for ${local.workDefinitionId}`);
      return external;
    },
    register(orchestrator, definition) {
      if (!orchestrator || typeof orchestrator.registerDefinition !== "function") throw stateError("WORK_ORCHESTRATOR_UNAVAILABLE", "public WorkOrchestrator.registerDefinition is required");
      return orchestrator.registerDefinition(this.validate(definition));
    },
  };
}

export function validateAndRegisterWorkDefinitions({ orchestrator, publicApi, revision = undefined } = {}) {
  const compatibility = createWorkOrchestratorCompatibility({ publicApi });
  return buildWorkDefinitions({ ...(revision === undefined ? {} : { revision }) }).map((definition) => compatibility.register(orchestrator, definition));
}

export function failClosedIfDefinitionCannotRepresent({ publicApi, definition }) {
  return createWorkOrchestratorCompatibility({ publicApi }).validate(definition);
}

export async function registerProductionWorkDefinitions({ publicApi = undefined, orchestrator = undefined, revision = undefined } = {}) {
  let api = publicApi;
  if (!api) {
    try { api = await import("work-orchestrator"); } catch (error) { throw stateError("WORK_ORCHESTRATOR_UNAVAILABLE", `work-orchestrator public root could not be loaded: ${error.message}`, { cause: error }); }
  }
  const runtime = orchestrator ?? (typeof api.WorkOrchestrator === "function" ? new api.WorkOrchestrator() : null);
  if (!runtime) throw stateError("WORK_ORCHESTRATOR_UNAVAILABLE", "a WorkOrchestrator instance or public constructor is required");
  return validateAndRegisterWorkDefinitions({ orchestrator: runtime, publicApi: api, revision });
}
