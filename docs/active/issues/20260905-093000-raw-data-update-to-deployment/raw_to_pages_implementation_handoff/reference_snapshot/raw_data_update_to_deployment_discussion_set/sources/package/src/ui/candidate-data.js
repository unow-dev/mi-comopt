import keywordCandidatesArtifact from "../data/filterKeywordCandidates.json";
import accountCandidatesArtifact from "../data/accountBlockCandidates.json";
import workflowConfigArtifact from "../data/candidateWorkflowConfig.json";
import {
  adaptAccountCandidates,
  adaptKeywordCandidates,
  toWorkflowConfigModel,
} from "./candidate-data-adapter.js";

export const keywordCandidates = adaptKeywordCandidates(keywordCandidatesArtifact);
export const accountCandidates = adaptAccountCandidates(accountCandidatesArtifact);
export const workflowConfig = toWorkflowConfigModel(workflowConfigArtifact);
