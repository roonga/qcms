/**
 * The two headers a confirmed agent step carries (083 D0, SEC-17 section 7.4).
 *
 * A step runs through **the screen's own server action**, with one trailing argument the
 * action forwards as these headers and nothing else: the same `requireAdminSession()`
 * gate, the same Next origin check, the same API route, the same authorisation and the
 * same revalidation as the control a human presses. That is what makes "the confirmed act
 * is authorised and audited as the user's" true rather than claimed, and it keeps this app
 * a proxy (R2): it adds provenance to a request and never rights.
 *
 * A hand-off step carries no token, so the argument is absent for it and these headers are
 * simply not sent.
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
