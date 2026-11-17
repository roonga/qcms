import {
  accountStatusOf,
  boundAccountTransaction,
  countActiveSiteAdministrators,
  decideApprovalRequest,
  findAccountById,
  insertApprovalRequest,
  listActiveSiteAdministratorIds,
  setSiteAdministrator,
  SITE_ADMINISTRATOR_ROLE,
  tryLockAccount,
  tryLockSiteAdministrators,
  writeSiteAuditRow,
  type AccountDirectoryRow,
  type AccountHoldings,
  type ApprovalRequestRow,
  type Executor,
  type SiteApprovalKind,
} from "@roonga/qcms-db";
import type { Context } from "hono";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import {
  disableAccountWithin,
  fail as accountFail,
  refuseDisable,
  refuseReset,
  resetAccountWithin,
} from "../accounts/lifecycle-acts.js";
import { issueAndSendSignInLink, type SignInLinkDeliveryOutcome } from "../accounts/links.js";
import { requireStepUp } from "../auth/step-up.js";

export const siteFail = {
  busy: (): ApiError =>
    new ApiError(
      "SITE_ADMINISTRATORS_BUSY",
      409,
      "Another change to the Site administrators is in progress. Try again in a moment.",
    ),
  unclaimed: (): ApiError =>
    new ApiError(
      "ACCOUNT_UNCLAIMED",
      409,
      "That account has not been claimed yet, so it cannot be made a Site administrator.",
    ),
  alreadyAdministrator: (): ApiError =>
    new ApiError("ALREADY_SITE_ADMINISTRATOR", 409, "That account is already a Site administrator"),
  notAdministrator: (): ApiError =>
    new ApiError("NOT_SITE_ADMINISTRATOR", 409, "That account is not a Site administrator"),
  lastToDemote: (): ApiError =>
    new ApiError(
      "LAST_SITE_ADMINISTRATOR",
      409,
      "This is the last active Site administrator, and a site needs one. It cannot be demoted.",
    ),
  requestPending: (): ApiError =>
    new ApiError(
      "REQUEST_PENDING",
      409,
      "You already have a pending request for this. It waits for another Site administrator.",
    ),
  approvalsChanged: (): ApiError =>
    new ApiError(
      "SITE_ADMINISTRATORS_CHANGED",
      409,
      "Who can approve this changed while it was in progress. Try again.",
    ),
  requestNotFound: (): ApiError =>
    new ApiError("REQUEST_NOT_FOUND", 404, "No such approval request"),
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
  targetDecides: (): ApiError =>
    new ApiError(
      "TARGET_DECIDES",
      409,
      "This request is about your own account, so another Site administrator decides it",
    ),
  requesterGone: (): ApiError =>
    new ApiError(
      "REQUESTER_NOT_SITE_ADMINISTRATOR",
      409,
      "The person who asked is no longer an active Site administrator, so this cannot be approved",
    ),
  notHere: (): ApiError =>
    new ApiError(
      "REQUEST_NOT_DECIDED_HERE",
      409,
      "A workspace request is decided in its own workspace",
    ),
} as const;

/**
 * The step-up a Site administrator act needs, after the cheap refusals that need none, so a
 * self-act answers `OWN_ACCOUNT` rather than asking for a step-up it could never use.
 */
export async function requireSiteActStepUp(
  deps: Deps,
  c: Context<ApiEnv>,
  target: string,
  actorId: string,
): Promise<void> {
  if (target === actorId) throw accountFail.self();
  await requireStepUp(deps, c);
}

/** What a site act did: held as a request, or applied with step-up alone. */
export interface SiteActOutcome {
  readonly held?: ApprovalRequestRow | undefined;
  readonly holdings?: AccountHoldings | undefined;
  readonly delivery?: SignInLinkDeliveryOutcome | undefined;
}

