import { cache } from "react";

import type {
  AccessGroup,
  AccessGroupList,
  AgentAuditPage,
  AgentAuditRow,
  AuditPage,
  AuditRow,
  MyAccess,
  WorkspaceListItem,
  WorkspaceMember,
  WorkspaceSettings,
} from "../membership/types.ts";
import type { ShellCapabilities } from "../shell/modes.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readNoContent, readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** The API enforces grants even when UI controls remain visible. Render a refused read as refusal, never as an empty state claiming knowledge. */

function rows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Share this request-only read between the page and its rail. */
export const listWorkspaces: (
  session: AdminSession,
) => Promise<ApiResult<readonly WorkspaceListItem[]>> = cache(
  async (session: AdminSession): Promise<ApiResult<readonly WorkspaceListItem[]>> => {
    const result = await readResult<{ workspaces?: unknown }>(
      await adminApiFetch(session, "/workspaces"),
    );
    if (!result.ok) return result;
    return {
      ok: true,
      data: rows(result.data.workspaces).map((row) => ({
        workspaceId: str(row["workspaceId"]),
        name: str(row["name"]),
        slug: str(row["slug"]),
        isShared: bool(row["isShared"]),
        requireSecondApprover: bool(row["requireSecondApprover"]),
        archivedAt: strOrNull(row["archivedAt"]),
        forms: num(row["forms"]),
        questions: num(row["questions"]),
      })),
    };
  },
);

export async function listMembers(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<readonly WorkspaceMember[]>> {
  const result = await readResult<{ members?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/members`),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.members).map((row) => ({
      userId: str(row["userId"]),
      email: str(row["email"]),
      name: str(row["name"]),
      role: str(row["role"]),
      groups: strings(row["groups"]),
    })),
  };
}

function parseGroup(row: Record<string, unknown>): AccessGroup {
  return {
    teamId: str(row["teamId"]),
    name: str(row["name"]),
    roles: strings(row["roles"]),
    environments: strings(row["environments"]),
    externalGroupId: strOrNull(row["externalGroupId"]),
    holders: rows(row["holders"]).map((holder) => ({
      userId: str(holder["userId"]),
      email: str(holder["email"]),
    })),
  };
}

export async function listAccessGroups(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<AccessGroupList>> {
  const result = await readResult<{ groups?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/access-groups`),
  );
  if (!result.ok) return result;
  return { ok: true, data: { workspaceId, groups: rows(result.data.groups).map(parseGroup) } };
}

export async function createAccessGroup(
  session: AdminSession,
  workspaceId: string,
  body: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
  proposal?: AgentProposalRef,
): Promise<ApiResult<AccessGroup>> {
  const result = await readResult<{ group?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/access-groups`, {
      method: "POST",
      body,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  const group = result.data.group;
  return {
    ok: true,
    data: parseGroup(
      typeof group === "object" && group !== null ? (group as Record<string, unknown>) : {},
    ),
  };
}

export async function deleteAccessGroup(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<null>> {
  return readNoContent(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}`,
      { method: "DELETE", headers: proposalHeaders(proposal) },
    ),
  );
}

