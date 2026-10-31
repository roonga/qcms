/**
 * The two headers a confirmed agent step carries (SEC-17 section 7.4). They add
 * provenance to the request the screen's own server action was already going to make, and
 * never a right it did not have (R2).
 */

export const AGENT_PROPOSAL_HEADER = "x-qcms-agent-proposal";
export const AGENT_PROPOSAL_STEP_HEADER = "x-qcms-agent-step";

/** The trailing argument every proposable server action takes. */
export interface AgentProposalRef {
  /** The signed proposal token, as the `action` or `plan` event carried it. */
  readonly agentProposal: string;
  /** This step's zero-based index in the proposal's ordered list. */
  readonly step: number;
}

/**
 * The headers for one step, or none for an ordinary human act. A malformed reference sends
 * neither header rather than one: the API refuses a half-presented proposal, and a request
 * this app could not describe should be the ordinary act it is.
 */
export function proposalHeaders(ref: AgentProposalRef | undefined): Record<string, string> {
  if (ref === undefined) return {};
  if (ref.agentProposal === "" || !Number.isInteger(ref.step) || ref.step < 0) return {};
  return {
    [AGENT_PROPOSAL_HEADER]: ref.agentProposal,
    [AGENT_PROPOSAL_STEP_HEADER]: String(ref.step),
  };
}
