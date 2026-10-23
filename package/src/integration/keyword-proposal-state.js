import { spawnSync } from "node:child_process";
import { prefixedSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

// The production handoff packager already requires Python. Read its ZIP in
// memory so retire actions use the exact candidate view handed to the producer.
const READ_HANDOFF_CONTEXT = `
import base64, io, json, sys, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise ValueError("duplicate handoff ZIP member")
    required = ["candidate_generation_request.json", "candidate_view.json", "handoff_manifest.json"]
    print(json.dumps({name: base64.b64encode(archive.read(name)).decode("ascii") for name in required}))
`;

function retirementCandidates({ proposal, handoffPreparation, artifactStore }) {
  const hash = handoffPreparation?.details?.artifact?.blobHash;
  if (!hash || typeof artifactStore?.read !== "function") throw stateError("HANDOFF_ARTIFACT_UNAVAILABLE", "retire actions require the prepared keyword handoff");
  const bytes = artifactStore.read(hash.replace(/^sha256:/, ""));
  const extracted = spawnSync("python3", ["-c", READ_HANDOFF_CONTEXT], { input: bytes, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (extracted.error || extracted.status !== 0) throw stateError("HANDOFF_ARTIFACT_INVALID", "keyword handoff context could not be read");
  let files, manifest, request, view;
  try {
    files = Object.fromEntries(Object.entries(JSON.parse(extracted.stdout)).map(([name, value]) => [name, Buffer.from(value, "base64")]));
    manifest = JSON.parse(files["handoff_manifest.json"].toString("utf8"));
    request = JSON.parse(files["candidate_generation_request.json"].toString("utf8"));
    view = JSON.parse(files["candidate_view.json"].toString("utf8"));
  } catch (error) {
    throw stateError("HANDOFF_ARTIFACT_INVALID", "keyword handoff context is invalid JSON", { cause: error });
  }
  const refs = handoffPreparation?.refs;
  if (manifest.schema_version !== 1 || view.schema_version !== 1 || !Array.isArray(view.candidates)
    || request.request_id !== refs?.candidateRequestId || request.input_fingerprint !== refs?.candidateInputFingerprint
    || proposal.request_id !== request.request_id || proposal.input_fingerprint !== request.input_fingerprint
    || manifest.request_id !== request.request_id || manifest.input_fingerprint !== request.input_fingerprint) {
    throw stateError("HANDOFF_IDENTITY_MISMATCH", "retire actions do not match the prepared keyword handoff");
  }
  for (const name of ["candidate_generation_request.json", "candidate_view.json"]) {
    if (manifest.files?.[name] !== prefixedSha256(files[name])) throw stateError("HANDOFF_IDENTITY_MISMATCH", `keyword handoff bytes differ: ${name}`);
  }
  const candidates = new Map();
  for (const candidate of view.candidates) {
    if (!candidate || typeof candidate.candidate_id !== "string" || candidates.has(candidate.candidate_id)) throw stateError("HANDOFF_ARTIFACT_INVALID", "keyword handoff candidate identities are invalid");
    candidates.set(candidate.candidate_id, candidate);
  }
  return candidates;
}

export function buildKeywordProposalState({ proposal, handoffPreparation, artifactStore }) {
  if (!Array.isArray(proposal?.actions)) throw stateError("ARTIFACT_INVALID", "keyword proposal actions must be an array");
  const candidates = proposal.actions.some((action) => action?.action === "retire")
    ? retirementCandidates({ proposal, handoffPreparation, artifactStore })
    : null;
  return {
    schema_version: 1,
    entries: proposal.actions.map((action) => {
      if (!action || typeof action !== "object" || !["add", "update", "retire", "reactivate"].includes(action.action)) throw stateError("ARTIFACT_INVALID", "keyword proposal action is invalid");
      if (action.action !== "retire") return { ...action, selection_state: action.selection_state ?? "selected" };
      const candidate = candidates.get(action.candidate_id);
      if (!candidate || candidate.status !== "active" || typeof candidate.keyword !== "string" || candidate.keyword.length === 0) throw stateError("HANDOFF_IDENTITY_MISMATCH", "retire target must be an active candidate in the prepared handoff");
      return { ...action, keyword: candidate.keyword, selection_state: "retired" };
    }),
  };
}
