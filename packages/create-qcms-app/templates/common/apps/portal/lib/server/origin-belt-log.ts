import { portalBaseUrl } from "./config";
import { serverLogger } from "./logger";

/**
 * The observability half of SEC-9's CSRF belt (issue #578).
 *
 * ## Why this exists
 *
 * The belt itself (`isSameOriginPost` in `./route-helpers.ts`) returns before the
 * portal makes any API call, so a refused request produced no `api.call` line and no
 * error line: **nothing at all**. `docs/operations.md` had to tell an operator to
 * detect a locked-out respondent by noticing an absence - a 303 with no `api.call`
 * beside it. That is not a signal, it is the lack of one, and it cannot be counted.
 *
 * That matters more here than a missing log line usually would. The accepted position
 * on the Fetch Metadata baseline is that a measured floor of about 1.6% of browsers
 * send no `Sec-Fetch-Site` and are refused on the no-JS form path. Accepting a known,
 * small, permanent population of locked-out respondents is a decision someone made.
 * Being unable to see that population is not part of that decision: without a line
 * here we cannot tell a correctly-refused forgery from an incorrectly-refused
 * respondent, and we cannot tell whether the real rate matches the estimate.
 *
 * This module changes nothing about who is refused. It only makes the refusal visible.
 *
 * ## Every emitted value is a constant from this file
 *
 * SEC-13 is the hard constraint, and the way it is met here is structural rather than
 * by careful redaction: **no field this module emits is derived from request content.**
 * Each one is a selection from a finite vocabulary declared below. The request decides
 * *which* constant is chosen and never *what* the constant is, so there is no path by
 * which a token, a session id, a form slug, an address or a header value an attacker
 * chose can reach a log line - not by the stdout sink and not by the OTLP one.
 *
 * `Origin` in particular is attacker-controlled. It is classified into four outcomes
 * and never copied, which is why {@link classifyOrigin} returns a union rather than a
 * string. The route is reduced to a **path template** for the same reason: the raw
 * pathname carries a session id on three of the four belted routes.
 *
 * `packages/observability/src/otlp-log-allowlist.ts` carries the export-side half:
 * {@link ORIGIN_BELT_REFUSED} is in its event vocabulary and the four field names are
 * in its attribute set, so the line survives export intact instead of collapsing to
 * `application.event` with its fields stripped. Widening that allowlist is safe for
 * exactly the reason above - the values are constants, so an adopter's backend
 * receives nothing this file did not write.
 *
 * ## Exactly one line per refusal
 *
 * The call lives inside `isSameOriginPost`, not at the four call sites. That is what
 * makes "exactly one line per refused request" a property of the code rather than of
 * whoever edits a route next: the belt is the single choke point, and
 * `scripts/check-origin-guards.test.ts` already derives every state-changing handler
 * in the app from disk and fails if one does not call it. A route added later is
 * therefore logged the day it is belted, with nothing to remember.
 *
 * The cost is that the belt is no longer a pure predicate, and that the route has to
 * be recognised from the URL rather than named by the handler that knows it.
 * {@link BELTED_ROUTES} carries that mapping, and `origin-belt-log.test.ts` derives
 * the portal's state-changing route handlers from disk and fails if any of them is
 * missing from it - so an unmapped route is a red, not an `"unrecognized"` line
 * nobody notices.
 */

/** The event name. Grep this in the portal's stdout to count belt refusals. */
export const ORIGIN_BELT_REFUSED = "origin.belt.refused";

/**
 * A belted route reduced to its path template.
 *
 * Templates, never paths: `/s/ses_.../submit` carries a session id, which SEC-13 does
 * not allow into a log line, and `/f/<slug>/start` carries an author-chosen slug that
 * an operator does not need in order to count refusals.
 */
export type BeltRoute =
  | "/f/{formSlug}/start"
  | "/s/{sessionId}/answers"
  | "/s/{sessionId}/step"
  | "/s/{sessionId}/submit"
  | "unrecognized";

/**
 * What a refused request gets back, as the respondent experiences it.
 *
 * Derived from the route rather than observed, because the belt runs before the
 * handler builds its response. `origin-belt-log.test.ts` drives each real route
 * handler with a refused request and asserts the response matches the value declared
 * here, so the two cannot drift apart in silence.
 *
 * It is the field that tells an operator taking a support call which of the runbook's
 * two symptoms they are looking at: `redirect-to-entry` is "This form is not
 * available" on the entry page, `redirect-to-step` is the no-JS respondent bounced
 * back to the same step with their answers gone, and `forbidden` is a hydrated
 * `fetch()` refused with a 403 - a shape no ordinary respondent produces.
 */
