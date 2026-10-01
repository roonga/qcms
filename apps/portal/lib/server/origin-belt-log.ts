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
 * on the Fetch Metadata baseline is that about 1.6% of browsers send no
 * `Sec-Fetch-Site`, and those that **also send no matching `Origin`** are refused on
 * the no-JS form path. That figure is an **upper bound on the refused population and
 * not the population itself**, and it has been one since 2026-10-01: the portal now
 * serves `Referrer-Policy: same-origin`, so a Fetch-Metadata-less browser posting from
 * a portal page sends this portal's real origin and is admitted by the `Origin` leg. How
 * much of the 1.6% that leaves is unmeasured (issue #1024). Accepting a known, small,
 * permanent population of locked-out respondents is a decision someone made.
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
 * pathname carries a session id on three of the five belted routes.
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
 * Derived from the route rather than observed, because the belt runs before the
 * handler builds its response. `origin-belt-log.test.ts` drives each real route
 * handler with a refused request and asserts the response matches the value declared
 * here, so the two cannot drift apart in silence.
 *
 * It is the field that tells an operator taking a support call which of the runbook's
 * symptoms they are looking at: `redirect-to-entry` is "This form is not
 * available" on the entry page, `redirect-to-step` is the no-JS respondent bounced
 * back to the same step with their answers gone, `redirect-to-root` is the no-JS
 * appearance form (issue #195) dropping the respondent at the site root with their
 * appearance unchanged, and `forbidden` is a hydrated `fetch()` refused with a 403 - a
 * shape no ordinary respondent produces.
 *
 * `rendered-unchanged` is the newest member and the only one that is not a status
 * code: the no-JS Add and Remove is a Server Action, and a refused action returns the
 * step it was pressed on with a message and nothing applied. An operator reading it
 * knows the respondent saw their own step rather than a redirect or a 403.
 *
 * `redirect-to-root` is its own member rather than folded into `redirect-to-step`
 * because it is the only refusal that moves a respondent OFF the page they were reading.
 * A refused appearance submission cannot be sent back to the page it named, since a
 * request that could not prove its origin does not get to choose the redirect (PR #859
 * review), so the respondent loses their place and nothing on the page they land on says
 * why. This line is the only place that fact exists.
 */
export type BeltOutcome =
  | "redirect-to-entry"
  | "redirect-to-root"
  | "redirect-to-step"
  /**
   * The step re-rendered unchanged with a message, which is what a refused Server
   * Action produces (task 073): the respondent is already on the page the action
   * answers with, so there is nothing to redirect to and nothing was applied.
   */
  | "rendered-unchanged"
  | "forbidden";

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
 * `null` is its own case rather than a mismatch, and what it identifies changed on
 * 2026-10-01.
 *
 * Until then the portal sent `Referrer-Policy: no-referrer`, under which a no-JS form
 * navigation serializes its origin as the literal string `null` (Fetch), so `absent` or
 * `null` beside `beltFetchSite: "absent"` was the shape of an honest old browser. The
 * portal now sends `same-origin` (SEC-9 as amended, for the `__qop` Server Action), so:
 *
 * - the portal's **own** no-JS post classifies as `match` and is admitted;
 * - `null` beside `absent` is a post from a page that suppressed its own referrer or
 *   from a sandboxed context, which is what an attacker's page looks like;
 * - `absent` beside `absent` is the old-browser shape, and the one still refused.
 *
 * `mismatch` is unchanged: a request that named a foreign origin, so a forgery attempt
 * or a misconfigured embed.
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
  { route: "/appearance", pattern: /^\/appearance\/?$/, outcome: "redirect-to-root" },
  // The flow page's own path, which is where the no-JS Add and Remove of a repeating
  // group posts: it is a Next **Server Action**, and a Server Action runs against the
  // page that declares it (task 073, ADR-43 as amended). It is the one belted entry
  // point in this table that is not a `route.ts`, and it is belted rather than left to
  // Next's own origin check because that check is weaker in three ways: it admits a
  // request carrying no `Origin` at all after only a warning, it compares the host
  // while ignoring the scheme, and it never reads `Sec-Fetch-Site` (Code Owner,
  // 2026-10-01, ruling R-B2).
  //
  // A refusal re-renders the step unchanged with a message, which is neither a redirect
  // nor a 403: the respondent is already on the page the action answers with.
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
  // The scripted path's Add or Remove of a repeating-group instance (task 073). A
  // hydrated `fetch()` like the answer write beside it, so a refusal is the same 403 a
  // shape no ordinary respondent produces gets. The no-JS path's Add and Remove is a
  // Next Server Action rather than a route handler, so it is not in this table and does
  // not need to be: Next verifies an action's own origin against the `Host`, which is
  // why the portal serves `Referrer-Policy: same-origin` (SEC-9 as amended, 2026-10-01)
  // and why `scripts/check-origin-guards.test.ts` states that reasoning.
  {
    route: "/s/{sessionId}/roster",
    pattern: /^\/s\/[^/]+\/roster\/?$/,
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
