import {
  parseWorkspaceContext,
  SHELL_MODE_COOKIE,
  SHELL_WORKSPACE_COOKIE,
} from "../shell/context.ts";
import { parseShellMode, type ShellCapabilities } from "../shell/modes.ts";

import { readMyAccess } from "./membership.ts";
import type { AdminSession } from "./session.ts";

/**
 * What the shell knows about the signed-in caller's areas, and the context each mode
 * remembers.
 *
 * The capability projection is a navigation convenience, never the authority: every route
 * and server action re-decides, which is what keeps a menu this app forgot to hide from
 * being a permission.
 */

/**
 * `unknown` is a third state rather than an absence. A failed discovery read is not a
 * refusal, so nothing may be denied on the strength of it.
 */
export type ShellAccess =
  | { readonly status: "known"; readonly capabilities: ShellCapabilities }
  | { readonly status: "unknown" };

/**
 * Every area, which is what an unconfirmed read resolves to. A navigation narrowed by a
 * read that failed would strand a caller whose grants are intact; the routes behind each
 * entry still refuse.
 */
const ASSUMED: ShellCapabilities = {
  authoring: true,
  operations: true,
  workspaces: true,
  siteConfiguration: true,
};

/** The caller's areas, read through the memoized `GET /admin/me/access`. */
export async function shellAccess(session: AdminSession): Promise<ShellAccess> {
  const access = await readMyAccess(session);
  if (!access.ok) return { status: "unknown" };
  return { status: "known", capabilities: access.data.capabilities };
}

/** The capabilities to navigate by, treating an unconfirmed read as no narrowing. */
export function navigableCapabilities(access: ShellAccess): ShellCapabilities {
  return access.status === "known" ? access.capabilities : ASSUMED;
}

/** The workspaces this caller administers, as the identifiers a remembered one is checked against. */
export async function administeredWorkspaceIds(session: AdminSession): Promise<readonly string[]> {
  const access = await readMyAccess(session);
  if (!access.ok) return [];
  return access.data.workspaces.map((workspace) => workspace.workspaceId);
}

/** What each mode remembered, read from the request's cookies. */
export function rememberedContext(cookieStore: {
  get(name: string): { readonly value: string } | undefined;
}): {
  readonly mode: ReturnType<typeof parseShellMode>;
  readonly workspace: string | undefined;
} {
  return {
    mode: parseShellMode(cookieStore.get(SHELL_MODE_COOKIE)?.value),
    workspace: parseWorkspaceContext(cookieStore.get(SHELL_WORKSPACE_COOKIE)?.value),
  };
}
