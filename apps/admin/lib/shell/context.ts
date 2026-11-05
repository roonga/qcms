/** Remembered cookies are navigation preferences, never authorization. Restore only values still present in the API-permitted set. */

import { workspaceHref } from "../membership/sections.ts";

import { landingPathForMode, WORKSPACES_PATH, type ShellMode } from "./modes.ts";

export const SHELL_MODE_COOKIE = "qcms-shell-mode";

export const SHELL_WORKSPACE_COOKIE = "qcms-shell-workspace";

export const SHELL_CONTEXT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

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

/** Discard oversized or path-bearing values rather than repairing untrusted cookie input. */
export function parseWorkspaceContext(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw.length > WORKSPACE_CONTEXT_MAX_LENGTH) return undefined;
  if (!/^[\w.-]+$/.test(raw)) return undefined;
  return raw;
}

export function restoredWorkspacePath(
  remembered: string | undefined,
  permittedIds: readonly string[],
): string {
  if (remembered === undefined) return WORKSPACES_PATH;
  if (!permittedIds.includes(remembered)) return WORKSPACES_PATH;
  return workspaceHref(remembered);
}

export interface RememberedContext {
  readonly workspace: string | undefined;
  readonly permittedWorkspaceIds: readonly string[];
}

export const NO_CONTEXT: RememberedContext = { workspace: undefined, permittedWorkspaceIds: [] };

export function restoredModePath(mode: ShellMode, context: RememberedContext): string {
  if (mode !== "workspaces") return landingPathForMode(mode);
  return restoredWorkspacePath(context.workspace, context.permittedWorkspaceIds);
}
