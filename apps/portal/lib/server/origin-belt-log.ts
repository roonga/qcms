import { portalBaseUrl } from "./config";
import { serverLogger } from "./logger";

/**
 * The observability half of SEC-9's CSRF belt. It changes nothing about who is refused:
 * the belt returns before any API call, so a refused request used to produce no line at
 * all, and an absence cannot be counted. Without this we could not tell a
 * correctly-refused forgery from an incorrectly-refused respondent, and the refused
 * population is a known, small, permanent one somebody accepted (issue #1024 measures
 * what the `Referrer-Policy: same-origin` change left of it).
 *
 * SEC-13 is met structurally rather than by redaction: no field emitted here is derived
 * from request content. Each is a selection from a finite vocabulary declared below, so
 * the request decides which constant is chosen and never what it is.
 *
 * `Origin` in particular is attacker-controlled, which is why {@link classifyOrigin}
 * returns a union rather than a string, and the route is reduced to a path template for
 * the same reason: the raw pathname carries a session id on most belted routes.
 *
 * `packages/observability/src/otlp-log-allowlist.ts` carries the export-side half, so
 * the line survives export intact rather than collapsing with its fields stripped.
 *
 * The call lives inside the belt rather than at the call sites, which is what makes one
 * line per refused request a property of the code: the belt is the single choke point,
 * and `scripts/check-origin-guards.test.ts` derives every state-changing handler from
 * disk. The cost is that the route is recognised from the URL rather than named by its
 * handler, which {@link BELTED_ROUTES} maps and `origin-belt-log.test.ts` keeps honest.
 */

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

/**
 * What a refused request gets back, as the respondent experiences it.
 *
 * Derived from the route rather than observed, because the belt runs before the handler
 * builds its response. `origin-belt-log.test.ts` drives each real handler with a refused
 * request and asserts the response matches the value declared here.
 *
 * It tells an operator which runbook symptom a support call is about.
 * `redirect-to-root` is its own member rather than folded into `redirect-to-step`
 * because it is the only refusal that moves a respondent off the page they were reading,
 * and nothing on the page they land on says why.
 */
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

/**
 * The four spec values plus the two cases that are not values: no header at all, which
 * is the population this module exists to count, and a token that is not one of the
 * four, which is `other` rather than the token itself.
 *
 * `same-origin` and `none` are admitted by the belt and so cannot appear on a refusal
 * line. They are in the vocabulary because the classifier is total over what a request
 * can carry, and a vocabulary with holes invites a caller to fill them with the raw
 * header.
 */
export type BeltFetchSite =
  "absent" | "same-origin" | "same-site" | "cross-site" | "none" | "other";

/**
 * How the request's `Origin` reads against this portal's own base URL. Under the
 * portal's `Referrer-Policy: same-origin` its own no-JS post classifies as `match`;
 * `null` beside an absent `Sec-Fetch-Site` is a post from a page that suppressed its
 * referrer or a sandboxed context, and `absent` beside `absent` is the old-browser shape
 * that is still refused.
 *
 * `unverifiable` means the base URL is unreadable, so there is nothing to compare
 * against. It exists so a configuration fault cannot turn this logging path into a throw
 * inside a security belt.
 */
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

/**
 * The pathname of an absolute URL, or `undefined` when it is not one.
 *
 * Total on purpose: `Request.url` is absolute in every runtime the portal runs in,
 * but a throw from a logging helper would become a 500 on a path whose whole job is
 * to refuse quietly, so an unparseable URL degrades to `"unrecognized"` instead.
 */
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
