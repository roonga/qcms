import { and, asc, count, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { authUser } from "../schema/index.js";
import { SITE_ADMINISTRATOR_ROLE } from "./auth.js";
import type { Executor } from "./executor.js";

// The account directory. Only a Site administrator reaches the route that reads it
// (`docs/WORKSPACE_ACCESS.md`, section 7), and no helper here returns a credential.

/** What the directory filters on. `member` is every account that is not a Site administrator. */
export type AccountRoleFilter = "site-administrator" | "member";

/** Derived from the two timestamps, never stored: an account is in exactly one of these. */
export type AccountStatus = "active" | "unclaimed" | "disabled";

/** One account as the directory lists it. */
export interface AccountDirectoryRow {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  /** {@link SITE_ADMINISTRATOR_ROLE} for a Site administrator, otherwise `null`. */
  readonly role: string | null;
  readonly disabledAt: Date | null;
  readonly claimedAt: Date | null;
  readonly createdAt: Date;
}

export interface AccountDirectoryQuery {
  /** Matched case-insensitively against the address and the name. */
  readonly search?: string | undefined;
  readonly role?: AccountRoleFilter | undefined;
  readonly status?: AccountStatus | undefined;
  readonly limit: number;
  readonly offset: number;
}

/** Disabled wins over unclaimed, so the three statuses stay mutually exclusive. */
export function accountStatusOf(row: {
  readonly disabledAt: Date | null;
  readonly claimedAt: Date | null;
}): AccountStatus {
  if (row.disabledAt !== null) return "disabled";
  return row.claimedAt === null ? "unclaimed" : "active";
}

const columns = {
  userId: authUser.id,
  email: authUser.email,
  name: authUser.name,
  role: authUser.role,
  disabledAt: authUser.disabledAt,
  claimedAt: authUser.claimedAt,
  createdAt: authUser.createdAt,
} as const;

function statusCondition(status: AccountStatus): SQL | undefined {
  if (status === "disabled") return isNotNull(authUser.disabledAt);
  if (status === "unclaimed") {
    return and(isNull(authUser.disabledAt), isNull(authUser.claimedAt));
  }
  return and(isNull(authUser.disabledAt), isNotNull(authUser.claimedAt));
}

function roleCondition(role: AccountRoleFilter): SQL | undefined {
  if (role === "site-administrator") return eq(authUser.role, SITE_ADMINISTRATOR_ROLE);
  return or(isNull(authUser.role), ne(authUser.role, SITE_ADMINISTRATOR_ROLE));
}

function directoryWhere(query: AccountDirectoryQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  const search = query.search?.trim();
  if (search !== undefined && search !== "") {
    // Escaped before interpolation: an address holding `%` would otherwise widen the match.
    const pattern = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(
      or(sql`${authUser.email} ilike ${pattern}`, sql`${authUser.name} ilike ${pattern}`),
    );
  }
  if (query.role !== undefined) conditions.push(roleCondition(query.role));
  if (query.status !== undefined) conditions.push(statusCondition(query.status));
  return conditions.length === 0 ? undefined : and(...conditions);
}

/** One page of the account directory, ordered by address so paging is stable. */
export async function listAccountDirectory(
  exec: Executor,
  query: AccountDirectoryQuery,
): Promise<{ readonly rows: readonly AccountDirectoryRow[]; readonly total: number }> {
  const where = directoryWhere(query);
  const rows = await exec
    .select(columns)
    .from(authUser)
    .where(where)
    .orderBy(asc(authUser.email))
    .limit(query.limit)
    .offset(query.offset);
  const [counted] = await exec.select({ total: count() }).from(authUser).where(where);
  return { rows, total: counted?.total ?? 0 };
}

/** One account by id, with the state the Accounts screen reports. */
/** Display names by account id, and nothing else about the accounts. A blank name is left out. */
export async function listDisplayNames(
  exec: Executor,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await exec
    .select({ userId: authUser.id, name: authUser.name })
    .from(authUser)
    .where(inArray(authUser.id, ids));
  return new Map(
    rows.flatMap((row) => (row.name.trim() === "" ? [] : [[row.userId, row.name] as const])),
  );
}

export async function findAccountById(
  exec: Executor,
  userId: string,
): Promise<AccountDirectoryRow | undefined> {
  const [row] = await exec.select(columns).from(authUser).where(eq(authUser.id, userId)).limit(1);
  return row;
}
