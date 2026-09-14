import { buildAccountCandidates } from "../processing/account-block-candidates/account-block-candidate-workflow.js";
import { canonicalJson, semanticSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

export function deriveAccountCandidates({ corpusVersion, classificationVersion, accountPolicy }) {
  if (!corpusVersion || !classificationVersion || !accountPolicy) throw stateError("EXPLICIT_VERSION_REQUIRED", "corpus, classification, and account policy versions are required");
  const corpus = corpusVersion.payload?.state ?? corpusVersion.payload;
  const classification = classificationVersion.payload?.state ?? classificationVersion.payload;
  const labels = classification.labels ?? [];
  const labelMap = Array.isArray(labels)
    ? new Map(labels.map((item) => [String(item.observationId ?? item.observation_id), item.label]))
    : new Map(Object.entries(labels));
  const records = corpus.records ?? corpus.observations ?? [];
  const dataset = records.map((record, index) => ({
    username: String(record.username ?? ""),
    handle: String(record.handle ?? ""),
    comment: String(record.comment ?? record.commentText ?? ""),
    postedAt: String(record.postedAt ?? record.collectedAt ?? ""),
    postedDate: String(record.postedDate ?? String(record.postedAt ?? record.collectedAt ?? "").slice(0, 10)),
    label: labelMap.get(String(record.observationId ?? record.observation_id ?? index)) ?? record.label,
  }));
  const result = buildAccountCandidates(dataset, accountPolicy);
  return {
    ...result,
    derived: true,
    authoritativeInputs: {
      corpusVersionId: corpusVersion.versionId,
      classificationVersionId: classificationVersion.versionId,
      accountPolicyVersionId: accountPolicy.versionId ?? accountPolicy.policy_version ?? null,
    },
    fingerprint: semanticSha256({ inputs: { corpusVersionId: corpusVersion.versionId, classificationVersionId: classificationVersion.versionId, accountPolicyVersionId: accountPolicy.versionId ?? accountPolicy.policy_version ?? null }, candidates: result.candidates }),
  };
}

export function deriveAccountCandidatesFromControlPlane(controlPlane, { corpusVersionId, classificationVersionId, accountPolicyVersionId }) {
  if (!corpusVersionId || !classificationVersionId || !accountPolicyVersionId) throw stateError("EXPLICIT_VERSION_REQUIRED", "Account Candidate derivation requires explicit version IDs");
  const corpus = controlPlane.readVersion(corpusVersionId);
  const classification = controlPlane.readVersion(classificationVersionId);
  const policyVersion = controlPlane.readVersion(accountPolicyVersionId);
  if (!corpus || !classification || !policyVersion) throw stateError("VERSION_NOT_FOUND", "an Account Candidate input version does not exist");
  return deriveAccountCandidates({ corpusVersion: corpus, classificationVersion: classification, accountPolicy: { ...policyVersion.payload, versionId: policyVersion.versionId } });
}

export { canonicalJson };
