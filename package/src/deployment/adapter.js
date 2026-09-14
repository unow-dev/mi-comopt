import { deterministicId, prefixedSha256 } from "../state/canonical.js";

export class MemoryDeploymentAdapter {
  constructor({ onEnsure = undefined, onVerify = undefined } = {}) {
    this.requests = new Map();
    this.onEnsure = onEnsure;
    this.onVerify = onVerify;
  }

  async ensureDeployment({ deploymentRequestId, releaseId, target }) {
    const existing = this.requests.get(deploymentRequestId);
    if (existing) {
      if (existing.releaseId !== releaseId || existing.target !== target) {
        const error = new Error("deployment request ID is bound to another intent");
        error.code = "DEPLOYMENT_IDEMPOTENCY_CONFLICT";
        throw error;
      }
      return { ...existing, alreadyDeployed: existing.status === "succeeded" };
    }
    const externalRunRef = deterministicId("external-run", deploymentRequestId);
    const record = { deploymentRequestId, releaseId, target, externalRunRef, status: "requested" };
    this.requests.set(deploymentRequestId, record);
    if (this.onEnsure) {
      const result = await this.onEnsure({ ...record });
      if (result?.status) record.status = result.status;
      if (result?.externalRunRef) record.externalRunRef = result.externalRunRef;
    }
    return { ...record, alreadyDeployed: record.status === "succeeded" };
  }

  complete(deploymentRequestId, status = "succeeded") {
    const record = this.requests.get(deploymentRequestId);
    if (!record) throw new Error(`unknown deployment request: ${deploymentRequestId}`);
    record.status = status;
    return { ...record };
  }

  async verifyDeployment({ releaseId, target, externalRunRef = undefined }) {
    if (this.onVerify) return this.onVerify({ releaseId, target, externalRunRef });
    const record = [...this.requests.values()].find((item) => item.releaseId === releaseId && item.target === target);
    const verified = Boolean(record && record.status === "succeeded");
    return {
      verified,
      servedReleaseId: verified ? releaseId : null,
      verificationRef: verified ? `memory-verification:${prefixedSha256(`${releaseId}:${target}`)}` : null,
      externalRunRef: record?.externalRunRef ?? externalRunRef ?? null,
    };
  }
}

export function assertDeploymentAdapter(adapter) {
  if (!adapter || typeof adapter.ensureDeployment !== "function" || typeof adapter.verifyDeployment !== "function") throw new TypeError("DeploymentAdapter must implement ensureDeployment and verifyDeployment");
  return adapter;
}
