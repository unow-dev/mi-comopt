import keywordCandidatesArtifact from "../data/filterKeywordCandidates.json";
import accountCandidatesArtifact from "../data/accountBlockCandidates.json";
import workflowConfigArtifact from "../data/candidateWorkflowConfig.json";
import threeClassLabelSummaryArtifact from "../data/threeClassLabelSummary.json";
import {
  adaptAccountCandidates,
  adaptKeywordCandidates,
  toThreeClassLabelSummaryModel,
  toWorkflowConfigModel,
} from "./candidate-data-adapter.js";

export const keywordCandidates = adaptKeywordCandidates(keywordCandidatesArtifact);
export const accountCandidates = adaptAccountCandidates(accountCandidatesArtifact);
export const workflowConfig = toWorkflowConfigModel(workflowConfigArtifact);
export const threeClassLabelSummary = toThreeClassLabelSummaryModel(threeClassLabelSummaryArtifact);
