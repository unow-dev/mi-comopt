import { StateControlPlaneError, stateError } from "./errors.js";

export class StateQueryService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  resolveHead(stream) { return this.controlPlane.resolveHead(stream); }

  readVersion(versionId) {
    const version = this.controlPlane.readVersion(versionId);
    if (!version) throw stateError("VERSION_NOT_FOUND", `version ${versionId} does not exist`);
    return version;
  }

  readDependencies(versionId) {
    this.readVersion(versionId);
    return this.controlPlane.readDependencies(versionId);
  }

  readProposal(proposalId) {
    const proposal = this.controlPlane.readProposal(proposalId);
    if (!proposal) throw stateError("PROPOSAL_NOT_FOUND", `proposal ${proposalId} does not exist`);
    return proposal;
  }

  readRelease(releaseId) {
    const row = this.controlPlane.db.prepare("SELECT * FROM release_bundles WHERE release_id = ?").get(releaseId);
    if (!row) throw stateError("RELEASE_NOT_FOUND", `release ${releaseId} does not exist`);
    return {
      releaseId: row.release_id,
      bundleSha256: row.bundle_sha256,
      projectionDefinitionVersionId: row.projection_definition_version_id,
      bundle: JSON.parse(row.bundle_json),
      materializedAt: row.materialized_at,
      createdAt: row.created_at,
      members: this.controlPlane.db.prepare("SELECT role, version_id AS versionId FROM release_bundle_members WHERE release_id = ? ORDER BY role").all(releaseId).map((member) => ({ ...member })),
      artifacts: this.controlPlane.db.prepare("SELECT artifact_key AS artifactKey, artifact_path AS path, artifact_sha256 AS artifactSha256, byte_length AS byteLength FROM release_artifacts WHERE release_id = ? ORDER BY artifact_key").all(releaseId).map((artifact) => ({ ...artifact, byteLength: Number(artifact.byteLength) })),
    };
  }

  readStreamHistory(stream) {
    const streamId = typeof stream === "string" ? stream : this.controlPlane.streamId(stream.domain, stream.streamKey);
    if (!streamId) return [];
    return this.controlPlane.db.prepare("SELECT * FROM state_versions WHERE stream_id = ? ORDER BY version_no").all(streamId).map((row) => this.controlPlane._versionRow(row));
  }
}

export function createStateQueryService(controlPlane) {
  return new StateQueryService(controlPlane);
}