interface SiteActInput {
  readonly kind: SiteApprovalKind;
  readonly target: string;
  readonly requester: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

async function accountOf(exec: Executor, userId: string): Promise<AccountDirectoryRow> {
  const row = await findAccountById(exec, userId);
  if (row === undefined) throw accountFail.notFound();
  return row;
}

async function lockFor(tx: Executor, target: string): Promise<void> {
  await boundAccountTransaction(tx);
  // Both tried, never waited for, so no order between them can deadlock.
  if (!(await tryLockSiteAdministrators(tx))) throw siteFail.busy();
  if (!(await tryLockAccount(tx, target))) throw accountFail.busy();
}

function refusePromote(current: AccountDirectoryRow, requester: string): void {
  if (current.userId === requester) throw accountFail.self();
  if (current.role === SITE_ADMINISTRATOR_ROLE) throw siteFail.alreadyAdministrator();
  if (current.disabledAt !== null) throw accountFail.alreadyDisabled();
  if (current.claimedAt === null) throw siteFail.unclaimed();
}

async function refuseDemote(
  tx: Executor,
  current: AccountDirectoryRow,
  requester: string,
): Promise<void> {
  if (current.role !== SITE_ADMINISTRATOR_ROLE) throw siteFail.notAdministrator();
  const active = accountStatusOf(current) === "active";
  if (active && (await countActiveSiteAdministrators(tx)) <= 1) throw siteFail.lastToDemote();
  if (current.userId === requester) throw accountFail.self();
}

/** The refusals of each kind, run when it is asked for and again when it is applied. */
async function refuseSiteAct(
  tx: Executor,
  kind: SiteApprovalKind,
  current: AccountDirectoryRow,
  requester: string,
): Promise<void> {
  switch (kind) {
    case "promote":
      return refusePromote(current, requester);
    case "demote":
      return refuseDemote(tx, current, requester);
    case "disable":
      return refuseDisable(tx, current, requester);
    case "reset":
      return refuseReset(tx, current, requester);
  }
}

/** The Site administrators who could approve: active, claimed, neither requester nor target. */
async function approversFor(tx: Executor, input: SiteActInput): Promise<readonly string[]> {
  return (await listActiveSiteAdministratorIds(tx)).filter(
    (id) => id !== input.requester && id !== input.target,
  );
}

function actDetail(kind: SiteApprovalKind, approval: string): string {
  return kind === "promote" || kind === "demote" ? `act=${kind} ${approval}` : approval;
}

/** Apply a non-reset kind inside `tx`, under both locks, after its refusals ran. */
async function applyInTransaction(
  tx: Executor,
  deps: Deps,
  input: SiteActInput,
  approval: string,
): Promise<AccountHoldings | undefined> {
  const at = deps.clock.now();
  switch (input.kind) {
    case "promote":
    case "demote":
      await setSiteAdministrator(tx, {
        userId: input.target,
        administrator: input.kind === "promote",
        at,
      });
      await writeSiteAuditRow(tx, {
        actor: input.requester,
        subject: input.target,
        kind: "administrator",
        detail: actDetail(input.kind, approval),
        occurredAt: at,
      });
      return undefined;
    case "disable":
      return disableAccountWithin(tx, {
        id: input.target,
        actorId: input.requester,
        at,
        detail: approval,
      });
    case "reset":
      throw new Error("a reset is applied through its link transaction");
  }
}

function resetPayload(payload: Readonly<Record<string, unknown>>): {
  password: boolean;
  factor: boolean;
} {
  return { password: payload.password === true, factor: payload.factor === true };
}

async function applyReset(
  deps: Deps,
  input: SiteActInput,
  within: (tx: Executor) => Promise<string>,
): Promise<SignInLinkDeliveryOutcome> {
  if (!deps.mailer.configured) throw accountFail.mailNotConfigured();
  const exec = deps.databases.control;
  const target = await accountOf(exec, input.target);
  const { password, factor } = resetPayload(input.payload);
  return issueAndSendSignInLink(
    deps,
    exec,
    { userId: input.target, email: target.email, purpose: "reset", issuedBy: input.requester },
    async (tx) => {
      // The account's lock is already held by the link transaction.
      if (!(await tryLockSiteAdministrators(tx))) throw siteFail.busy();
      const approval = await within(tx);
      await resetAccountWithin(tx, {
        id: input.target,
        performedBy: input.requester,
        at: deps.clock.now(),
        password,
        factor,
        detail: approval,
      });
    },
    accountFail.busy,
  );
}

/**
 * Ask for a site act: held as a request when another active, claimed Site administrator
 * than the requester and the target exists, and applied at once on step-up alone otherwise.
 */
export async function requestOrApplySiteAct(
  deps: Deps,
  input: SiteActInput,
): Promise<SiteActOutcome> {
  const exec = deps.databases.control;
  const decided = await exec.transaction(async (tx) => {
    await lockFor(tx, input.target);
    const current = await accountOf(tx, input.target);
    await refuseSiteAct(tx, input.kind, current, input.requester);
    const approvers = await approversFor(tx, input);
    if (approvers.length === 0) {
      if (input.kind === "reset") return { applyReset: true } as const;
      const holdings = await applyInTransaction(tx, deps, input, "approval=step-up-only");
      return { holdings } as const;
    }
    const at = deps.clock.now();
    const held = await insertApprovalRequest(tx, {
      kind: input.kind,
      target: input.target,
      payload: input.payload,
      requestedBy: input.requester,
      requestedAt: at,
    });
    if (held === undefined) throw siteFail.requestPending();
    await writeSiteAuditRow(tx, {
      actor: input.requester,
      subject: held.requestId,
      kind: "approval",
      detail: `act=request kind=${input.kind} target=${input.target}`,
      occurredAt: at,
    });
    return { held } as const;
  });

  if (!("applyReset" in decided)) return decided;
  const delivery = await applyReset(deps, input, async (tx) => {
    const current = await accountOf(tx, input.target);
    await refuseSiteAct(tx, input.kind, current, input.requester);
    if ((await approversFor(tx, input)).length > 0) throw siteFail.approvalsChanged();
    return "approval=step-up-only";
  });
  return { delivery };
}

function refuseDecider(request: ApprovalRequestRow, deciderId: string, now: Date): void {
  if (request.scope !== "site") throw siteFail.notHere();
  if (request.status !== "pending") throw siteFail.notPending();
  if (request.expiresAt.getTime() <= now.getTime()) throw siteFail.expired();
  if (request.requestedBy === deciderId) throw siteFail.ownRequest();
  if (request.target === deciderId) throw siteFail.targetDecides();
}

async function decide(
  tx: Executor,
  deps: Deps,
  request: ApprovalRequestRow,
  deciderId: string,
  decision: "approved" | "rejected",
): Promise<ApprovalRequestRow> {
  const at = deps.clock.now();
  refuseDecider(request, deciderId, at);
  const decided = await decideApprovalRequest(tx, {
    requestId: request.requestId,
    decision,
    decidedBy: deciderId,
    decidedAt: at,
  });
  if (decided === undefined) throw siteFail.notPending();
  await writeSiteAuditRow(tx, {
    actor: deciderId,
    subject: request.requestId,
    kind: "approval",
    detail: `act=${decision === "approved" ? "approve" : "reject"} kind=${request.kind} target=${request.target} requester=${request.requestedBy}`,
    occurredAt: at,
  });
  return decided;
}

/**
 * Approve a pending site request and apply it in the same transaction, re-checked as it is
 * applied: the requester must still be an active Site administrator, and the act's own
 * refusals hold as they did when it was asked for.
 */
export async function approveSiteRequest(
  deps: Deps,
  request: ApprovalRequestRow,
  approverId: string,
): Promise<{
  readonly request: ApprovalRequestRow;
  readonly delivery?: SignInLinkDeliveryOutcome;
}> {
  refuseDecider(request, approverId, deps.clock.now());
  const input: SiteActInput = {
    kind: request.kind as SiteApprovalKind,
    target: request.target,
    requester: request.requestedBy,
    payload: request.payload,
  };
  const approval = `request=${request.requestId} approver=${approverId}`;
  const recheck = async (tx: Executor): Promise<ApprovalRequestRow> => {
    const decided = await decide(tx, deps, request, approverId, "approved");
    if (!(await listActiveSiteAdministratorIds(tx)).includes(request.requestedBy)) {
      throw siteFail.requesterGone();
    }
    const current = await accountOf(tx, request.target);
    await refuseSiteAct(tx, input.kind, current, input.requester);
    return decided;
  };

  if (input.kind === "reset") {
    let decided: ApprovalRequestRow = request;
    const delivery = await applyReset(deps, input, async (tx) => {
      decided = await recheck(tx);
      return approval;
    });
    return { request: decided, delivery };
  }
  const decided = await deps.databases.control.transaction(async (tx) => {
    await lockFor(tx, request.target);
    const row = await recheck(tx);
    await applyInTransaction(tx, deps, input, approval);
    return row;
  });
  return { request: decided };
}

/** Reject a pending site request; nothing is applied. */
export async function rejectSiteRequest(
  deps: Deps,
  request: ApprovalRequestRow,
  deciderId: string,
): Promise<ApprovalRequestRow> {
  return deps.databases.control.transaction(async (tx) => {
    await boundAccountTransaction(tx);
    return decide(tx, deps, request, deciderId, "rejected");
  });
}
