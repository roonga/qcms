import { cache } from "react";

import type {
  AccessGroup,
  AccessGroupList,
  AuditPage,
  AuditRow,
  MyAccess,
  WorkspaceListItem,
  WorkspaceMember,
  WorkspaceSettings,
} from "../membership/types.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The membership screens' calls into the API's `/admin` group (ADR-41, task 069; R2).
 *
 * The same proxy every other admin area is: build a path, hand it to the one credentialed
 * client (`api.ts`), read the answer. **Nothing here decides who may do what.** The API's
 * grant middleware is the authority, and a refusal arrives as a 403 that the screens
 * render like any other refusal - which is the SEC-3 property that a UI that forgot to
 * hide a control still cannot perform the act (criterion 10).
 *
 * What the screens show is therefore shaped by what comes back rather than by a check this
 * app performs: a workspace the signed-in administrator does not administer is absent from
 * the list the API serves them, and a panel whose read was refused says so instead of
 * rendering an empty state that would claim knowledge it does not have.
 */

/** Narrow an unknown to an array of records, the shape every list answer carries. */
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

/**
 * `GET /admin/workspaces` - the workspaces the caller administers.
 *
 * `cache()` for the reason `getForm` carries one (issue #626, extended here by #1117): §7.0
 * gives both membership screens a rail, and a rail is a parallel-route slot - a separate
 * React tree rendered for the same request, which cannot be handed a value by the page beside
 * it. Both trees need this list (the list screen's rows and its rail's rows; the detail
 * screen's heading and its rail's Header both need the workspace's name), and this call takes
 * the session alone, so it memoizes cleanly and the two trees share one round trip. Without
 * it, adding the rails would have doubled the reads on both screens.
 *
 * It is also the only answer this area has that two trees share: every other call here is
 * workspace-scoped and read by the page alone.
 */
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
        seedNewEditorsWithTestData: bool(row["seedNewEditorsWithTestData"]),
        archivedAt: strOrNull(row["archivedAt"]),
        forms: num(row["forms"]),
        questions: num(row["questions"]),
      })),
    };
  },
);

/** `GET /admin/workspaces/{id}/members` - the membership list (owners and the claim only). */
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
    fullName: str(row["fullName"]),
    directoryName: str(row["directoryName"]),
    role: str(row["role"]),
    environments: strings(row["environments"]),
    forms: strings(row["forms"]),
    externalGroupId: strOrNull(row["externalGroupId"]),
    holders: rows(row["holders"]).map((holder) => ({
      userId: str(holder["userId"]),
      email: str(holder["email"]),
    })),
  };
}

/** `GET /admin/workspaces/{id}/access-groups` - one grant per row, with its holders. */
export async function listAccessGroups(
  session: AdminSession,
  workspaceId: string,
): Promise<ApiResult<AccessGroupList>> {
  const result = await readResult<{ groups?: unknown; scopeNote?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/access-groups`),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      workspaceId,
      groups: rows(result.data.groups).map(parseGroup),
      scopeNote: str(result.data.scopeNote),
    },
  };
}

/** `POST /admin/workspaces/{id}/access-groups` - create one grant's group. */
export async function createAccessGroup(
  session: AdminSession,
  workspaceId: string,
  body: {
    readonly name: string;
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
    readonly label?: string;
  },
): Promise<ApiResult<AccessGroup>> {
  const result = await readResult<{ group?: unknown }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/access-groups`, {
      method: "POST",
      body,
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

/** `DELETE /admin/workspaces/{id}/access-groups/{teamId}` - remove a group and its grants. */
export async function deleteAccessGroup(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
): Promise<ApiResult<null>> {
  return readResult<null>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}`,
      { method: "DELETE" },
    ),
  );
}

/** `POST .../holders` - grant the group to somebody, by address. */
export async function addHolder(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  email: string,
): Promise<ApiResult<AccessGroup>> {
  const result = await readResult<{ group?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}/holders`,
      { method: "POST", body: { email } },
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

/** `DELETE .../holders/{userId}` - revoke one grant. */
export async function removeHolder(
  session: AdminSession,
  workspaceId: string,
  teamId: string,
  userId: string,
): Promise<ApiResult<null>> {
  return readResult<null>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/access-groups/${encodeURIComponent(teamId)}/holders/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  );
}

/** `PUT /admin/workspaces/{id}/members/{userId}` - the member row's role. */
export async function setMemberRole(
  session: AdminSession,
  workspaceId: string,
  userId: string,
  role: "forms.owner" | "member",
): Promise<ApiResult<{ readonly userId: string; readonly role: string }>> {
  const result = await readResult<{ userId?: unknown; role?: unknown }>(
    await adminApiFetch(
      session,
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "PUT", body: { role } },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: { userId: str(result.data.userId), role: str(result.data.role) } };
}

/** `PUT /admin/workspaces/{id}/settings` - the two per-workspace switches. */
export async function setWorkspaceSettings(
  session: AdminSession,
  workspaceId: string,
  body: {
    readonly requireSecondApprover?: boolean;
    readonly seedNewEditorsWithTestData?: boolean;
  },
): Promise<ApiResult<WorkspaceSettings>> {
  const result = await readResult<{
    workspaceId?: unknown;
    requireSecondApprover?: unknown;
    seedNewEditorsWithTestData?: unknown;
  }>(
    await adminApiFetch(session, `/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
      method: "PUT",
      body,
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      workspaceId: str(result.data.workspaceId),
      requireSecondApprover: bool(result.data.requireSecondApprover),
      seedNewEditorsWithTestData: bool(result.data.seedNewEditorsWithTestData),
    },
  };
}

/** `GET /admin/workspaces/{id}/audit` - the SEC-15 rows, newest first. */
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

/**
 * `GET /admin/me/access` - what the signed-in administrator holds.
 *
 * The one read on this surface that needs no grant, because it **is** the answer to what
 * the caller holds: everybody who is not an owner or the installation administrator
 * learns their own grants here, since the membership list itself is theirs alone to see.
 */
export async function readMyAccess(session: AdminSession): Promise<ApiResult<MyAccess>> {
  const result = await readResult<{
    userId?: unknown;
    installationAdmin?: unknown;
    workspaces?: unknown;
  }>(await adminApiFetch(session, "/me/access"));
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      userId: str(result.data.userId),
      installationAdmin: bool(result.data.installationAdmin),
      workspaces: rows(result.data.workspaces).map((row) => ({
        workspaceId: str(row["workspaceId"]),
        slug: str(row["slug"]),
        name: str(row["name"]),
        archived: bool(row["archived"]),
        memberRole: strOrNull(row["memberRole"]),
        grants: rows(row["grants"]).map((grant) => ({
          name: str(grant["name"]),
          role: str(grant["role"]),
          environments: strings(grant["environments"]),
          forms: strings(grant["forms"]),
        })),
        environments: strings(row["environments"]),
      })),
    },
  };
}
