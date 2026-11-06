import { cookies } from "next/headers";

import { parseWorkspaceContext, SHELL_WORKSPACE_COOKIE } from "../shell/context.ts";
import {
  workspaceContextFor,
  type WorkspaceContext,
  type WorkspaceChoice,
} from "../shell/workspace-context.ts";

import { listWorkspaces, readMyAccess } from "./membership.ts";
import type { AdminSession } from "./session.ts";

/**
 * The one resolution the top bar, the rails and every list read. A failed access read
 * offers no workspace rather than guessing one: a list scoped to a guess would be a list
 * of the wrong group's rows.
 *
 * An installation administrator holds no member row and no grant anywhere, so the
 * installation's own list is what they may open.
 */
export async function currentWorkspaceContext(session: AdminSession): Promise<WorkspaceContext> {
  const [access, store] = await Promise.all([readMyAccess(session), cookies()]);
  const held: readonly WorkspaceChoice[] = access.ok
    ? access.data.workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        name: workspace.name,
      }))
    : [];
  const every =
    access.ok && access.data.installationAdmin ? await listWorkspaces(session) : undefined;
  const choices =
    every?.ok === true
      ? [
          ...held,
          ...every.data
            .filter((row) => !held.some((choice) => choice.workspaceId === row.workspaceId))
            .map((row) => ({ workspaceId: row.workspaceId, name: row.name })),
        ]
      : held;
  return workspaceContextFor(
    parseWorkspaceContext(store.get(SHELL_WORKSPACE_COOKIE)?.value),
    choices,
  );
}

export async function currentWorkspaceId(session: AdminSession): Promise<string | undefined> {
  return (await currentWorkspaceContext(session)).current?.workspaceId;
}
