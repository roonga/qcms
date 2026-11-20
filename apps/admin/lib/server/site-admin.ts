import type { Account } from "../site/accounts.ts";
import {
  APPROVAL_PAGE_SIZE,
  approvalRequestsQuery,
  type ApprovalFilters,
  type SiteApprovalPage,
  type SiteApprovalRequest,
} from "../site/approvals.ts";
import { siteAuditQuery, type SiteAuditFilters, type SiteAuditPage } from "../site/audit.ts";
import type { StarterGroup } from "../site/workspaces.ts";
import { APPROVAL_STATUSES, type ApprovalStatus } from "../membership/types.ts";

import { parseAccount } from "./accounts.ts";
import { adminApiFetch } from "./api.ts";
import { readResult, type ApiResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** The API caps one directory page at this many. */
const DIRECTORY_PAGE_MAX = 200;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function directory(
  session: AdminSession,
  query: Record<string, string>,
): Promise<ApiResult<readonly Account[]>> {
  const params = new URLSearchParams(query);
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/accounts?${params.toString()}`),
  );
  if (!result.ok) return result;
  return { ok: true, data: rows(result.data["accounts"]).map(parseAccount) };
}

/** Every Site administrator, by name. */
export function listSiteAdministrators(
  session: AdminSession,
): Promise<ApiResult<readonly Account[]>> {
  return directory(session, {
    role: "site-administrator",
    pageSize: String(DIRECTORY_PAGE_MAX),
  });
}

/** The accounts a promote search matches, Site administrators among them. */
export function searchAccounts(
  session: AdminSession,
  search: string,
  limit: number,
): Promise<ApiResult<readonly Account[]>> {
  return directory(session, { q: search, pageSize: String(limit) });
}

function approvalStatus(value: unknown): ApprovalStatus {
  return APPROVAL_STATUSES.find((status) => status === value) ?? "pending";
}

function parseRequest(row: Record<string, unknown>): SiteApprovalRequest {
  return {
    requestId: str(row["requestId"]),
    scope: row["scope"] === "workspace" ? "workspace" : "site",
    workspaceId: strOrNull(row["workspaceId"]),
    kind: str(row["kind"]),
    target: str(row["target"]),
    payload: record(row["payload"]),
    requestedBy: str(row["requestedBy"]),
    requestedAt: str(row["requestedAt"]),
    expiresAt: str(row["expiresAt"]),
    status: approvalStatus(row["status"]),
    decidedBy: strOrNull(row["decidedBy"]),
    decidedAt: strOrNull(row["decidedAt"]),
  };
}

/** Site and workspace requests, newest first; a held publish is decided on its form, so the API leaves it out. */
export async function listApprovalRequests(
  session: AdminSession,
  filters: ApprovalFilters,
): Promise<ApiResult<SiteApprovalPage>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/approval-requests${approvalRequestsQuery(filters)}`),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      requests: rows(result.data["requests"]).map(parseRequest),
      page: num(result.data["page"], filters.page),
      pageSize: APPROVAL_PAGE_SIZE,
      total: num(result.data["total"], 0),
    },
  };
}

/** Decide a site request. Approving one needs a step-up on this session first. */
export async function decideSiteRequest(
  session: AdminSession,
  requestId: string,
  decision: "approve" | "reject",
): Promise<ApiResult<SiteApprovalRequest>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/approval-requests/${encodeURIComponent(requestId)}/${decision}`,
      { method: "POST", body: {} },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseRequest(record(result.data["request"])) };
}

export async function readSiteAudit(
  session: AdminSession,
  filters: SiteAuditFilters,
): Promise<ApiResult<SiteAuditPage>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/site-audit${siteAuditQuery(filters)}`),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      rows: rows(result.data["rows"]).map((row) => ({
        id: str(row["id"]),
        actor: str(row["actor"]),
        actorEmail: strOrNull(row["actorEmail"]),
        subject: strOrNull(row["subject"]),
        workspaceId: strOrNull(row["workspaceId"]),
        kind: str(row["kind"]),
        occurredAt: str(row["occurredAt"]),
        detail: strOrNull(row["detail"]),
      })),
      page: num(result.data["page"], filters.page),
      pageSize: num(result.data["pageSize"], 1),
      total: num(result.data["total"], 0),
    },
  };
}

export interface CreatedWorkspace {
  readonly workspaceId: string;
  readonly name: string;
}

export async function createWorkspace(
  session: AdminSession,
  body: { readonly name: string; readonly slug: string; readonly firstAdministratorEmail?: string },
): Promise<ApiResult<CreatedWorkspace>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, "/workspaces", { method: "POST", body }),
  );
  if (!result.ok) return result;
  const workspace = record(result.data["workspace"]);
  return {
    ok: true,
    data: { workspaceId: str(workspace["workspaceId"]), name: str(workspace["name"]) },
  };
}

/** A new workspace's groups, which are its four starter groups. */
export async function readStarterGroups(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<readonly StarterGroup[]>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/access-groups`),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data["groups"]).map((group) => ({
      name: str(group["name"]),
      roles: strings(group["roles"]),
      environments: strings(group["environments"]),
    })),
  };
}
