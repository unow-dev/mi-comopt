import { stateError } from "../state/errors.js";

export const V3_CUTOVER_STATES = Object.freeze(["v2_open", "v2_frozen", "v2_drained", "legacy_disabled", "v3_enabled", "smoke_verified", "v3_frozen"]);

export function assertV3CutoverPreconditions({ mandatoryVerificationPassed, providerCompatible, v2HashesUnchanged, targetRevision } = {}) {
  if (mandatoryVerificationPassed !== true || providerCompatible !== true || v2HashesUnchanged !== true || !Number.isSafeInteger(targetRevision) || targetRevision < 3) throw stateError("CUTOVER_PRECONDITION_FAILED", "mandatory v3 verification, provider compatibility, frozen v2 hashes, and target revision are required");
  return true;
}

export function advanceV3Cutover(state, event, evidence = {}) {
  const current = state ?? "v2_open";
  if (!V3_CUTOVER_STATES.includes(current)) throw stateError("CUTOVER_STATE_INVALID", `unknown cutover state ${current}`);
  const transitions = {
    v2_open: { freeze_v2: "v2_frozen" },
    v2_frozen: { drain_complete: "v2_drained" },
    v2_drained: { legacy_disabled: "legacy_disabled" },
    legacy_disabled: { enable_v3: "v3_enabled" },
    v3_enabled: { smoke_passed: "smoke_verified", smoke_failed: "v3_frozen" },
    smoke_verified: {},
    v3_frozen: {},
  };
  const next = transitions[current][event];
  if (!next) throw stateError("CUTOVER_ORDER_INVALID", `${event} cannot advance cutover from ${current}`);
  if (event === "freeze_v2" && evidence.newV2Starts !== 0) throw stateError("CUTOVER_GATE_FAILED", "v2 starts must be frozen before drain");
  if (event === "drain_complete" && evidence.nonterminalV2Sessions !== 0) throw stateError("CUTOVER_GATE_FAILED", "nonterminal v2 sessions must be zero");
  if (event === "enable_v3" && evidence.legacyWriterEnabled === true) throw stateError("CUTOVER_DUAL_AUTHORITY", "legacy authority must be disabled before v3 enablement");
  if (event === "smoke_failed") return { state: next, newV3StartsFrozen: true, legacyWriterEnabled: false, fixForwardOnly: true };
  return { state: next, newV3StartsFrozen: next === "v2_frozen" || next === "v3_frozen", legacyWriterEnabled: next !== "legacy_disabled" && next !== "v3_enabled" && next !== "smoke_verified", fixForwardOnly: true };
}
