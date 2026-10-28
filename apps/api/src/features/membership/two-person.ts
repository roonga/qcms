// One per-workspace switch, `requireSecondApprover`, governs both a `prod` release and a
// `prod` webhook endpoint change: the two acts that can put production personal data
// somewhere new. Off by default, because an installation with a single administrator
// could otherwise never release to `prod`. It gates `prod` alone, by decision.
//
// Every check here compares **accounts**, not roles: one person may hold `forms.editor`
// and `forms.approver` together. Which roles those accounts hold was already settled by
// the grant middleware.
//
// The switch lives on `control.organization`, which no environment role holds any
// privilege on, so it is read on the control pool.

import { getWorkspace } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";
import { PRODUCTION_ENVIRONMENT } from "./policy.js";

// A missing workspace answers true: not finding one is no reason to skip a production
// control.
export async function twoPersonRuleApplies(
  exec: Executor,
  input: { readonly workspaceId: string | undefined; readonly environment: string | undefined },
): Promise<boolean> {
  if (input.environment !== PRODUCTION_ENVIRONMENT) return false;
  if (input.workspaceId === undefined) return true;
  const workspace = await getWorkspace(exec, input.workspaceId);
  return workspace === undefined ? true : workspace.requireSecondApprover;
}

export const twoPersonFailures = {
  // 403 rather than 409: what is missing is authority this account cannot acquire by
  // retrying.
  selfApproval: (version: number): ApiError =>
    new ApiError(
      "APPROVER_IS_AUTHOR",
      403,
      `This workspace requires a second approver for production, and you published ` +
        `version ${version}. A different account holding forms.approver with prod in scope ` +
        `has to release it.`,
    ),
  // A version with no recorded publisher is refused rather than allowed: with one of the
  // two accounts unknown, "a different account released it" cannot be claimed.
  unknownAuthor: (version: number): ApiError =>
    new ApiError(
      "APPROVER_UNKNOWN_AUTHOR",
      409,
      `Version ${version} was published before this deployment recorded publishing ` +
        `accounts, so the second-approver rule cannot be checked against it. Publish a new ` +
        `version and release that, or turn the workspace's second-approver setting off.`,
    ),
} as const;

// Answers the account to write into `form_releases.approved_by`, or `undefined` when no
// approval was required, so with the switch off nothing is compared and nothing written.
// `author` is the version's publisher, not whoever last edited the draft.
export async function approvalForRelease(
  exec: Executor,
  input: {
    readonly workspaceId: string | undefined;
    readonly environment: string;
    readonly version: number;
    readonly author: string | null;
    readonly releasedBy: string;
  },
): Promise<string | undefined> {
  const applies = await twoPersonRuleApplies(exec, {
    workspaceId: input.workspaceId,
    environment: input.environment,
  });
  if (!applies) return undefined;
  if (input.author === null) throw twoPersonFailures.unknownAuthor(input.version);
  if (input.author === input.releasedBy) throw twoPersonFailures.selfApproval(input.version);
  return input.releasedBy;
}
