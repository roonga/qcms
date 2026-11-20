import { cache } from "react";

import {
  accountDirectoryQuery,
  parseAccountStatus,
  type Account,
  type AccountFilters,
  type AccountHoldings,
  type AccountPage,
  type HeldGroup,
  type ResetChoice,
} from "../site/accounts.ts";

import { adminApiFetch } from "./api.ts";
import { readResult, type ApiResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function parseAccount(value: unknown): Account {
  const row = record(value);
  return {
    userId: str(row["userId"]),
    email: str(row["email"]),
    name: str(row["name"]),
    siteAdministrator: row["role"] === "site-administrator",
    status: parseAccountStatus(row["status"]),
  };
}

function parseGroup(row: Record<string, unknown>): HeldGroup {
  return {
    workspaceId: str(row["workspaceId"]),
    workspaceName: str(row["workspaceName"]),
    groupId: str(row["groupId"]),
    groupName: str(row["groupName"]),
    roles: strings(row["roles"]),
    environments: strings(row["environments"]),
    suspended: row["suspended"] === true,
  };
}

function accountPath(userId: string, act = ""): `/${string}` {
  return `/accounts/${encodeURIComponent(userId)}${act}`;
}

export async function listAccounts(
  session: AdminSession,
  filters: AccountFilters,
): Promise<ApiResult<AccountPage>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/accounts${accountDirectoryQuery(filters)}`),
  );
  if (!result.ok) return result;
  const num = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);
  return {
    ok: true,
    data: {
      accounts: rows(result.data["accounts"]).map(parseAccount),
      page: num(result.data["page"], filters.page),
      pageSize: num(result.data["pageSize"], 1),
      total: num(result.data["total"], 0),
    },
  };
}

/** Active, claimed Site administrators, the count every Site administrator guard reads. */
export async function countActiveSiteAdministrators(
  session: AdminSession,
): Promise<ApiResult<number>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, "/accounts?role=site-administrator&status=active&pageSize=1"),
  );
  if (!result.ok) return result;
  const total = result.data["total"];
  return { ok: true, data: typeof total === "number" ? total : 0 };
}

/** Shared by the account page and its rail within one request. */
export const readAccount: (session: AdminSession, userId: string) => Promise<ApiResult<Account>> =
  cache(async (session: AdminSession, userId: string): Promise<ApiResult<Account>> => {
    const result = await readResult<Record<string, unknown>>(
      await adminApiFetch(session, accountPath(userId)),
    );
    if (!result.ok) return result;
    return { ok: true, data: parseAccount(result.data["account"]) };
  });

export async function readHoldings(
  session: AdminSession,
  userId: string,
): Promise<ApiResult<AccountHoldings>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, accountPath(userId, "/holdings")),
  );
  if (!result.ok) return result;
  const holdings = record(result.data["holdings"]);
  return {
    ok: true,
    data: {
      groups: rows(holdings["groups"]).map(parseGroup),
      administratorOf: rows(holdings["administratorOf"]).map((row) => ({
        workspaceId: str(row["workspaceId"]),
        workspaceName: str(row["workspaceName"]),
        last: row["last"] === true,
      })),
    },
  };
}

export type Delivery = "sent" | "undeliverable";

function delivery(value: unknown): Delivery {
  return value === "sent" ? "sent" : "undeliverable";
}

export async function createAccount(
  session: AdminSession,
  body: { readonly email: string; readonly name?: string },
): Promise<ApiResult<{ readonly account: Account; readonly delivery: Delivery }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, "/accounts", { method: "POST", body }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      account: parseAccount(result.data["account"]),
      delivery: delivery(result.data["delivery"]),
    },
  };
}

export async function resendSignInLink(
  session: AdminSession,
  userId: string,
): Promise<ApiResult<Delivery>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, accountPath(userId, "/sign-in-link"), {
      method: "POST",
      body: {},
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: delivery(result.data["delivery"]) };
}

/** Applied at once, or held as a site approval request. */
export type ActOutcome =
  { readonly held: false; readonly delivery?: Delivery } | { readonly held: true };

async function act(
  session: AdminSession,
  path: `/${string}`,
  body: unknown,
): Promise<ApiResult<ActOutcome>> {
  const response = await adminApiFetch(session, path, { method: "POST", body });
  const result = await readResult<Record<string, unknown>>(response);
  if (!result.ok) return result;
  if (response.status === 202) return { ok: true, data: { held: true } };
  const sent = result.data["delivery"];
  return {
    ok: true,
    data: sent === undefined ? { held: false } : { held: false, delivery: delivery(sent) },
  };
}

export function disableAccount(session: AdminSession, userId: string) {
  return act(session, accountPath(userId, "/disable"), {});
}

export function reactivateAccount(session: AdminSession, userId: string) {
  return act(session, accountPath(userId, "/reactivate"), {});
}

export function promoteAccount(session: AdminSession, userId: string) {
  return act(session, accountPath(userId, "/promote"), {});
}

export function demoteAccount(session: AdminSession, userId: string) {
  return act(session, accountPath(userId, "/demote"), {});
}

export function resetAccount(session: AdminSession, userId: string, choice: ResetChoice) {
  return act(session, accountPath(userId, "/reset"), {
    password: choice === "password",
    factor: choice === "factor",
  });
}

/** Binds a five-minute step-up to this session. The password never leaves this request. */
export async function stepUp(
  session: AdminSession,
  credentials: { readonly password: string; readonly code: string },
): Promise<ApiResult<null>> {
  const result = await readResult<unknown>(
    await adminApiFetch(session, "/step-up", { method: "POST", body: credentials }),
  );
  return result.ok ? { ok: true, data: null } : result;
}