export async function addHolder(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  email: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<AccessGroup>> {
  const result = await readResult<{ group?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}/holders`,
      { method: "POST", body: { email }, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  const group = result.data.group;
  return {
    ok: true,
    data: parseGroup(
      typeof group === "object" && group !== null ? (group as Record<string, unknown>) : {},
    ),
  };
}

export async function removeHolder(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  userId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<null>> {
  return readNoContent(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}/holders/${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: proposalHeaders(proposal) },
    ),
  );
}

export async function setMemberRole(
  session: AdminSession,
  workspaceId: string,
  userId: string,
  role: "forms.owner" | "member",
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly userId: string; readonly role: string }>> {
  const result = await readResult<{ userId?: unknown; role?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "PUT", body: { role }, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: { userId: str(result.data.userId), role: str(result.data.role) } };
}

export async function setWorkspaceSettings(
  session: AdminSession,
  workspaceId: string,
  body: { readonly requireSecondApprover: boolean },
  proposal?: AgentProposalRef,
): Promise<ApiResult<WorkspaceSettings>> {
  const result = await readResult<{
    workspaceId?: unknown;
    requireSecondApprover?: unknown;
  }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
      method: "PUT",
      body,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      workspaceId: str(result.data.workspaceId),
      requireSecondApprover: bool(result.data.requireSecondApprover),
    },
  };
}

export async function readAudit(
  session: AdminSession,
  workspaceId: string,
  options: { readonly kind?: string; readonly page?: number } = {},
): Promise<ApiResult<AuditPage>> {
  const query = new URLSearchParams();
  if (options.kind !== undefined) query.set("kind", options.kind);
  if (options.page !== undefined) query.set("page", String(options.page));
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const result = await readResult<{
    rows?: unknown;
    page?: unknown;
    pageSize?: unknown;
    total?: unknown;
  }>(await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/audit${suffix}`));
  if (!result.ok) return result;
  const parsed: readonly AuditRow[] = rows(result.data.rows).map((row) => ({
    id: str(row["id"]),
    actor: str(row["actor"]),
    actorEmail: strOrNull(row["actorEmail"]),
    environment: strOrNull(row["environment"]),
    formId: strOrNull(row["formId"]),
    kind: str(row["kind"]),
    occurredAt: str(row["occurredAt"]),
    detail: strOrNull(row["detail"]),
  }));
  return {
    ok: true,
    data: {
      workspaceId,
      rows: parsed,
      page: num(result.data.page),
      pageSize: num(result.data.pageSize),
      total: num(result.data.total),
    },
  };
}

export async function readAgentAudit(
  session: AdminSession,
  workspaceId: string,
  options: { readonly kind?: string; readonly page?: number } = {},
): Promise<ApiResult<AgentAuditPage>> {
  const query = new URLSearchParams();
  if (options.kind !== undefined) query.set("kind", options.kind);
  if (options.page !== undefined) query.set("page", String(options.page));
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const path: `/${string}` = `/workspaces/${encodeURIComponent(workspaceId)}/agent-actions${suffix}`;
  const result = await readResult<{
    rows?: unknown;
    page?: unknown;
    pageSize?: unknown;
    total?: unknown;
  }>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  const parsed: readonly AgentAuditRow[] = rows(result.data.rows).map((row) => ({
    id: str(row["id"]),
    proposalId: str(row["proposalId"]),
    stepIndex: num(row["stepIndex"]),
    stepCount: num(row["stepCount"]),
    actor: str(row["actor"]),
    actorEmail: strOrNull(row["actorEmail"]),
    environment: strOrNull(row["environment"]),
    formId: strOrNull(row["formId"]),
    kind: str(row["kind"]),
    screen: str(row["screen"]),
    proposedAt: str(row["proposedAt"]),
    confirmedAt: str(row["confirmedAt"]),
    detail: strOrNull(row["detail"]),
  }));
  return {
    ok: true,
    data: {
      workspaceId,
      rows: parsed,
      page: num(result.data.page),
      pageSize: num(result.data.pageSize),
      total: num(result.data.total),
    },
  };
}

/** Absent capability fields narrow navigation rather than granting access the API did not report. */
function parseCapabilities(value: unknown): ShellCapabilities {
  const row = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    operations: bool(row["operations"]),
    workspaces: bool(row["workspaces"]),
    siteConfiguration: bool(row["siteConfiguration"]),
    authoring: bool(row["authoring"]),
  };
}

/** This read needs no grant because it discovers the caller grants; membership lists require authority of their own. */
export const readMyAccess: (session: AdminSession) => Promise<ApiResult<MyAccess>> = cache(
  async (session: AdminSession): Promise<ApiResult<MyAccess>> => {
    const result = await readResult<{
      userId?: unknown;
      installationAdmin?: unknown;
      capabilities?: unknown;
      workspaces?: unknown;
    }>(await adminApiFetch(session, "/me/access"));
    if (!result.ok) return result;
    return {
      ok: true,
      data: {
        userId: str(result.data.userId),
        installationAdmin: bool(result.data.installationAdmin),
        capabilities: parseCapabilities(result.data.capabilities),
        workspaces: rows(result.data.workspaces).map((row) => ({
          workspaceId: str(row["workspaceId"]),
          slug: str(row["slug"]),
          name: str(row["name"]),
          archived: bool(row["archived"]),
          memberRole: strOrNull(row["memberRole"]),
          grants: rows(row["grants"]).map((grant) => ({
            name: str(grant["name"]),
            roles: strings(grant["roles"]),
            environments: strings(grant["environments"]),
          })),
          environments: strings(row["environments"]),
        })),
      },
    };
  },
);
