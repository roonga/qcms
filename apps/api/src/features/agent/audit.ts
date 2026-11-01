/**
 * The SEC-17 audit row one confirmed step writes. It is called from the handler the step
 * runs through, inside **that step's own transaction**, so a failed step writes no row and
 * the card's report and the audit trail agree.
 */

import { writeAgentActionRow, type Executor } from "@roonga/qcms-db";
import type { Context } from "hono";

import type { ApiEnv } from "../../openapi.js";
import type { VerifiedProposal } from "./provenance.js";

export interface AgentStepSite {
  readonly proposal: VerifiedProposal;
  readonly actor: string;
  readonly workspaceId: string;
}

/**
 * The verified proposal and the actor and workspace its row is written under, or
 * `undefined` for an ordinary human request. A verified step whose route resolved no
 * workspace is a build defect rather than a caller's doing, so it throws and the step's
 * own transaction rolls the act back with it.
 */
export function agentStepSite(c: Context<ApiEnv>): AgentStepSite | undefined {
  const proposal = c.get("agentProposal");
  if (proposal === undefined) return undefined;
  const actor = c.get("adminPrincipal")?.userId;
  const workspaceId = c.get("grantContext")?.workspaceId;
  if (actor === undefined || workspaceId === undefined) {
    throw new Error(
      `Action kind "${proposal.kind}" verified a proposal on a route that resolves no ` +
        "workspace, so its step cannot be audited.",
    );
  }
  return { proposal, actor, workspaceId };
}

/**
 * Appends one step row, or nothing for a request with no verified proposal. `detail` is
 * the step's non-content detail: a version number, an environment name, a count or a role
 * name. It is the record a later step's reference is checked against, so it must be the
 * value that step would resolve. Never an answer value, a secret or `LocalizedText`.
 */
export async function writeAgentStep(
  exec: Executor,
  site: AgentStepSite | undefined,
  detail: string | undefined,
  confirmedAt: Date,
): Promise<void> {
  if (site === undefined) return;
  await writeAgentActionRow(exec, {
    proposalId: site.proposal.proposalId,
    stepIndex: site.proposal.stepIndex,
    stepCount: site.proposal.stepCount,
    actor: site.actor,
    workspaceId: site.workspaceId,
    environment: site.proposal.environment,
    formId: site.proposal.formId,
    kind: site.proposal.kind,
    screen: site.proposal.screen,
    proposedAt: site.proposal.proposedAt,
    confirmedAt,
    detail,
  });
}
