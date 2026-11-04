/** Proposal headers add provenance to an ordinary authorized action; they grant no extra rights. */

export const AGENT_PROPOSAL_HEADER = "x-qcms-agent-proposal";
export const AGENT_PROPOSAL_STEP_HEADER = "x-qcms-agent-step";

export interface AgentProposalRef {
  readonly agentProposal: string;

  readonly step: number;
}

/** Send both proposal headers or neither; the API refuses a half-presented proposal. */
export function proposalHeaders(ref: AgentProposalRef | undefined): Record<string, string> {
  if (ref === undefined) return {};
  if (ref.agentProposal === "" || !Number.isInteger(ref.step) || ref.step < 0) return {};
  return {
    [AGENT_PROPOSAL_HEADER]: ref.agentProposal,
    [AGENT_PROPOSAL_STEP_HEADER]: String(ref.step),
  };
}
