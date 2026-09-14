import { StateQueryService } from "./query.js";

/**
 * Public application boundary wrappers. Repositories and raw SQL remain behind
 * StateControlPlane; callers use these services for the three state-control
 * operations instead of mutating tables directly.
 */
export class ProposalService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }
  create(request) { return this.controlPlane.createProposal(request); }
  read(proposalId) { return this.controlPlane.readProposal(proposalId); }
}

export class DecisionService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }
  create(request) { return this.controlPlane.createDecision(request); }
  read(proposalId) { return this.controlPlane.readDecision(proposalId); }
}

export class CommitService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }
  commit(request) { return this.controlPlane.commitProposal(request); }
}

export function createStateControlServices(controlPlane) {
  return {
    query: new StateQueryService(controlPlane),
    proposal: new ProposalService(controlPlane),
    decision: new DecisionService(controlPlane),
    commit: new CommitService(controlPlane),
  };
}
