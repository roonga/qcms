import { z } from "zod";

import {
  findAdminById,
  listAccessAudit,
  listAccessGroups,
  listWorkspaceMembers,
  listWorkspaces,
} from "@roonga/qcms-db";

import { ApiError } from "../../../errors.js";
import { resolveCallerWorkspaces } from "../../membership/resolver.js";
import {
  FACT_ROW_LIMIT,
  Instant,
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
  role: z.string(),
  environments: z.array(z.string()),
  forms: z.array(z.string()),
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
      role: grant.role,
      environments: [...grant.environments],
      forms: [...grant.forms],
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
      role: z.string(),
      environments: z.array(z.string()),
      forms: z.array(z.string()),
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
      role: group.role,
      environments: [...group.environments],
      forms: [...group.forms],
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

export const administrationContexts = {
  workspaces: { facts: workspacesFacts, build: buildWorkspaces },
  workspaceDetail: { facts: workspaceDetailFacts, build: buildWorkspaceDetail },
  myAccess: { facts: myAccessFacts, build: buildMyAccess },
  settings: { facts: settingsFacts, build: buildSettings },
} as const;
