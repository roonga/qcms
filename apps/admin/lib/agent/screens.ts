/** The browser sends IDs, never context content. This closed page allowlist also excludes route handlers and download paths from model links. */

export const AGENT_SCREENS = [
  "/forms",
  "/forms/new",
  "/forms/[formId]",
  "/forms/[formId]/rules",
  "/forms/[formId]/preview",
  "/forms/[formId]/versions",
  "/forms/[formId]/versions/[version]",
  "/forms/[formId]/publish",
  "/operations/forms/[formId]/links",
  "/operations/forms/[formId]/webhooks",
  "/operations/forms/[formId]/responses",
  "/operations/forms/[formId]/responses/[sessionId]",
  "/operations/forms/[formId]/availability",
  "/operations/forms/[formId]/erase",
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
  "/workspaces/all",
  "/workspaces/[workspaceId]/members",
  "/workspaces/[workspaceId]/access-groups",
  "/workspaces/[workspaceId]/settings",
  "/workspaces/[workspaceId]/audit",
  "/workspaces/[workspaceId]/assistant-actions",
] as const;

export type AgentScreen = (typeof AGENT_SCREENS)[number];

export interface AgentResponseFilters {
  version?: number;
  from?: string;
  to?: string;
  flagged?: boolean;
}

export interface AgentScreenParams {
  [key: string]: string | number | AgentResponseFilters | undefined;
  formId?: string;
  questionId?: string;
  workspaceId?: string;
  sessionId?: string;
  version?: number;

  filters?: AgentResponseFilters;
}

export interface ResolvedScreen {
  readonly screen: AgentScreen;
  readonly params: AgentScreenParams;
}

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

export function screenForPath(pathname: string): ResolvedScreen | undefined {
  if (!pathname.startsWith("/")) return undefined;
  const segments = segmentsOf(pathname);
  /** Prefer literal routes over placeholders when both match. */
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

export function conversationSubject(resolved: ResolvedScreen | undefined): string {
  if (resolved === undefined) return "none";
  if (resolved.params.formId !== undefined) return `form:${resolved.params.formId}`;
  return `screen:${resolved.screen}`;
}

const IDENTITY_IDS = ["formId", "questionId", "workspaceId", "sessionId", "version"] as const;

/** One screen as a waiting card's binding reads it: the route and its own ids, not its filters. */
export function screenIdentity(resolved: ResolvedScreen | undefined): string {
  if (resolved === undefined) return "none";
  const ids = IDENTITY_IDS.map((key) => `${key}=${String(resolved.params[key] ?? "")}`);
  return [resolved.screen, ...ids].join("|");
}

const SEGMENT = /^[A-Za-z0-9._~-]+$/u;

export function adminPageHref(target: string): string | undefined {
  const path = target.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  if (path.includes("?") || path.includes("#")) return undefined;
  const segments = path.slice(1).split("/");
  if (!segments.every((segment) => SEGMENT.test(segment) && segment !== "..")) return undefined;
  return screenForPath(path) === undefined ? undefined : path;
}
