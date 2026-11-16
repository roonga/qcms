import type { RouteHandler } from "@hono/zod-openapi";
import {
  accountStatusOf,
  boundAccountTransaction,
  clearAdminTwoFactor,
  countActiveSiteAdministrators,
  deleteAccountPassword,
  deletePendingTwoFactorSignIns,
  disableAccount,
  findAccountById,
  invalidateLiveSignInLinks,
  listAccountHoldings,
  listWorkspacesHeldBy,
  newestSignInLinkPurpose,
  reactivateAccount,
  revokeAccountSessions,
  SITE_ADMINISTRATOR_ROLE,
  suspendResponseMemberships,
  tryLockAccount,
  unclaimAccount,
  writeSiteAuditWithMirror,
  type AccountDirectoryRow,
  type AccountHoldings,
  type Executor,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { accountView, principalOf } from "./handler.js";
import { issueAndSendSignInLink } from "./links.js";
import type {
  accountHoldingsRoute,
  disableAccountRoute,
  reactivateAccountRoute,
  resetAccountRoute,
} from "./route.js";

const fail = {
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
  lastSiteAdministrator: (): ApiError =>
    new ApiError(
      "LAST_SITE_ADMINISTRATOR",
      409,
      "This is the last active Site administrator, and a site needs one. It cannot be disabled.",
    ),
  siteAdministrator: (): ApiError =>
    new ApiError(
      "SITE_ADMINISTRATOR_DISABLE_REFUSED",
      409,
      "Disabling a Site administrator needs step-up authentication and the approval of " +
        "another Site administrator, which this site does not offer yet.",
    ),
  siteAdministratorReset: (): ApiError =>
    new ApiError(
      "SITE_ADMINISTRATOR_RESET_REFUSED",
      409,
      "Resetting a Site administrator needs step-up authentication and the approval of " +
        "another Site administrator, which this site does not offer yet.",
    ),
} as const;

async function accountOf(exec: Executor, userId: string): Promise<AccountDirectoryRow> {
  const row = await findAccountById(exec, userId);
  if (row === undefined) throw fail.notFound();
  return row;
}

function holdingsView(holdings: AccountHoldings): {
  groups: {
    workspaceId: string;
    workspaceName: string;
    groupId: string;
    groupName: string;
    roles: string[];
    environments: string[];
    suspended: boolean;
  }[];
  responseGroups: {
    workspaceId: string;
    workspaceName: string;
    groupId: string;
    groupName: string;
    roles: string[];
    environments: string[];
    suspended: boolean;
  }[];
  administratorOf: { workspaceId: string; workspaceName: string; last: boolean }[];
} {
  const group = (row: AccountHoldings["groups"][number]) => ({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    groupId: row.teamId,
    groupName: row.groupName,
    roles: [...row.roles],
    environments: [...row.environments],
    suspended: row.suspended,
  });
  return {
    groups: holdings.groups.map(group),
    responseGroups: holdings.responseGroups.map(group),
    administratorOf: holdings.administratorOf.map((row) => ({ ...row })),
  };
}

export function makeAccountHoldingsHandler(
  deps: Deps,
): RouteHandler<typeof accountHoldingsRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const exec = deps.databases.control;
    await accountOf(exec, id);
    return c.json({ holdings: holdingsView(await listAccountHoldings(exec, id)) }, 200);
  };
}

export function makeDisableAccountHandler(
  deps: Deps,
): RouteHandler<typeof disableAccountRoute, ApiEnv> {
  return async (c) => {
    const actor = principalOf(c);
    const { id } = c.req.valid("param");

    const exec = deps.databases.control;
    const now = deps.clock.now();
    // Tried, not waited for: a request queued behind another holder of the account lock
    // would hold its pooled connection for as long as that holder runs.
    const holdings = await exec.transaction(async (tx) => {
      await boundAccountTransaction(tx);
      if (!(await tryLockAccount(tx, id))) throw fail.busy();
      const current = await accountOf(tx, id);
      if (current.disabledAt !== null) throw fail.alreadyDisabled();
      if (current.role === SITE_ADMINISTRATOR_ROLE) {
        const active = accountStatusOf(current) === "active";
        if (active && (await countActiveSiteAdministrators(tx)) <= 1) {
          throw fail.lastSiteAdministrator();
        }
      }
      if (id === actor.userId) throw fail.self();
      if (current.role === SITE_ADMINISTRATOR_ROLE) throw fail.siteAdministrator();

      const held = await listAccountHoldings(tx, id);
      await disableAccount(tx, id, now);
      await revokeAccountSessions(tx, id, undefined);
      await deletePendingTwoFactorSignIns(tx, id);
      await invalidateLiveSignInLinks(tx, id, now);
      await writeSiteAuditWithMirror(
        tx,
        {
          actor: actor.userId,
          subject: id,
          kind: "account",
          detail: "act=disable",
          occurredAt: now,
        },
        await listWorkspacesHeldBy(tx, id),
      );
      return held;
    });

    return c.json(
      { account: accountView(await accountOf(exec, id)), holdings: holdingsView(holdings) },
      200,
    );
  };
}

