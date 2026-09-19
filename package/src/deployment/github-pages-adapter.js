import { prefixedSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

const API_ROOT = "https://api.github.com";
const DEFAULT_REPOSITORY = "unow-dev/mi-comopt";
const DEFAULT_WORKFLOW = ".github/workflows/deploy-pages.yml";
const DEFAULT_REF = "main";
const DEFAULT_PAGES_URL = "https://unow-dev.github.io/mi-comopt/";
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw stateError("CONFIGURATION_ERROR", `${name} must be a non-empty string`);
  return value;
}
function normalizeSha256(value, name) {
  const normalized = typeof value === "string" ? value.replace(/^sha256:/, "") : value;
  if (!HEX_SHA256.test(normalized)) throw stateError("CONFIGURATION_ERROR", `${name} must be a 64-character lowercase SHA-256 hex value`);
  return normalized;
}

function runName(deploymentRequestId) {
  return `Deploy React UI to GitHub Pages / ${deploymentRequestId}`;
}

function externalRunRef(repository, workflow, deploymentRequestId) {
  return `github-actions:${repository}:${workflow}:${deploymentRequestId}`;
}

function eventId(run) {
  return `github-pages-deployment-${run.id}`;
}

function completedStatus(run) {
  if (run.status !== "completed") return null;
  if (run.conclusion === "success") return "succeeded";
  if (run.conclusion === "cancelled") return "cancelled";
  return "failed";
}

function matchesRun(run, expectedRunName) {
  return run?.display_title === expectedRunName || run?.run_name === expectedRunName;
}

async function defaultSleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * GitHub Pages is deployed by Actions, not by the local process. This adapter
 * treats workflow_dispatch as the provider-side ensure operation and the
 * public deployment marker as the provider-side verification artifact.
 */
export class GitHubPagesDeploymentAdapter {
  constructor({
    repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
    workflow = process.env.COMMENT_DATA_UPDATE_PAGES_WORKFLOW ?? DEFAULT_WORKFLOW,
    ref = process.env.COMMENT_DATA_UPDATE_PAGES_REF ?? DEFAULT_REF,
    pagesUrl = process.env.COMMENT_DATA_UPDATE_PAGES_URL ?? DEFAULT_PAGES_URL,
    token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    fetchImpl = globalThis.fetch,
    releaseBundleSha256 = undefined,
    verifyRetries = 10,
    verifyDelayMs = 3000,
    sleep = defaultSleep,
  } = {}) {
    this.repository = requiredString(repository, "repository");
    this.workflow = requiredString(workflow, "workflow");
    this.ref = requiredString(ref, "ref");
    this.pagesUrl = new URL(requiredString(pagesUrl, "pagesUrl")).href;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.releaseBundleSha256 = releaseBundleSha256;
    this.verifyRetries = Number.isSafeInteger(verifyRetries) && verifyRetries > 0 ? verifyRetries : 10;
    this.verifyDelayMs = Number.isSafeInteger(verifyDelayMs) && verifyDelayMs >= 0 ? verifyDelayMs : 3000;
    this.sleep = sleep;
  }

  requireToken() {
    if (typeof this.token !== "string" || this.token.length === 0) {
      throw stateError("CONFIGURATION_ERROR", "GITHUB_TOKEN or GH_TOKEN is required for the GitHub Pages deployment adapter");
    }
    if (typeof this.fetchImpl !== "function") throw stateError("CONFIGURATION_ERROR", "fetch is required for the GitHub Pages deployment adapter");
  }

  workflowApiPath(suffix = "") {
    return `/repos/${this.repository}/actions/workflows/${encodeURIComponent(this.workflow)}${suffix}`;
  }

