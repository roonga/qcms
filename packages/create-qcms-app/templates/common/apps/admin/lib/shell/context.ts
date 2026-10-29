/**
 * What each shell mode remembers between visits, and how a remembered value is restored.
 *
 * Client-safe and pure: the cookie names and their parsers are one definition, because the
 * shell resolves them on the server and the mode links write them in the browser.
 *
 * A remembered value is never an authorization input. Restoring one checks it against the
 * set the API served for this caller and falls back when it is not there, so a cookie kept
 * from a grant since revoked reaches nothing.
 */

import { landingPathForMode, WORKSPACES_PATH, type ShellMode } from "./modes.ts";

/** Which focused mode the shell was last in, so a personal route can stay inside it. */
export const SHELL_MODE_COOKIE = "qcms-shell-mode";

/** The workspace the Workspaces mode was last on. */
export const SHELL_WORKSPACE_COOKIE = "qcms-shell-workspace";

/** A year. A remembered context is a convenience, and nothing it holds expiry protects. */
export const SHELL_CONTEXT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Long enough for any identifier the API mints and short enough that a hand-written cookie
 * cannot carry a payload.
 */
const WORKSPACE_CONTEXT_MAX_LENGTH = 64;

function cookie(name: string, value: string, secure: boolean): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${SHELL_CONTEXT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function shellModeCookie(mode: ShellMode, secure: boolean): string {
  return cookie(SHELL_MODE_COOKIE, mode, secure);
}

export function shellWorkspaceCookie(workspaceId: string, secure: boolean): string {
  return cookie(SHELL_WORKSPACE_COOKIE, workspaceId, secure);
}

/**
 * A remembered workspace identifier, or `undefined` when there is none to trust. Anything
 * unbounded or carrying a path separator is discarded rather than repaired.
 */
export function parseWorkspaceContext(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw.length > WORKSPACE_CONTEXT_MAX_LENGTH) return undefined;
  if (!/^[\w.-]+$/.test(raw)) return undefined;
  return raw;
}

/**
 * Where entering Workspaces goes: the remembered workspace while the caller still
 * administers it, and All workspaces otherwise.
 */
export function restoredWorkspacePath(
  remembered: string | undefined,
  permittedIds: readonly string[],
): string {
  if (remembered === undefined) return WORKSPACES_PATH;
  if (!permittedIds.includes(remembered)) return WORKSPACES_PATH;
  return `${WORKSPACES_PATH}/${encodeURIComponent(remembered)}`;
}

/**
 * Where entering a mode goes. Operations returns to its forms list rather than to a form,
 * which is what re-entering it is for.
 */
export function restoredModePath(
  mode: ShellMode,
  context: {
    readonly workspace?: string | undefined;
    readonly permittedWorkspaceIds?: readonly string[];
  } = {},
): string {
  if (mode !== "workspaces") return landingPathForMode(mode);
  return restoredWorkspacePath(context.workspace, context.permittedWorkspaceIds ?? []);
}
