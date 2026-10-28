import { getWorkspace, listActiveWorkspaces } from "@roonga/qcms-db";
import type { Executor, WorkspaceRow } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";

const fail = {
  noWorkspace: (): ApiError =>
    new ApiError(
      "NO_WORKSPACE",
      409,
      "This installation has no workspace to author in. `pnpm qcms:create-admin` seeds the first one; create another with POST /admin/workspaces.",
    ),
  ambiguous: (candidates: readonly WorkspaceRow[]): ApiError =>
    new ApiError(
      "WORKSPACE_REQUIRED",
      400,
      "More than one workspace exists, so the owning workspace has to be named",
      { workspaces: candidates.map((row) => ({ workspaceId: row.id, slug: row.slug })) },
    ),
  notFound: (): ApiError => new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace"),
  archived: (): ApiError =>
    new ApiError(
      "WORKSPACE_ARCHIVED",
      409,
      "That workspace is archived, so nothing new is created in it or moved into it",
    ),
} as const;

export const workspaceFail = fail;

/**
 * Archived or not: for the acts a workspace's end of life does not forbid, reading it and
 * handing the shared library on. Anything that puts something new in uses
 * {@link requireOpenWorkspace}.
 */
export async function requireWorkspace(exec: Executor, workspaceId: string): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(exec, workspaceId);
  if (workspace === undefined) throw fail.notFound();
  return workspace;
}

/**
 * Archived is a 409 rather than a 404: the row is still there to be named (Q15), and a
 * 404 would read as though it had gone.
 */
export async function requireOpenWorkspace(
  exec: Executor,
  workspaceId: string,
): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(exec, workspaceId);
  if (workspace === undefined) throw fail.notFound();
  if (workspace.archivedAt !== null) throw fail.archived();
  return workspace;
}

/**
 * The one named, or the only one there is. Ambiguity is refused rather than defaulted: an
 * object silently created in the wrong workspace is visible to the wrong group.
 */
export async function resolveWorkspaceForNewObject(
  exec: Executor,
  workspaceId: string | undefined,
): Promise<string> {
  if (workspaceId !== undefined) {
    return (await requireOpenWorkspace(exec, workspaceId)).id;
  }

  const candidates = await listActiveWorkspaces(exec);
  const only = candidates[0];
  if (only === undefined) throw fail.noWorkspace();
  if (candidates.length > 1) throw fail.ambiguous(candidates);
  return only.id;
}