  async api(pathname, { method = "GET", body = undefined } = {}) {
    this.requireToken();
    const response = await this.fetchImpl(`${API_ROOT}${pathname}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return null;
    const text = typeof response.text === "function" ? await response.text() : "";
    let value = null;
    if (text) {
      try { value = JSON.parse(text); } catch { value = { message: text }; }
    }
    if (!response.ok) {
      const error = new Error(`GitHub API ${method} ${pathname} failed with HTTP ${response.status}: ${value?.message ?? "unknown error"}`);
      error.code = "GITHUB_API_ERROR";
      throw error;
    }
    return value;
  }

  async listRuns() {
    const value = await this.api(`${this.workflowApiPath("/runs")}?event=workflow_dispatch&branch=${encodeURIComponent(this.ref)}&per_page=100`);
    return Array.isArray(value?.workflow_runs) ? value.workflow_runs : [];
  }

  findRun(runs, deploymentRequestId) {
    const expected = runName(deploymentRequestId);
    return runs
      .filter((run) => matchesRun(run, expected))
      .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")))[0] ?? null;
  }

  async resolveBundleSha256(releaseId) {
    if (typeof this.releaseBundleSha256 !== "function") {
      throw stateError("CONFIGURATION_ERROR", "releaseBundleSha256 resolver is required for GitHub Pages deployment identity");
    }
    return normalizeSha256(await this.releaseBundleSha256(releaseId), `release ${releaseId} bundle SHA-256`);
  }

  async ensureDeployment({ deploymentRequestId, releaseId, target }) {
    requiredString(deploymentRequestId, "deploymentRequestId");
    requiredString(releaseId, "releaseId");
    if (target !== "production") throw stateError("VALIDATION_ERROR", "GitHub Pages adapter only supports production");
    const bundleSha256 = await this.resolveBundleSha256(releaseId);
    const runs = await this.listRuns();
    const existing = this.findRun(runs, deploymentRequestId);
    if (existing) {
      const status = completedStatus(existing);
      return {
        deploymentRequestId,
        releaseId,
        target,
        externalRunRef: `github-actions-run:${existing.id}`,
        status: status ?? "requested",
        alreadyDeployed: status === "succeeded",
      };
    }
    await this.api(this.workflowApiPath("/dispatches"), {
      method: "POST",
      body: {
        ref: this.ref,
        inputs: {
          deployment_request_id: deploymentRequestId,
          release_id: releaseId,
          release_bundle_sha256: bundleSha256,
        },
      },
    });
    return {
      deploymentRequestId,
      releaseId,
      target,
      externalRunRef: externalRunRef(this.repository, this.workflow, deploymentRequestId),
      status: "requested",
      alreadyDeployed: false,
    };
  }

  async pollCompletedDeployments(requests = []) {
    if (!Array.isArray(requests) || requests.length === 0) return [];
    const runs = await this.listRuns();
    return requests.flatMap((request) => {
      const run = this.findRun(runs, request.deployment_request_id ?? request.deploymentRequestId);
      const status = completedStatus(run);
      if (!run || !status) return [];
      const deploymentRequestId = request.deployment_request_id ?? request.deploymentRequestId;
      const releaseId = request.release_id ?? request.releaseId;
      return [{
        eventId: eventId(run),
        eventType: "deployment.completed",
        correlationKey: deploymentRequestId,
        payload: {
          deploymentRequestId,
          target: "production",
          releaseId,
          status,
          externalRunRef: `github-actions-run:${run.id}`,
        },
      }];
    });
  }

  async verifyDeployment({ deploymentRequestId, releaseId, target, externalRunRef: runRef = undefined }) {
    if (target !== "production") throw stateError("VALIDATION_ERROR", "GitHub Pages adapter only supports production");
    const expectedBundleSha256 = await this.resolveBundleSha256(releaseId);
    const markerUrl = new URL("comment-db-v3-deployment.json", this.pagesUrl).href;
    let lastFailure = "marker was not available";
    for (let attempt = 1; attempt <= this.verifyRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(markerUrl, { cache: "no-store", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const marker = JSON.parse(bytes.toString("utf8"));
        if (marker.schema_version !== 1 || marker.target !== "production") throw new Error("marker schema/target mismatch");
        if (marker.deployment_request_id !== deploymentRequestId) throw new Error("deployment request identity mismatch");
        if (marker.release_id !== releaseId) throw new Error("release identity mismatch");
        if (marker.release_bundle_sha256 !== expectedBundleSha256) throw new Error("release bundle SHA-256 mismatch");
        return {
          verified: true,
          servedReleaseId: marker.release_id,
          verificationRef: `github-pages-marker:${prefixedSha256(bytes)}`,
          externalRunRef: runRef ?? null,
          attempts: attempt,
        };
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        if (attempt < this.verifyRetries) await this.sleep(this.verifyDelayMs);
      }
    }
    return {
      verified: false,
      servedReleaseId: null,
      verificationRef: `github-pages-marker:${deploymentRequestId}:${lastFailure}`,
      externalRunRef: runRef ?? null,
    };
  }
}
