import type { RouteHandler } from "@hono/zod-openapi";
import {
  boundAccountTransaction,
  clearAdminTwoFactor,
  deleteAccountPassword,
  deletePendingTwoFactorSignIns,
  deleteTrustedDevices,
  listAccountHoldings,
  listWorkspacesHeldBy,
  openSuspensionRun,
  reactivateAccount,
  revokeAccountSessions,
  SITE_ADMINISTRATOR_ROLE,
  suspendResponseMemberships,
  tryLockAccount,
  writeSiteAuditWithMirror,
  type AccountHoldings,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import type { ApiEnv } from "../../openapi.js";
import { requireSiteActStepUp, requestOrApplySiteAct } from "../site-admins/acts.js";
import { requestView } from "../site-admins/schema.js";
import {
  accountOf,
  disableAccountWithin,
  fail,
  refuseDisable,
  refuseReset,
  resetAccountWithin,
} from "./lifecycle-acts.js";
import { accountView, principalOf } from "./handler.js";
import { issueAndSendSignInLink } from "./links.js";
import type {
  accountHoldingsRoute,
  disableAccountRoute,
  reactivateAccountRoute,
  resetAccountRoute,
} from "./route.js";

export function holdingsView(holdings: AccountHoldings): {
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
    if ((await accountOf(exec, id)).role === SITE_ADMINISTRATOR_ROLE) {
      await requireSiteActStepUp(deps, c, id, actor.userId);
      const outcome = await requestOrApplySiteAct(deps, {
        kind: "disable",
        target: id,
        requester: actor.userId,
        payload: {},
      });
      if (outcome.held !== undefined) return c.json({ request: requestView(outcome.held) }, 202);
      return c.json(
        {
          account: accountView(await accountOf(exec, id)),
          holdings: holdingsView(
            outcome.holdings ?? { groups: [], responseGroups: [], administratorOf: [] },
          ),
        },
        200,
      );
    }

    const now = deps.clock.now();
    // Tried, not waited for: a request queued behind another holder of the account lock
    // would hold its pooled connection for as long as that holder runs.
    const holdings = await exec.transaction(async (tx) => {
      await boundAccountTransaction(tx);
      if (!(await tryLockAccount(tx, id))) throw fail.busy();
      const current = await accountOf(tx, id);
      await refuseDisable(tx, current, actor.userId);
      if (current.role === SITE_ADMINISTRATOR_ROLE) throw fail.siteAdministratorChanged();
      return disableAccountWithin(tx, { id, actorId: actor.userId, at: now });
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
        await deleteTrustedDevices(tx, id);
        const suspended = await suspendResponseMemberships(tx, {
          userId: id,
          by: actor.userId,
          at: now,
        });
        await openSuspensionRun(tx, {
          userId: id,
          performedBy: actor.userId,
          at: now,
          teamIds: suspended.map((hold) => hold.teamId),
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
    if (target.role === SITE_ADMINISTRATOR_ROLE) {
      await requireSiteActStepUp(deps, c, id, actor.userId);
      const outcome = await requestOrApplySiteAct(deps, {
        kind: "reset",
        target: id,
        requester: actor.userId,
        payload: { password: body.password, factor: body.factor },
      });
      if (outcome.held !== undefined) return c.json({ request: requestView(outcome.held) }, 202);
      return c.json(
        { account: accountView(await accountOf(exec, id)), delivery: outcome.delivery ?? "sent" },
        200,
      );
    }

    const now = deps.clock.now();
    const delivery = await issueAndSendSignInLink(
      deps,
      exec,
      { userId: id, email: target.email, purpose: "reset", issuedBy: actor.userId },
      async (tx) => {
        const current = await accountOf(tx, id);
        await refuseReset(tx, current, actor.userId);
        if (current.role === SITE_ADMINISTRATOR_ROLE) throw fail.siteAdministratorChanged();
        await resetAccountWithin(tx, {
          id,
          performedBy: actor.userId,
          at: now,
          password: body.password,
          factor: body.factor,
        });
      },
      fail.busy,
    );

    return c.json({ account: accountView(await accountOf(exec, id)), delivery }, 200);
  };
}
