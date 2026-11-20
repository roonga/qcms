import { z } from "zod";

import {
  accountStatusOf,
  findAccountById,
  findAdminById,
  listAccessAudit,
  listAccessGroups,
  listAccountDirectory,
  listWorkspaceMembers,
  listWorkspaces,
  SITE_ADMINISTRATOR_ROLE,
  type AccountDirectoryRow,
  type Executor,
} from "@roonga/qcms-db";

import { ApiError } from "../../../errors.js";
import { resolveCallerWorkspaces } from "../../membership/resolver.js";
import {
  FACT_ROW_LIMIT,
  Instant,
  fail,
  forbidden,
  iso,
  requireCell,
  requireWorkspaceId,
  type ScreenBuildInput,
} from "./support.js";

/**
 * The administration screens' facts: workspaces, members and the access audit, plus the
 * caller's own account.
 *
 * Staff names and emails may go to the provider; they are not respondent data (Q11).
 */

const GrantFact = z.strictObject({
  workspaceId: z.string(),
  roles: z.array(z.string()),
  environments: z.array(z.string()),
  name: z.string().nullable(),
});

export const workspacesFacts = z.strictObject({
  workspaces: z.array(
    z.strictObject({
      workspaceId: z.string(),
      name: z.string(),
      slug: z.string(),
      shared: z.boolean(),
      archived: z.boolean(),
      requireSecondApprover: z.boolean(),
    }),
  ),
  ownGrants: z.array(GrantFact),
});

async function ownGrants(input: ScreenBuildInput): Promise<z.infer<typeof GrantFact>[]> {
  const resolved = await resolveCallerWorkspaces(input.deps.databases.control, {
    userId: input.principal.userId,
    claim: input.principal.claim,
  });
  return resolved.flatMap((membership) =>
    membership.grants.slice(0, FACT_ROW_LIMIT).map((grant) => ({
      workspaceId: membership.workspaceId,
      roles: [...grant.roles],
      environments: [...grant.environments],
      name: grant.name ?? null,
    })),
  );
}

async function buildWorkspaces(input: ScreenBuildInput): Promise<z.infer<typeof workspacesFacts>> {
  const resolved = await resolveCallerWorkspaces(input.deps.databases.control, {
    userId: input.principal.userId,
    claim: input.principal.claim,
  });
  const administered = new Set<string>();
  for (const membership of resolved) {
    const decision = await requireCellSilently(input, membership.workspaceId);
    if (decision) administered.add(membership.workspaceId);
  }
  const rows = await listWorkspaces(input.deps.databases.control);
  return {
    workspaces: rows
      .filter((workspace) => administered.has(workspace.id))
      .slice(0, FACT_ROW_LIMIT)
      .map((workspace) => ({
        workspaceId: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        shared: workspace.isShared,
        archived: workspace.archivedAt !== null,
        requireSecondApprover: workspace.requireSecondApprover,
      })),
    ownGrants: await ownGrants(input),
  };
}

/** The screen lists what the caller administers, so a refusal narrows rather than throws. */
async function requireCellSilently(input: ScreenBuildInput, workspaceId: string): Promise<boolean> {
  try {
    await requireCell(input, { workspaceId, resource: "workspace", action: "read" });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  }
}

export const workspaceDetailFacts = z.strictObject({
  workspaceId: z.string(),
  name: z.string(),
  shared: z.boolean(),
  requireSecondApprover: z.boolean(),
  members: z.array(
    z.strictObject({
      userId: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.string(),
    }),
  ),
  accessGroups: z.array(
    z.strictObject({
      groupId: z.string(),
      name: z.string(),
      roles: z.array(z.string()),
      environments: z.array(z.string()),
    }),
  ),
  accessAudit: z.array(
    z.strictObject({
      kind: z.string(),
      actor: z.string(),
      environment: z.string().nullable(),
      formId: z.string().nullable(),
      occurredAt: Instant,
      detail: z.string().nullable(),
    }),
  ),
});

async function buildWorkspaceDetail(
  input: ScreenBuildInput,
): Promise<z.infer<typeof workspaceDetailFacts>> {
  const workspaceId = requireWorkspaceId(input);
  await requireCell(input, { workspaceId, resource: "membership", action: "read" });
  const exec = input.deps.databases.control;
  const [workspaces, members, groups, audit] = await Promise.all([
    listWorkspaces(exec),
    listWorkspaceMembers(exec, workspaceId),
    listAccessGroups(exec, workspaceId),
    listAccessAudit(exec, workspaceId, { limit: FACT_ROW_LIMIT }),
  ]);
  const workspace = workspaces.find((row) => row.id === workspaceId);
  if (workspace === undefined) {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace");
  }
  return {
    workspaceId,
    name: workspace.name,
    shared: workspace.isShared,
    requireSecondApprover: workspace.requireSecondApprover,
    members: members.slice(0, FACT_ROW_LIMIT).map((member) => ({
      userId: member.userId,
      email: member.email,
      name: member.name,
      role: member.role,
    })),
    accessGroups: groups.slice(0, FACT_ROW_LIMIT).map((group) => ({
      groupId: group.teamId,
      name: group.name,
      roles: [...group.roles],
      environments: [...group.environments],
    })),
    accessAudit: audit.rows.slice(0, FACT_ROW_LIMIT).map((row) => ({
      kind: row.kind,
      actor: row.actor,
      environment: row.environment,
      formId: row.formId,
      occurredAt: iso(row.occurredAt),
      detail: row.detail,
    })),
  };
}

