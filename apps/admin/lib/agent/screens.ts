/**
 * The screen table: every `(shell)` page route pattern, which is also its screen id.
 *
 * A turn sends a screen id and the route's own ids and never context content, so this
 * table is the whole of what the browser says about what the agent may see. The ids are
 * the API's (`apps/api/src/features/agent/screens.ts`), and `lib/agent/screens.test.ts`
 * reads the route tree off the filesystem and fails when a page has no row here.
 *
 * It is also the Markdown renderer's link allowlist: a link survives only for a path that
 * matches a row, so a route handler such as `/forms/[formId]/export` can never become a
 * link the browser would fetch.
 */

export const AGENT_SCREENS = [
  "/forms",
  "/forms/new",
  "/forms/[formId]",
  "/forms/[formId]/rules",
  "/forms/[formId]/preview",
  "/forms/[formId]/versions",
  "/forms/[formId]/versions/[version]",
  "/forms/[formId]/releases",
  "/forms/[formId]/links",
  "/forms/[formId]/webhooks",
  "/forms/[formId]/responses",
  "/forms/[formId]/responses/[sessionId]",
  "/questions",
  "/questions/new",
  "/questions/[questionId]",
  "/me/access",
  "/operations",
  "/responses",
  "/responses/erasures",
  "/settings",
  "/webhooks",
  "/workspaces",
  "/workspaces/[workspaceId]",
] as const;

export type AgentScreen = (typeof AGENT_SCREENS)[number];

/** The response list's four filters, as the API's body names them. */
export interface AgentResponseFilters {
  version?: number;
  from?: string;
  to?: string;
  flagged?: boolean;
}

/** The route ids a screen's context builder reads, named as the API's body names them. */
export interface AgentScreenParams {
  [key: string]: string | number | AgentResponseFilters | undefined;
  formId?: string;
  questionId?: string;
  workspaceId?: string;
  sessionId?: string;
  version?: number;
  /** The response list screen only: the filter set the operator is looking at. */
  filters?: AgentResponseFilters;
}

export interface ResolvedScreen {
  readonly screen: AgentScreen;
  readonly params: AgentScreenParams;
}

/** Which `[segment]` of a pattern fills which param. */
const PLACEHOLDERS: Readonly<Record<string, keyof AgentScreenParams>> = {
  "[formId]": "formId",
  "[questionId]": "questionId",
  "[workspaceId]": "workspaceId",
  "[sessionId]": "sessionId",
  "[version]": "version",
};

function segmentsOf(path: string): readonly string[] {
  const trimmed = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  return trimmed.slice(1).split("/");
}

function match(pattern: AgentScreen, segments: readonly string[]): ResolvedScreen | undefined {
  const expected = segmentsOf(pattern);
  if (expected.length !== segments.length) return undefined;
  const params: AgentScreenParams = {};
  for (const [index, part] of expected.entries()) {
    const actual = segments[index] ?? "";
    if (!part.startsWith("[")) {
      if (part !== actual) return undefined;
      continue;
    }
    const name = PLACEHOLDERS[part];
    if (name === undefined) return undefined;
    if (name === "version") params.version = Number(actual);
    else params[name] = actual;
  }
  if (params.version !== undefined && !Number.isInteger(params.version)) return undefined;
  return { screen: pattern, params };
}

/**
 * The screen a pathname is, with its route ids, or `undefined` for a path no `(shell)`
 * page serves. A path with no row gets no assistant context rather than a guessed one.
 */
export function screenForPath(pathname: string): ResolvedScreen | undefined {
  if (!pathname.startsWith("/")) return undefined;
  const segments = segmentsOf(pathname);
  // Longest literal prefix first, so a literal beats a placeholder where both match.
  const ordered = [...AGENT_SCREENS].sort(
    (a, b) =>
      b.split("/").filter((part) => !part.startsWith("[")).length -
      a.split("/").filter((part) => !part.startsWith("[")).length,
  );
  for (const pattern of ordered) {
    const found = match(pattern, segments);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The subject one conversation belongs to: a form's whole subtree, else the screen. */
export function conversationSubject(resolved: ResolvedScreen | undefined): string {
  if (resolved === undefined) return "none";
  if (resolved.params.formId !== undefined) return `form:${resolved.params.formId}`;
  return `screen:${resolved.screen}`;
}

/** A path segment safe to put in an `href`: no traversal, no encoding tricks. */
const SEGMENT = /^[A-Za-z0-9._~-]+$/u;

/** The `href` a link target may keep, or `undefined` when it must render as text. */
export function adminPageHref(target: string): string | undefined {
  const path = target.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  if (path.includes("?") || path.includes("#")) return undefined;
  const segments = path.slice(1).split("/");
  if (!segments.every((segment) => SEGMENT.test(segment) && segment !== "..")) return undefined;
  return screenForPath(path) === undefined ? undefined : path;
}
