import { adminBaseUrl } from "./config.ts";
import { serverLogger } from "./logger.ts";

/** Log refusals at the single origin guard so probes leave evidence. Emit only finite constants and route templates, never request headers, paths, credentials or identifiers. */

export const ORIGIN_BELT_REFUSED = "origin.belt.refused";

/** Route templates distinguish probes against credential flows without exposing path identifiers. */
export type BeltRoute =
  | "/assist"
  | "/change-password/submit"
  | "/forms/{formId}/assist"
  | "/settings/password"
  | "/settings/recovery-codes"
  | "/sign-in/submit"
  | "/sign-out"
  | "/two-factor/challenge/verify"
  | "/two-factor/enroll/verify"
  | "/two-factor/recovery-codes/confirm"
  | "/two-factor/recovery/verify"
  | "unrecognized";

/** Classify the response shape from the route: the belt runs before the handler constructs its redirect or 403. */
export type BeltOutcome = "redirect-with-failure" | "redirect-without-message" | "refused-403";

/** Classify unknown tokens as other, never copy attacker-controlled header text. */
export type BeltFetchSite =
  "absent" | "same-origin" | "same-site" | "cross-site" | "none" | "other";

/** No-referrer can yield Origin: null on legitimate navigation POSTs. An unreadable base URL is unverifiable; logging must never throw inside the security guard. */
export type BeltOrigin = "absent" | "null" | "match" | "mismatch" | "unverifiable";

export interface OriginBeltRefusal {
  readonly beltRoute: BeltRoute;
  readonly beltFetchSite: BeltFetchSite;
  readonly beltOrigin: BeltOrigin;
  readonly beltOutcome: BeltOutcome;
}

interface BeltedRoute {
  readonly route: Exclude<BeltRoute, "unrecognized">;

  readonly pattern: RegExp;
  readonly outcome: BeltOutcome;
}

/** origin-belt-log tests derive every state-changing route from disk so new guarded routes cannot silently lack a template. */
const BELTED_ROUTES: readonly BeltedRoute[] = [
  {
    route: "/assist",
    pattern: /^\/assist\/?$/u,
    outcome: "refused-403",
  },
  {
    /** Bound one form-id segment so nested paths cannot match this route. */
    route: "/forms/{formId}/assist",
    pattern: /^\/forms\/[^/]+\/assist\/?$/,
    outcome: "refused-403",
  },
  {
    /** Bootstrap password changes are distinct from settings changes: provisional accounts cannot reach the shell. */
    route: "/change-password/submit",
    pattern: /^\/change-password\/submit\/?$/,
    outcome: "redirect-with-failure",
  },
  {
    route: "/settings/password",
    pattern: /^\/settings\/password\/?$/,
    outcome: "redirect-with-failure",
  },
  {
    route: "/settings/recovery-codes",
    pattern: /^\/settings\/recovery-codes\/?$/,
    outcome: "redirect-with-failure",
  },
  {
    route: "/sign-in/submit",
    pattern: /^\/sign-in\/submit\/?$/,
    outcome: "redirect-with-failure",
  },
  {
    route: "/sign-out",
    pattern: /^\/sign-out\/?$/,
    outcome: "redirect-without-message",
  },
  {
    route: "/two-factor/challenge/verify",
    pattern: /^\/two-factor\/challenge\/verify\/?$/,
    outcome: "redirect-with-failure",
  },
  {
    route: "/two-factor/enroll/verify",
    pattern: /^\/two-factor\/enroll\/verify\/?$/,
    outcome: "redirect-with-failure",
  },
  {
    route: "/two-factor/recovery-codes/confirm",
    pattern: /^\/two-factor\/recovery-codes\/confirm\/?$/,
    outcome: "redirect-without-message",
  },
  {
    route: "/two-factor/recovery/verify",
    pattern: /^\/two-factor\/recovery\/verify\/?$/,
    outcome: "redirect-with-failure",
  },
];

/** Expose templates for the disk-derived test to detect both new unmapped routes and stale entries. */
export const BELTED_ROUTE_TEMPLATES: readonly Exclude<BeltRoute, "unrecognized">[] =
  BELTED_ROUTES.map((entry) => entry.route);

/** Unknown routes cannot establish which message a caller saw; use the least specific outcome. */
const UNRECOGNIZED_OUTCOME: BeltOutcome = "redirect-without-message";

const SPEC_FETCH_SITES = new Set(["same-origin", "same-site", "cross-site", "none"]);

/** Malformed URLs degrade to unrecognized; a logging failure must never replace a quiet refusal with a 500. */
function pathnameOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

function beltedRouteOf(url: string): BeltedRoute | undefined {
  const pathname = pathnameOf(url);
  if (pathname === undefined) return undefined;
  return BELTED_ROUTES.find((entry) => entry.pattern.test(pathname));
}

export function classifyRoute(url: string): BeltRoute {
  return beltedRouteOf(url)?.route ?? "unrecognized";
}

export function routeOutcome(url: string): BeltOutcome {
  return beltedRouteOf(url)?.outcome ?? UNRECOGNIZED_OUTCOME;
}

/** How `Sec-Fetch-Site` reads. Never the header value itself. */
export function classifyFetchSite(request: Request): BeltFetchSite {
  const value = request.headers.get("sec-fetch-site");
  if (value === null) return "absent";
  return SPEC_FETCH_SITES.has(value) ? (value as BeltFetchSite) : "other";
}

/** How `Origin` reads against this app's base URL. Never the header value itself. */
export function classifyOrigin(request: Request): BeltOrigin {
  const origin = request.headers.get("origin");
  if (origin === null) return "absent";
  if (origin === "null") return "null";
  let expected: string;
  try {
    expected = adminBaseUrl();
  } catch {
    return "unverifiable";
  }
  return origin === expected ? "match" : "mismatch";
}

export function originBeltRefusal(request: Request): OriginBeltRefusal {
  return {
    beltRoute: classifyRoute(request.url),
    beltFetchSite: classifyFetchSite(request),
    beltOrigin: classifyOrigin(request),
    beltOutcome: routeOutcome(request.url),
  };
}

/** Warn keeps auth probes visible when deployments filter or sample ordinary info calls. */
export function logOriginBeltRefusal(request: Request): void {
  /** Spread preserves named interface fields while satisfying the logger index signature. */
  serverLogger.warn(ORIGIN_BELT_REFUSED, { ...originBeltRefusal(request) });
}
