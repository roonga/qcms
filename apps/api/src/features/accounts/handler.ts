import type { RouteHandler } from "@hono/zod-openapi";
import {
  accountStatusOf,
  findAccountById,
  findAdminsByEmail,
  listAccountDirectory,
  newestSignInLink,
  SITE_ADMINISTRATOR_ROLE,
  writeSiteAuditRow,
  type AccountDirectoryRow,
  type AccountRoleFilter,
  type AccountStatus,
  type Executor,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { adminAuthFor } from "../auth/route.js";
import { createUnclaimedAccount } from "./credential.js";
import { issueAndSendSignInLink } from "./links.js";
import type { createAccountRoute, listAccountsRoute, resendSignInLinkRoute } from "./route.js";

// Site administrators only: every route here carries `installationOnly` in
// `features/membership/route-policy.ts`, so no workspace grant reaches one and the
// directory stays closed to a Workspace administrator.

/** An offset nothing can reach: 200 a page over this is far beyond any real directory. */
const MAX_PAGE = 10_000;

const fail = {
  noPrincipal: (): ApiError => new ApiError("unauthorized", 401, "Admin authentication required"),
  mailNotConfigured: (): ApiError =>
    new ApiError(
      "MAIL_NOT_CONFIGURED",
      409,
      "Account creation sends a single-use sign-in link, so it is refused until " +
        "outbound email is configured. The first account, created by qcms:create-admin, " +
        "is the only one that does not need it.",
    ),
  addressTaken: (): ApiError =>
    new ApiError("ACCOUNT_EXISTS", 409, "An account already holds that address"),
  notFound: (): ApiError => new ApiError("ACCOUNT_NOT_FOUND", 404, "No such account"),
  disabled: (): ApiError =>
    new ApiError(
      "ACCOUNT_DISABLED",
      409,
      "That account is disabled. Reactivating it is what sends a new link",
    ),
  alreadyClaimed: (): ApiError =>
    new ApiError(
      "ACCOUNT_CLAIMED",
      409,
      "That account is already claimed, so there is no creation link to resend",
    ),
  badWindow: (): ApiError =>
    new ApiError(
      "INVALID_QUERY",
      400,
      `page and pageSize must be positive integers, and page at most ${String(MAX_PAGE)}`,
    ),
} as const;

export function principalOf(c: { get: (key: "adminPrincipal") => unknown }): {
  readonly userId: string;
  readonly role: string;
} {
  const principal = c.get("adminPrincipal") as
    { readonly userId: string; readonly role: string } | undefined;
  if (principal === undefined) throw fail.noPrincipal();
  return principal;
}

export function accountView(row: AccountDirectoryRow): {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRoleFilter;
  readonly status: AccountStatus;
  readonly createdAt: string;
  readonly claimedAt: string | null;
  readonly disabledAt: string | null;
} {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role === SITE_ADMINISTRATOR_ROLE ? "site-administrator" : "member",
    status: accountStatusOf(row),
    createdAt: row.createdAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
  };
}

function directoryWindow(query: {
  readonly page?: string | undefined;
  readonly pageSize?: string | undefined;
}): { readonly page: number; readonly pageSize: number } {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 50 : Math.min(Number(query.pageSize), 200);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) throw fail.badWindow();
  if (!Number.isInteger(pageSize) || pageSize < 1) throw fail.badWindow();
  return { page, pageSize };
}

export function makeListAccountsHandler(
  deps: Deps,
): RouteHandler<typeof listAccountsRoute, ApiEnv> {
  return async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = directoryWindow(query);
    const { rows, total } = await listAccountDirectory(deps.databases.control, {
      ...(query.q === undefined ? {} : { search: query.q }),
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return c.json({ accounts: rows.map(accountView), page, pageSize, total }, 200);
  };
}

export function makeCreateAccountHandler(
  deps: Deps,
): RouteHandler<typeof createAccountRoute, ApiEnv> {
  return async (c) => {
    const actor = principalOf(c);
    const body = c.req.valid("json");
    if (!deps.mailer.configured) throw fail.mailNotConfigured();

    const exec = deps.databases.control;
    const email = body.email.trim().toLowerCase();
    // Case-insensitive, because the unique index on the address is not: two rows that are
    // one address to an operator must never both exist.
    if ((await findAdminsByEmail(exec, email)).length > 0) throw fail.addressTaken();

    const created = await createUnclaimedAccount(adminAuthFor(deps), {
      email,
      name: body.name ?? email,
    });
    // The account is written before the link transaction; the audit row commits with the link.
    const delivery = await issueAndSendSignInLink(
      deps,
      exec,
      {
        userId: created.userId,
        email: created.email,
        purpose: "account-created",
        issuedBy: actor.userId,
      },
      (tx) =>
        writeSiteAuditRow(tx, {
          actor: actor.userId,
          subject: created.userId,
          kind: "account",
          detail: "act=create",
          occurredAt: deps.clock.now(),
        }),
    );

    const row = await findAccountById(exec, created.userId);
    if (row === undefined) throw fail.notFound();
    return c.json({ account: accountView(row), delivery }, 201);
  };
}

export function makeResendSignInLinkHandler(
  deps: Deps,
): RouteHandler<typeof resendSignInLinkRoute, ApiEnv> {
  return async (c) => {
    const actor = principalOf(c);
    const { id } = c.req.valid("param");
    if (!deps.mailer.configured) throw fail.mailNotConfigured();

    const exec = deps.databases.control;
    const row = await findAccountById(exec, id);
    if (row === undefined) throw fail.notFound();

    // A reset or reactivation link is resent as one, never as a creation link: the purposes
    // are not interchangeable, and it keeps the issuer of the link it replaces, the act's
    // performer, so resending never makes the resender a performer. The state and the purpose
    // are read under the account's lock, so a resend crossing the claim's or a reset's commit
    // never leaves the wrong link.
    const pendingAct = async (tx: Executor) => {
      const newest = await newestSignInLink(tx, id);
      const purpose = newest?.purpose;
      return newest !== undefined && (purpose === "reset" || purpose === "reactivated")
        ? { purpose, issuedBy: newest.issuedBy }
        : undefined;
    };
    const delivery = await issueAndSendSignInLink(
      deps,
      exec,
      {
        userId: row.userId,
        email: row.email,
        purpose: async (tx) => (await pendingAct(tx))?.purpose ?? "account-created",
        issuedBy: async (tx) => (await pendingAct(tx))?.issuedBy ?? actor.userId,
      },
      async (tx) => {
        const current = await findAccountById(tx, id);
        if (current === undefined) throw fail.notFound();
        const status = accountStatusOf(current);
        if (status === "disabled") throw fail.disabled();
        if (status === "active") throw fail.alreadyClaimed();
        await writeSiteAuditRow(tx, {
          actor: actor.userId,
          subject: row.userId,
          kind: "account",
          detail: "act=resend",
          occurredAt: deps.clock.now(),
        });
      },
    );
    return c.json({ delivery }, 200);
  };
}
