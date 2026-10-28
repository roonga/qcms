import { portalBaseUrl } from "./config";
import { serverLogger } from "./logger";

/** The observability half of SEC-9's CSRF belt. */

/** Grep this in the portal's stdout to count belt refusals. */
export const ORIGIN_BELT_REFUSED = "origin.belt.refused";

/**
 * Templates, never paths: a concrete path carries a session id, which SEC-13 does not
 * allow into a log line, or an author-chosen slug an operator does not need in order to
 * count refusals.
 */
export type BeltRoute =
  | "/appearance"
  | "/f/{formSlug}/start"
  | "/s/{sessionId}"
  | "/s/{sessionId}/answers"
  | "/s/{sessionId}/roster"
  | "/s/{sessionId}/step"
  | "/s/{sessionId}/submit"
  | "unrecognized";

export type BeltOutcome =
  | "redirect-to-entry"
  | "redirect-to-root"
  | "redirect-to-step"
  /**
   * What a refused Server Action produces: the respondent is already on the page the
   * action answers with, so there is nothing to redirect to and nothing was applied.
   */
  | "rendered-unchanged"
  | "forbidden";

export type BeltFetchSite =
  "absent" | "same-origin" | "same-site" | "cross-site" | "none" | "other";

export type BeltOrigin = "absent" | "null" | "match" | "mismatch" | "unverifiable";

/** Every member is a constant declared in this file. */
export interface OriginBeltRefusal {
  readonly beltRoute: BeltRoute;
  readonly beltFetchSite: BeltFetchSite;
  readonly beltOrigin: BeltOrigin;
  readonly beltOutcome: BeltOutcome;
}

interface BeltedRoute {
  readonly route: Exclude<BeltRoute, "unrecognized">;
  /** Anchored, one bounded segment per parameter: no nested quantifier to back off. */
  readonly pattern: RegExp;
  readonly outcome: BeltOutcome;
}

/**
 * Kept in step with the tree by `origin-belt-log.test.ts`, which reads `apps/portal/app`
 * from disk and asserts each derived template appears here, so a belted route added
 * without an entry is a failing test rather than an `unrecognized` line.
 */
const BELTED_ROUTES: readonly BeltedRoute[] = [
  { route: "/appearance", pattern: /^\/appearance\/?$/, outcome: "redirect-to-root" },
  // The flow page's own path, where the no-JS Add and Remove posts: a Server Action runs
  // against the page that declares it, so this is the one entry here that is not a
  // `route.ts`.
  { route: "/s/{sessionId}", pattern: /^\/s\/[^/]+\/?$/, outcome: "rendered-unchanged" },
  {
    route: "/f/{formSlug}/start",
    pattern: /^\/f\/[^/]+\/start\/?$/,
    outcome: "redirect-to-entry",
  },
  {
    route: "/s/{sessionId}/answers",
    pattern: /^\/s\/[^/]+\/answers\/?$/,
    outcome: "forbidden",
  },
  // The scripted Add or Remove. The no-JS one is belted too and has its own entry
  // above: both mechanisms refuse, and a refusal nobody can count is a locked-out
  // respondent nobody can count.
  {
    route: "/s/{sessionId}/roster",
    pattern: /^\/s\/[^/]+\/roster\/?$/,
    outcome: "forbidden",
  },
  { route: "/s/{sessionId}/step", pattern: /^\/s\/[^/]+\/step\/?$/, outcome: "redirect-to-step" },
  { route: "/s/{sessionId}/submit", pattern: /^\/s\/[^/]+\/submit\/?$/, outcome: "forbidden" },
];

/**
 * Exported so the disk-derived test can assert in both directions: every state-changing
 * handler appears here, and every entry still corresponds to a handler. One direction
 * alone either lets the table rot or lets a new route go unrecognised.
 */
export const BELTED_ROUTE_TEMPLATES: readonly Exclude<BeltRoute, "unrecognized">[] =
  BELTED_ROUTES.map((entry) => entry.route);

/**
 * Not a further vocabulary member, because an unrecognised path is a gap in
 * {@link BELTED_ROUTES} rather than a fact about the response, and naming it here keeps
 * {@link BeltOutcome} to the shapes a respondent can actually meet.
 */
const UNRECOGNIZED_OUTCOME: BeltOutcome = "forbidden";

const SPEC_FETCH_SITES = new Set(["same-origin", "same-site", "cross-site", "none"]);

export function classifyRoute(url: string): BeltRoute {
  const pathname = pathnameOf(url);
  if (pathname === undefined) return "unrecognized";
  return BELTED_ROUTES.find((entry) => entry.pattern.test(pathname))?.route ?? "unrecognized";
}

export function routeOutcome(url: string): BeltOutcome {
  const pathname = pathnameOf(url);
  if (pathname === undefined) return UNRECOGNIZED_OUTCOME;
  return (
    BELTED_ROUTES.find((entry) => entry.pattern.test(pathname))?.outcome ?? UNRECOGNIZED_OUTCOME
  );
}

function pathnameOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/** How `Sec-Fetch-Site` reads. Never the header value itself. */
export function classifyFetchSite(request: Request): BeltFetchSite {
  const value = request.headers.get("sec-fetch-site");
  if (value === null) return "absent";
  return SPEC_FETCH_SITES.has(value) ? (value as BeltFetchSite) : "other";
}

/** How `Origin` reads against this portal's base URL. Never the header value itself. */
export function classifyOrigin(request: Request): BeltOrigin {
  const origin = request.headers.get("origin");
  if (origin === null) return "absent";
  if (origin === "null") return "null";
  let expected: string;
  try {
    expected = portalBaseUrl();
  } catch {
    return "unverifiable";
  }
  return origin === expected ? "match" : "mismatch";
}

/** The refusal line's fields for this request. Pure: builds nothing, emits nothing. */
export function originBeltRefusal(request: Request): OriginBeltRefusal {
  return {
    beltRoute: classifyRoute(request.url),
    beltFetchSite: classifyFetchSite(request),
    beltOrigin: classifyOrigin(request),
    beltOutcome: routeOutcome(request.url),
  };
}

/**
 * Emit the one line a belt refusal produces.
 *
 * `warn` rather than `info`: a refusal is a request that did not happen, and it has
 * to be separable from the `api.call` stream at a level filter, both for an operator
 * grepping a support call and for a deployment that samples `info` away.
 */
export function logOriginBeltRefusal(request: Request): void {
  // Spread rather than passed through: `LogFields` is an index signature, and an
  // interface without one is not assignable to it. The spread keeps the four fields
  // named by a type at the point they are built, which is where it matters.
  serverLogger.warn(ORIGIN_BELT_REFUSED, { ...originBeltRefusal(request) });
}
