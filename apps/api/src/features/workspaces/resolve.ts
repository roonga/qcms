import { getWorkspace, listActiveWorkspaces } from "@roonga/qcms-db";
import type { Executor, WorkspaceRow } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";

/**
 * Which workspace a new form or question belongs to (ADR-41, task 068, criterion 1).
 *
 * # Why this is a resolution and not a column default
 *
 * `control.forms.workspace_id` and `control.questions.workspace_id` are `NOT NULL` with
 * no default, which is criterion 1: the column is the enforcement. But a request has to
 * say which workspace, and there is no admin screen that asks - the workspace and
 * membership screens arrive with task 069, which is where the permissions matrix that
 * governs them is built, and a screen invented here would be a requirement the plan does
 * not have.
 *
 * So the field is **optional on the request and resolved here**, with exactly three
 * outcomes:
 *
 *   - **Named:** that workspace, provided it exists and is not archived.
 *   - **Omitted on a one-workspace installation:** that workspace. This is the ordinary
 *     case - a bootstrapped deployment has one workspace to author in (Q13) - and it is
 *     what keeps the existing authoring surface working unchanged while 069 builds the
 *     picker.
 *   - **Omitted with more than one to choose from:** refused, naming the candidates.
 *
 * # Why the ambiguous case is a refusal rather than a default
 *
 * Q19 settled the same question one design over, for a secure link's environment: "there
 * is no safe default here: a script that omits the field and silently gets a production
 * link is the failure this refuses". A form silently created in the wrong workspace is
 * the same shape of failure - it is visible to the wrong group from the moment it exists
 * - and the installation that has two workspaces is by definition the one where it
 * matters. Picking the oldest, or the shared one, would be a choice no caller could see.
 */

/** Typed refusals, as the admin surface's envelope codes. */
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

/** The refusals this module raises, for the slices that re-export them in their own docs. */
export const workspaceFail = fail;

/**
 * The workspace a named id resolves to: it has to exist and must not be archived.
 *
 * Archived is a refusal rather than a filter, because a caller that named the workspace
 * is owed the reason: "a workspace is archived, never deleted" (Q15) means the row is
 * still there to be named, and a 404 would read as though it had gone.
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
 * The workspace a new form or question is created in: the one named, or the only one
 * there is.
 *
 * Takes the control executor rather than `Deps`, so the caller that already owns a
 * transaction can resolve inside it and the one that does not can resolve before opening
 * one (R5). Every refusal is raised before any write.
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
