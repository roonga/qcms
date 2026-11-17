import {
  accountStatusOf,
  clearAdminTwoFactor,
  countActiveSiteAdministrators,
  deleteAccountPassword,
  deletePendingTwoFactorSignIns,
  deleteTrustedDevices,
  disableAccount,
  findAccountById,
  invalidateLiveSignInLinks,
  listAccountHoldings,
  listWorkspacesHeldBy,
  newestSignInLinkPurpose,
  openSuspensionRun,
  revokeAccountSessions,
  SITE_ADMINISTRATOR_ROLE,
  suspendResponseMemberships,
  unclaimAccount,
  writeSiteAuditWithMirror,
  type AccountDirectoryRow,
  type AccountHoldings,
  type Executor,
} from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";

// The disable and reset bodies and their refusals, shared by the account routes and by the
// Site administrator acts that hold or apply them.

export const fail = {
  notFound: (): ApiError => new ApiError("ACCOUNT_NOT_FOUND", 404, "No such account"),
  mailNotConfigured: (): ApiError =>
    new ApiError(
      "MAIL_NOT_CONFIGURED",
      409,
      "This act emails the person a single-use sign-in link, so it is refused until " +
        "outbound email is configured.",
    ),
  busy: (): ApiError =>
    new ApiError(
      "ACCOUNT_BUSY",
      409,
      "Another change to this account is in progress. Try again in a moment.",
    ),
  self: (): ApiError =>
    new ApiError(
      "OWN_ACCOUNT",
      409,
      "You cannot do this to your own account. Change your own password and second " +
        "factor from your account settings.",
    ),
  alreadyDisabled: (): ApiError =>
    new ApiError("ACCOUNT_DISABLED", 409, "That account is already disabled"),
  disabled: (): ApiError =>
    new ApiError(
      "ACCOUNT_DISABLED",
      409,
      "That account is disabled. Reactivating it is what sends a new link",
    ),
  notDisabled: (): ApiError =>
    new ApiError("ACCOUNT_NOT_DISABLED", 409, "That account is not disabled"),
  unclaimed: (): ApiError =>
    new ApiError(
      "ACCOUNT_UNCLAIMED",
      409,
      "That account has not been claimed yet, so there is nothing to reset. Send it a " +
        "fresh sign-in link instead.",
    ),
  siteAdministratorChanged: (): ApiError =>
    new ApiError(
      "ACCOUNT_BUSY",
      409,
      "That account became a Site administrator while this was in progress. Try again.",
    ),
  lastSiteAdministrator: (): ApiError =>
    new ApiError(
      "LAST_SITE_ADMINISTRATOR",
      409,
      "This is the last active Site administrator, and a site needs one. It cannot be disabled.",
    ),
} as const;

export async function accountOf(exec: Executor, userId: string): Promise<AccountDirectoryRow> {
  const row = await findAccountById(exec, userId);
  if (row === undefined) throw fail.notFound();
  return row;
}

/** Refusals every disable shares, a Site administrator's included. */
export async function refuseDisable(
  tx: Executor,
  current: AccountDirectoryRow,
  actorId: string,
): Promise<void> {
  if (current.disabledAt !== null) throw fail.alreadyDisabled();
  if (current.role === SITE_ADMINISTRATOR_ROLE) {
    const active = accountStatusOf(current) === "active";
    if (active && (await countActiveSiteAdministrators(tx)) <= 1) {
      throw fail.lastSiteAdministrator();
    }
  }
  if (current.userId === actorId) throw fail.self();
}

/**
 * Disable inside the caller's transaction, under the account's lock: sessions, open
 * challenges, trusted devices and live links all go with it. Returns what the account held.
 */
export async function disableAccountWithin(
  tx: Executor,
  input: {
    readonly id: string;
    readonly actorId: string;
    readonly at: Date;
    readonly detail?: string;
  },
): Promise<AccountHoldings> {
  const held = await listAccountHoldings(tx, input.id);
  await disableAccount(tx, input.id, input.at);
  await revokeAccountSessions(tx, input.id, undefined);
  await deletePendingTwoFactorSignIns(tx, input.id);
  await deleteTrustedDevices(tx, input.id);
  await invalidateLiveSignInLinks(tx, input.id, input.at);
  await writeSiteAuditWithMirror(
    tx,
    {
      actor: input.actorId,
      subject: input.id,
      kind: "account",
      detail: input.detail === undefined ? "act=disable" : `act=disable ${input.detail}`,
      occurredAt: input.at,
    },
    await listWorkspacesHeldBy(tx, input.id),
  );
  return held;
}

/** Refusals every reset shares, a Site administrator's included. */
export async function refuseReset(
  tx: Executor,
  current: AccountDirectoryRow,
  actorId: string,
): Promise<void> {
  const status = accountStatusOf(current);
  if (status === "disabled") throw fail.disabled();
  if (current.userId === actorId) throw fail.self();
  // An account part-way through an earlier reset may be reset again, for example to add the
  // factor to a password reset; one never claimed has no credential to reset.
  if (status === "unclaimed" && (await newestSignInLinkPurpose(tx, current.userId)) !== "reset") {
    throw fail.unclaimed();
  }
  if (
    current.role === SITE_ADMINISTRATOR_ROLE &&
    status === "active" &&
    (await countActiveSiteAdministrators(tx)) <= 1
  ) {
    throw fail.lastSiteAdministrator();
  }
}

/**
 * Reset inside the link's issuing transaction. `performedBy` is the administrator the
 * suspension answers to, the requester where the reset was approved by another.
 */
export async function resetAccountWithin(
  tx: Executor,
  input: {
    readonly id: string;
    readonly performedBy: string;
    readonly at: Date;
    readonly password: boolean;
    readonly factor: boolean;
    readonly detail?: string;
  },
): Promise<void> {
  const { id, at } = input;
  await unclaimAccount(tx, id, at);
  if (input.password) await deleteAccountPassword(tx, id);
  if (input.factor) await clearAdminTwoFactor(tx, id);
  await revokeAccountSessions(tx, id, undefined);
  await deletePendingTwoFactorSignIns(tx, id);
  await deleteTrustedDevices(tx, id);
  const suspended = await suspendResponseMemberships(tx, {
    userId: id,
    by: input.performedBy,
    at,
  });
  await openSuspensionRun(tx, {
    userId: id,
    performedBy: input.performedBy,
    at,
    teamIds: suspended.map((hold) => hold.teamId),
  });
  const reset = [input.password ? "password" : "", input.factor ? "factor" : ""]
    .filter((part) => part !== "")
    .join(",");
  const extra = input.detail === undefined ? "" : ` ${input.detail}`;
  await writeSiteAuditWithMirror(
    tx,
    {
      actor: input.performedBy,
      subject: id,
      kind: "account",
      detail: `act=reset reset=${reset} suspended=${String(suspended.length)}${extra}`,
      occurredAt: at,
    },
    await listWorkspacesHeldBy(tx, id),
  );
}
