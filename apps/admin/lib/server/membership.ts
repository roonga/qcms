import { cache } from "react";

import type {
  AccessGroup,
  AccessGroupList,
  MemberStatus,
  AgentAuditPage,
  AgentAuditRow,
  ApprovalRequest,
  ApprovalRequestPage,
  ApprovalStatus,
  AuditPage,
  AuditRow,
  MyAccess,
  WorkspaceListItem,
  WorkspaceMember,
  WorkspaceSettings,
} from "../membership/types.ts";
import { APPROVAL_STATUSES } from "../membership/types.ts";
import type { ShellCapabilities } from "../shell/modes.ts";

import { APPROVAL_REQUESTED } from "../membership/refusals.ts";

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

const MEMBER_STATUSES: readonly MemberStatus[] = ["active", "unclaimed", "disabled"];

// An unknown or absent status reads as active: the API still refuses whatever the account cannot do.
function memberStatus(value: unknown): MemberStatus {
  return MEMBER_STATUSES.find((status) => status === value) ?? "active";
}

/** A 202 is a held request, not the change itself, so it is never read as the act's success. */
async function readHeldOrResult<T>(response: Response): Promise<ApiResult<T>> {
  if (response.status === 202) {
    return { ok: false, code: APPROVAL_REQUESTED, message: "", issues: [] };
  }
  return readResult<T>(response);
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
        archivedAt: strOrNull(row["archivedAt"]),
        // Absent where the caller administers nothing in that workspace, so read as
        // undefined rather than coerced to a value nobody sent.
        isShared: typeof row["isShared"] === "boolean" ? row["isShared"] : undefined,
        requireSecondApprover:
          typeof row["requireSecondApprover"] === "boolean"
            ? row["requireSecondApprover"]
            : undefined,
        forms: typeof row["forms"] === "number" ? row["forms"] : undefined,
        questions: typeof row["questions"] === "number" ? row["questions"] : undefined,
      })),
    };
  },
);

/** Shared by the page and its rail within one request. */
export const listMembers: (
  session: AdminSession,
  workspaceId: string,
) => Promise<ApiResult<readonly WorkspaceMember[]>> = cache(fetchMembers);

async function fetchMembers(
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
      status: memberStatus(row["status"]),
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
      suspended: bool(holder["suspended"]),
    })),
  };
}

/** Shared by the page and its rail within one request. */
export const listAccessGroups: (
  session: AdminSession,
  workspaceId: string,
) => Promise<ApiResult<AccessGroupList>> = cache(fetchAccessGroups);

async function fetchAccessGroups(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<AccessGroupList>> {
  const result = await readResult<{ groups?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/access-groups`),
  );
  if (!result.ok) return result;
  return { ok: true, data: { workspaceId, groups: rows(result.data.groups).map(parseGroup) } };
}

function groupOf(value: unknown): AccessGroup {
  return parseGroup(
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {},
  );
}

export async function updateAccessGroup(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  body: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
): Promise<ApiResult<AccessGroup>> {
  const result = await readHeldOrResult<{ group?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}`,
      { method: "PUT", body },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: groupOf(result.data.group) };
}

export async function reconfirmHolder(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  userId: string,
): Promise<ApiResult<AccessGroup>> {
  const result = await readResult<{ group?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}/holders/${encodeURIComponent(userId)}/reconfirm`,
      { method: "POST" },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: groupOf(result.data.group) };
}

export async function removeMember(
  session: AdminSession,
  workspaceId: string,
  userId: string,
): Promise<ApiResult<null>> {
  return readNoContent(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  );
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
  const result = await readHeldOrResult<{ group?: unknown }>(
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

/** What a settings write answers with: the switch as it now stands, and the request a hold waits on. */
export interface WorkspaceSettingsOutcome {
  readonly workspaceId: string;
  readonly requireSecondApprover: boolean;
  readonly request: ApprovalRequest | undefined;
}

export async function setWorkspaceSettings(
  session: AdminSession,
  workspaceId: string,
  body: { readonly requireSecondApprover: boolean },
  proposal?: AgentProposalRef,
): Promise<ApiResult<WorkspaceSettingsOutcome>> {
  const result = await readResult<{
    workspaceId?: unknown;
    requireSecondApprover?: unknown;
    request?: unknown;
  }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
      method: "PUT",
      body,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  const held = result.data.request;
  return {
    ok: true,
    data: {
      workspaceId: str(result.data.workspaceId),
      requireSecondApprover: bool(result.data.requireSecondApprover),
      request:
        typeof held === "object" && held !== null
          ? parseApprovalRequest(held as Record<string, unknown>)
          : undefined,
    },
  };
}

function approvalStatus(value: unknown): ApprovalStatus {
  const found = APPROVAL_STATUSES.find((entry) => entry === value);
  // An unfamiliar status is read as pending's opposite: never offer a decision on a row the
  // API did not call pending.
  return found ?? "expired";
}

function parseApprovalRequest(row: Record<string, unknown>): ApprovalRequest {
  const payload = row["payload"];
  return {
    requestId: str(row["requestId"]),
    kind: str(row["kind"]),
    target: str(row["target"]),
    payload:
      typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {},
    requestedBy: str(row["requestedBy"]),
    requestedAt: str(row["requestedAt"]),
    expiresAt: str(row["expiresAt"]),
    status: approvalStatus(row["status"]),
    decidedBy: strOrNull(row["decidedBy"]),
    decidedAt: strOrNull(row["decidedAt"]),
  };
}

/** The switch, and whether anybody other than the caller could approve under it. */
export async function readWorkspaceSettings(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<WorkspaceSettings>> {
  const result = await readResult<{
    workspaceId?: unknown;
    requireSecondApprover?: unknown;
    nobodyElseCouldApprove?: unknown;
    missingApprover?: unknown;
  }>(await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/settings`));
  if (!result.ok) return result;
  const missing = result.data.missingApprover;
  const shortfall =
    typeof missing === "object" && missing !== null ? (missing as Record<string, unknown>) : {};
  return {
    ok: true,
    data: {
      workspaceId: str(result.data.workspaceId),
      requireSecondApprover: bool(result.data.requireSecondApprover),
      nobodyElseCouldApprove: bool(result.data.nobodyElseCouldApprove),
      missingApprover: {
        administrator: bool(shortfall["administrator"]),
        publisher: bool(shortfall["publisher"]),
      },
    },
  };
}