export function makeReactivateAccountHandler(
  deps: Deps,
): RouteHandler<typeof reactivateAccountRoute, ApiEnv> {
  return async (c) => {
    const actor = principalOf(c);
    const { id } = c.req.valid("param");
    if (!deps.mailer.configured) throw fail.mailNotConfigured();
    if (id === actor.userId) throw fail.self();

    const exec = deps.databases.control;
    const target = await accountOf(exec, id);
    const now = deps.clock.now();
    const delivery = await issueAndSendSignInLink(
      deps,
      exec,
      { userId: id, email: target.email, purpose: "reactivated", issuedBy: actor.userId },
      async (tx) => {
        const current = await accountOf(tx, id);
        if (current.disabledAt === null) throw fail.notDisabled();
        await reactivateAccount(tx, id, now);
        await deleteAccountPassword(tx, id);
        await clearAdminTwoFactor(tx, id);
        await revokeAccountSessions(tx, id, undefined);
        await deletePendingTwoFactorSignIns(tx, id);
        const suspended = await suspendResponseMemberships(tx, {
          userId: id,
          by: actor.userId,
          at: now,
        });
        await writeSiteAuditWithMirror(
          tx,
          {
            actor: actor.userId,
            subject: id,
            kind: "account",
            detail: `act=reactivate suspended=${String(suspended.length)}`,
            occurredAt: now,
          },
          await listWorkspacesHeldBy(tx, id),
        );
      },
      fail.busy,
    );

    return c.json({ account: accountView(await accountOf(exec, id)), delivery }, 200);
  };
}

export function makeResetAccountHandler(
  deps: Deps,
): RouteHandler<typeof resetAccountRoute, ApiEnv> {
  return async (c) => {
    const actor = principalOf(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!deps.mailer.configured) throw fail.mailNotConfigured();
    if (id === actor.userId) throw fail.self();

    const exec = deps.databases.control;
    const target = await accountOf(exec, id);
    const now = deps.clock.now();
    const delivery = await issueAndSendSignInLink(
      deps,
      exec,
      { userId: id, email: target.email, purpose: "reset", issuedBy: actor.userId },
      async (tx) => {
        const current = await accountOf(tx, id);
        const status = accountStatusOf(current);
        if (status === "disabled") throw fail.disabled();
        if (current.role === SITE_ADMINISTRATOR_ROLE) throw fail.siteAdministratorReset();
        // An account part-way through an earlier reset may be reset again, for example to
        // add the factor to a password reset; one never claimed has no credential to reset.
        if (status === "unclaimed" && (await newestSignInLinkPurpose(tx, id)) !== "reset") {
          throw fail.unclaimed();
        }
        await unclaimAccount(tx, id, now);
        if (body.password) await deleteAccountPassword(tx, id);
        if (body.factor) await clearAdminTwoFactor(tx, id);
        await revokeAccountSessions(tx, id, undefined);
        await deletePendingTwoFactorSignIns(tx, id);
        const suspended = await suspendResponseMemberships(tx, {
          userId: id,
          by: actor.userId,
          at: now,
        });
        const reset = [body.password ? "password" : "", body.factor ? "factor" : ""]
          .filter((part) => part !== "")
          .join(",");
        await writeSiteAuditWithMirror(
          tx,
          {
            actor: actor.userId,
            subject: id,
            kind: "account",
            detail: `act=reset reset=${reset} suspended=${String(suspended.length)}`,
            occurredAt: now,
          },
          await listWorkspacesHeldBy(tx, id),
        );
      },
      fail.busy,
    );

    return c.json({ account: accountView(await accountOf(exec, id)), delivery }, 200);
  };
}
