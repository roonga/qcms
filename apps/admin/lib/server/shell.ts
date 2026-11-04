import {
  NO_CONTEXT,
  parseWorkspaceContext,
  SHELL_MODE_COOKIE,
  SHELL_WORKSPACE_COOKIE,
  type RememberedContext,
} from "../shell/context.ts";
import { parseShellMode, type ShellCapabilities, type ShellMode } from "../shell/modes.ts";

import { readMyAccess } from "./membership.ts";
import type { AdminSession } from "./session.ts";

export type ShellAccess =
  | { readonly status: "known"; readonly capabilities: ShellCapabilities }
  | { readonly status: "unknown" };

/** Every area, which is what an unconfirmed read resolves to. A navigation narrowed by a read that failed would strand a caller whose grants are intact; the routes behind each entry still refuse. */
const ASSUMED: ShellCapabilities = {
  authoring: true,
  operations: true,
  workspaces: true,
  siteConfiguration: true,
};

export async function shellAccess(session: AdminSession): Promise<ShellAccess> {
  const access = await readMyAccess(session);
  if (!access.ok) return { status: "unknown" };
  return { status: "known", capabilities: access.data.capabilities };
}

export function navigableCapabilities(access: ShellAccess): ShellCapabilities {
  return access.status === "known" ? access.capabilities : ASSUMED;
}

export async function administeredWorkspaceIds(session: AdminSession): Promise<readonly string[]> {
  const access = await readMyAccess(session);
  if (!access.ok) return [];
  return access.data.workspaces.map((workspace) => workspace.workspaceId);
}

export function rememberedMode(cookieStore: {
  get(name: string): { readonly value: string } | undefined;
}): ShellMode | undefined {
  return parseShellMode(cookieStore.get(SHELL_MODE_COOKIE)?.value);
}

export async function rememberedContext(
  session: AdminSession,
  cookieStore: { get(name: string): { readonly value: string } | undefined },
): Promise<RememberedContext> {
  const workspace = parseWorkspaceContext(cookieStore.get(SHELL_WORKSPACE_COOKIE)?.value);
  if (workspace === undefined) return NO_CONTEXT;
  return { workspace, permittedWorkspaceIds: await administeredWorkspaceIds(session) };
}