/** The Requests row: this workspace's held acts. A held publish is decided on its form, so the API leaves it out. */
export async function listWorkspaceRequests(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<ApprovalRequestPage>> {
  const result = await readResult<{
    requests?: unknown;
    page?: unknown;
    total?: unknown;
  }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/approval-requests`,
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      workspaceId,
      requests: rows(result.data.requests).map(parseApprovalRequest),
      page: num(result.data.page),
      total: num(result.data.total),
    },
  };
}

async function decideWorkspaceRequest(
  session: AdminSession,
  workspaceId: string,
  requestId: string,
  decision: "approve" | "reject",
): Promise<ApiResult<ApprovalRequest>> {
  const result = await readResult<{ request?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/approval-requests/${encodeURIComponent(requestId)}/${decision}`,
      { method: "POST" },
    ),
  );
  if (!result.ok) return result;
  const request = result.data.request;
  return {
    ok: true,
    data: parseApprovalRequest(
      typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {},
    ),
  };
}

export function approveWorkspaceRequest(
  session: AdminSession,
  workspaceId: string,
  requestId: string,
): Promise<ApiResult<ApprovalRequest>> {
  return decideWorkspaceRequest(session, workspaceId, requestId, "approve");
}

export function rejectWorkspaceRequest(
  session: AdminSession,
  workspaceId: string,
  requestId: string,
): Promise<ApiResult<ApprovalRequest>> {
  return decideWorkspaceRequest(session, workspaceId, requestId, "reject");
}

function parseWorkspace(value: unknown): WorkspaceListItem {
  const row = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    workspaceId: str(row["workspaceId"]),
    name: str(row["name"]),
    slug: str(row["slug"]),
    archivedAt: strOrNull(row["archivedAt"]),
    isShared: typeof row["isShared"] === "boolean" ? row["isShared"] : undefined,
    requireSecondApprover:
      typeof row["requireSecondApprover"] === "boolean" ? row["requireSecondApprover"] : undefined,
    forms: typeof row["forms"] === "number" ? row["forms"] : undefined,
    questions: typeof row["questions"] === "number" ? row["questions"] : undefined,
  };
}

/** The name only: the slug is the stored identifier and never changes. */
export async function renameWorkspace(
  session: AdminSession,
  workspaceId: string,
  name: string,
): Promise<ApiResult<WorkspaceListItem>> {
  const result = await readResult<{ workspace?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/name`, {
      method: "PUT",
      body: { name },
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseWorkspace(result.data.workspace) };
}

export async function archiveWorkspace(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<WorkspaceListItem>> {
  const result = await readResult<{ workspace?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/archive`, {
      method: "POST",
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseWorkspace(result.data.workspace) };
}

export async function readAudit(
  session: AdminSession,
  workspaceId: string,
  options: { readonly kind?: string; readonly actor?: string; readonly page?: number } = {},
): Promise<ApiResult<AuditPage>> {
  const query = new URLSearchParams();
  if (options.kind !== undefined) query.set("kind", options.kind);
  if (options.actor !== undefined) query.set("actor", options.actor);
  if (options.page !== undefined) query.set("page", String(options.page));
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const result = await readResult<{
    rows?: unknown;
    page?: unknown;
    pageSize?: unknown;
    total?: unknown;
    actors?: unknown;
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
      actors: rows(result.data.actors).map((row) => ({
        actor: str(row["actor"]),
        actorEmail: strOrNull(row["actorEmail"]),
      })),
    },
  };
}

/** One audit page, shared between the screen and the rail that filters it within a request. */
export const readAuditPage: (
  session: AdminSession,
  workspaceId: string,
  kind: string | undefined,
  actor: string | undefined,
  page: number,
) => Promise<ApiResult<AuditPage>> = cache(
  async (
    session: AdminSession,
    workspaceId: string,
    kind: string | undefined,
    actor: string | undefined,
    page: number,
  ): Promise<ApiResult<AuditPage>> =>
    readAudit(session, workspaceId, {
      ...(kind === undefined ? {} : { kind }),
      ...(actor === undefined ? {} : { actor }),
      page,
    }),
);

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
      siteAdministrators?: unknown;
      multipleWorkspaces?: unknown;
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
        siteAdministrators: rows(result.data.siteAdministrators).map((row) => ({
          name: str(row["name"]),
          email: str(row["email"]),
        })),
        multipleWorkspaces: bool(result.data.multipleWorkspaces),
      },
    };
  },
);
