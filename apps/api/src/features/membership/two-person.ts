// `requireSecondApprover` governs a `prod` release and a `prod` webhook endpoint change,
// off by default so a single administrator can release. Checks compare accounts, not roles.
// Read on the control pool: `control.organization` is outside every environment role.

import {
  decideApprovalRequest,
  getWorkspace,
  insertApprovalRequest,
  listActiveAdministratorsFor,
  listActiveRoleHolders,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { ApprovalKind, ApprovalRequestRow, Executor } from "@roonga/qcms-db";

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
        `version ${version}. A different account holding forms.publisher in prod has to ` +
        `release it.`,
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

/** The refusals every held request shares, whichever surface decides it. */
export const heldRequestFailures = {
  pending: (): ApiError =>
    new ApiError(
      "REQUEST_PENDING",
      409,
      "You already have a pending request for this. It waits for an approver.",
    ),
  notFound: (): ApiError => new ApiError("REQUEST_NOT_FOUND", 404, "No such approval request"),
  notPending: (): ApiError =>
    new ApiError("REQUEST_NOT_PENDING", 409, "That request has already been decided"),
  expired: (): ApiError =>
    new ApiError(
      "REQUEST_EXPIRED",
      409,
      "That request is more than 7 days old and can no longer be approved",
    ),
  ownRequest: (): ApiError =>
    new ApiError("OWN_REQUEST", 409, "You cannot decide your own request"),
} as const;

/** Refuse a decision on a request that is not pending, has expired, or is the decider's own. */
export function refuseHeldDecision(
  request: ApprovalRequestRow,
  deciderId: string,
  now: Date,
): void {
  if (request.status !== "pending") throw heldRequestFailures.notPending();
  if (request.expiresAt.getTime() <= now.getTime()) throw heldRequestFailures.expired();
  if (request.requestedBy === deciderId) throw heldRequestFailures.ownRequest();
}

export async function writeHeldRequestAudit(
  tx: Executor,
  input: {
    readonly request: ApprovalRequestRow;
    readonly act: "request" | "approve" | "reject" | "lapsed";
    readonly actor: string;
    readonly at: Date;
    readonly environment?: string;
    readonly formId?: string;
  },
): Promise<void> {
  const { request } = input;
  if (request.workspaceId === null) return;
  await writeAccessAuditRow(tx, {
    actor: input.actor,
    workspaceId: request.workspaceId,
    kind: "approval",
    ...(input.environment === undefined ? {} : { environment: input.environment }),
    ...(input.formId === undefined ? {} : { formId: input.formId }),
    detail:
      `request=${request.requestId} act=${input.act} kind=${request.kind} ` +
      `target=${request.target} requester=${request.requestedBy}`,
    occurredAt: input.at,
  });
}

/**
 * End a request whose approver found that what it bound had moved, so the requester can ask
 * again. The act is `lapsed` rather than `reject`, because the approver did not refuse it.
 */
export async function lapseHeldRequest(
  tx: Executor,
  input: {
    readonly request: ApprovalRequestRow;
    readonly actor: string;
    readonly at: Date;
    readonly environment?: string;
    readonly formId?: string;
  },
): Promise<ApprovalRequestRow> {
  const decided = await decideApprovalRequest(tx, {
    requestId: input.request.requestId,
    decision: "rejected",
    decidedBy: input.actor,
    decidedAt: input.at,
  });
  if (decided === undefined) throw heldRequestFailures.notPending();
  await writeHeldRequestAudit(tx, {
    request: decided,
    act: "lapsed",
    actor: input.actor,
    at: input.at,
    ...(input.environment === undefined ? {} : { environment: input.environment }),
    ...(input.formId === undefined ? {} : { formId: input.formId }),
  });
  return decided;
}

/** Store a held workspace act as a pending request, with its `approval` audit row. */
export async function holdWorkspaceRequest(
  tx: Executor,
  at: Date,
  input: {
    readonly kind: Exclude<ApprovalKind, "promote" | "demote" | "disable" | "reset">;
    readonly workspaceId: string;
    readonly target: string;
    readonly requester: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly environment?: string;
    readonly formId?: string;
  },
): Promise<ApprovalRequestRow> {
  const held = await insertApprovalRequest(tx, {
    kind: input.kind,
    workspaceId: input.workspaceId,
    target: input.target,
    payload: input.payload,
    requestedBy: input.requester,
    requestedAt: at,
  });
  if (held === undefined) throw heldRequestFailures.pending();
  await writeHeldRequestAudit(tx, {
    request: held,
    act: "request",
    actor: input.requester,
    at,
    ...(input.environment === undefined ? {} : { environment: input.environment }),
    ...(input.formId === undefined ? {} : { formId: input.formId }),
  });
  return held;
}

/** Which second person is missing for the rule to be satisfiable, from `requester`'s seat. */
export interface SecondApprovalShortfall {
  /** No active, claimed Workspace administrator or Site administrator other than the requester. */
  readonly administrator: boolean;
  /** Fewer than two active, claimed holders of Publish forms for `prod` in the workspace. */
  readonly publisher: boolean;
}

export async function secondApprovalShortfall(
  exec: Executor,
  input: { readonly workspaceId: string; readonly requester: string },
): Promise<SecondApprovalShortfall> {
  const administrators = await listActiveAdministratorsFor(exec, input.workspaceId);
  const publishers = await listActiveRoleHolders(exec, {
    workspaceId: input.workspaceId,
    role: "forms.publisher",
    environment: PRODUCTION_ENVIRONMENT,
  });
  return {
    administrator: !administrators.some((id) => id !== input.requester),
    publisher: publishers.length < 2,
  };
}

export function nobodyElseCouldApprove(shortfall: SecondApprovalShortfall): boolean {
  return shortfall.administrator || shortfall.publisher;
}

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