export const myAccessFacts = z.strictObject({
  environment: z.string(),
  installationAdministrator: z.boolean(),
  grants: z.array(GrantFact),
});

async function buildMyAccess(input: ScreenBuildInput): Promise<z.infer<typeof myAccessFacts>> {
  return {
    environment: input.environment,
    installationAdministrator: input.principal.claim,
    grants: await ownGrants(input),
  };
}

export const settingsFacts = z.strictObject({
  email: z.string(),
  name: z.string(),
  twoFactorEnabled: z.boolean(),
});

async function buildSettings(input: ScreenBuildInput): Promise<z.infer<typeof settingsFacts>> {
  const account = await findAdminById(input.deps.databases.control, input.principal.userId);
  if (account === undefined) {
    throw new ApiError("NOT_FOUND", 404, "This account could not be read");
  }
  return {
    email: account.email,
    name: account.name,
    twoFactorEnabled: account.twoFactorEnabled,
  };
}

const AccountFact = z.strictObject({
  accountId: z.string(),
  email: z.string(),
  name: z.string(),
  siteAdministrator: z.boolean(),
  status: z.string(),
  createdAt: Instant,
  claimedAt: Instant,
  disabledAt: Instant,
});

export const siteAccountsFacts = z.strictObject({
  accounts: z.array(AccountFact),
  total: z.number(),
  /** The account the detail route names, and `null` on the two screens that name none. */
  account: AccountFact.nullable(),
});

function accountFact(row: AccountDirectoryRow): z.infer<typeof AccountFact> {
  return {
    accountId: row.userId,
    email: row.email,
    name: row.name,
    siteAdministrator: row.role === SITE_ADMINISTRATOR_ROLE,
    status: accountStatusOf(row),
    createdAt: iso(row.createdAt),
    claimedAt: iso(row.claimedAt),
    disabledAt: iso(row.disabledAt),
  };
}

async function namedAccount(
  exec: Executor,
  accountId: string | undefined,
): Promise<AccountDirectoryRow | undefined> {
  if (accountId === undefined || accountId === "") return undefined;
  const row = await findAccountById(exec, accountId);
  if (row === undefined) throw new ApiError("ACCOUNT_NOT_FOUND", 404, "No such account");
  return row;
}

/** The installation claim alone, as `features/membership/route-policy.ts` gives the account routes: no workspace grant reaches Site configuration. */
async function siteAccountsFor(
  input: ScreenBuildInput,
  accountId: string | undefined,
): Promise<z.infer<typeof siteAccountsFacts>> {
  if (!input.principal.claim) throw forbidden("Site configuration is for Site administrators");
  const exec = input.deps.databases.control;
  const [directory, named] = await Promise.all([
    listAccountDirectory(exec, { limit: FACT_ROW_LIMIT, offset: 0 }),
    namedAccount(exec, accountId),
  ]);
  return {
    accounts: directory.rows.map(accountFact),
    total: directory.total,
    account: named === undefined ? null : accountFact(named),
  };
}

function buildSiteAccounts(input: ScreenBuildInput): Promise<z.infer<typeof siteAccountsFacts>> {
  return siteAccountsFor(input, undefined);
}

async function buildSiteAccountDetail(
  input: ScreenBuildInput,
): Promise<z.infer<typeof siteAccountsFacts>> {
  if (!input.principal.claim) throw forbidden("Site configuration is for Site administrators");
  const accountId = input.params.accountId;
  if (accountId === undefined || accountId === "") throw fail.missing("account");
  return siteAccountsFor(input, accountId);
}

export const administrationContexts = {
  workspaces: { facts: workspacesFacts, build: buildWorkspaces },
  siteAccounts: { facts: siteAccountsFacts, build: buildSiteAccounts },
  siteAccountDetail: { facts: siteAccountsFacts, build: buildSiteAccountDetail },
  workspaceDetail: { facts: workspaceDetailFacts, build: buildWorkspaceDetail },
  myAccess: { facts: myAccessFacts, build: buildMyAccess },
  settings: { facts: settingsFacts, build: buildSettings },
} as const;