export type BeltOutcome = "redirect-to-entry" | "redirect-to-step" | "forbidden";

/**
 * How the request's `Sec-Fetch-Site` header reads.
 *
 * The four spec values plus the two cases that are not values: no header at all
 * (the ~1.6% population, and the one this whole module exists to count) and a token
 * that is not one of the four, which is `"other"` rather than the token itself.
 *
 * `same-origin` and `none` are admitted by the belt, so they cannot appear on a
 * refusal line. They are in the vocabulary anyway because the classifier is total
 * over what a request can carry, and a vocabulary with holes in it invites a caller
 * to fill them with the raw header.
 */
export type BeltFetchSite =
  "absent" | "same-origin" | "same-site" | "cross-site" | "none" | "other";

/**
 * How the request's `Origin` header reads, relative to this portal's own base URL.
 *
 * `null` is its own case rather than a mismatch, and it is the discriminating one.
 * The portal sends `Referrer-Policy: no-referrer`, so a no-JS form navigation
 * serializes its origin as the literal string `null`: `absent` or `null` beside
 * `beltFetchSite: "absent"` is the honest old browser, while `mismatch` is a request
 * that named a foreign origin and is a forgery attempt or a misconfigured embed.
 *
 * `unverifiable` means `QCMS_PORTAL_BASE_URL` is unreadable, so there is nothing to
 * compare against. It exists so that a configuration fault cannot turn this logging
 * path into a throw inside a security belt.
 */
export type BeltOrigin = "absent" | "null" | "match" | "mismatch" | "unverifiable";

/** The fields of a refusal line. Every member is a constant declared in this file. */
export interface OriginBeltRefusal {
  readonly beltRoute: BeltRoute;
  readonly beltFetchSite: BeltFetchSite;
  readonly beltOrigin: BeltOrigin;
  readonly beltOutcome: BeltOutcome;
}

/** One belted route: how to recognise it, and what a refusal on it returns. */
interface BeltedRoute {
  readonly route: Exclude<BeltRoute, "unrecognized">;
  /** Anchored, one bounded segment per parameter: no nested quantifier to back off. */
  readonly pattern: RegExp;
  readonly outcome: BeltOutcome;
}

/**
 * Every state-changing portal route the belt guards.
 *
 * Kept in step with the tree by `origin-belt-log.test.ts`, which reads
 * `apps/portal/app` from disk, finds every `route.ts` exporting a state-changing
 * handler, and asserts each derived template appears here. Adding a belted route
 * without adding it here is a failing test rather than a line reading
 * `"unrecognized"`.
 */
const BELTED_ROUTES: readonly BeltedRoute[] = [
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
  { route: "/s/{sessionId}/step", pattern: /^\/s\/[^/]+\/step\/?$/, outcome: "redirect-to-step" },
  { route: "/s/{sessionId}/submit", pattern: /^\/s\/[^/]+\/submit\/?$/, outcome: "forbidden" },
];

/**
 * The route templates {@link BELTED_ROUTES} recognises, for the disk-derived
 * enumeration test to compare against. Exported so that test can assert in **both**
 * directions: every state-changing route handler in `apps/portal/app` appears here,
 * and every entry here still corresponds to a handler on disk. One direction alone
 * lets the table rot (a deleted route leaves a stale entry) or lets a route go
 * unrecognised (a new route leaves a hole).
 */
export const BELTED_ROUTE_TEMPLATES: readonly Exclude<BeltRoute, "unrecognized">[] =
  BELTED_ROUTES.map((entry) => entry.route);

/**
 * The default outcome for a request whose path matches no belted route.
 *
 * `forbidden` rather than a fifth vocabulary member, because an unrecognised path is
 * a gap in {@link BELTED_ROUTES} rather than a fact about the response, and the test
 * above exists to make sure the gap never reaches production. Naming it here keeps
 * {@link BeltOutcome} to the three shapes a respondent can actually meet.
 */
const UNRECOGNIZED_OUTCOME: BeltOutcome = "forbidden";

const SPEC_FETCH_SITES = new Set(["same-origin", "same-site", "cross-site", "none"]);

/** The path template of a request's URL, or `"unrecognized"` if it matches none. */
export function classifyRoute(url: string): BeltRoute {
  const pathname = pathnameOf(url);
  if (pathname === undefined) return "unrecognized";
  return BELTED_ROUTES.find((entry) => entry.pattern.test(pathname))?.route ?? "unrecognized";
}

/** What a refusal on the route this URL names returns to the respondent. */
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
