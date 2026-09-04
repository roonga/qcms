import { adminBaseUrl } from "./config.ts";
import { serverLogger } from "./logger.ts";

/**
 * The observability half of SEC-9's CSRF belt on the admin (issue #620).
 *
 * ## Why this exists, and why the reason is not the portal's reason
 *
 * The belt itself (`isSameOriginPost` in `./route-helpers.ts`) returns before the
 * handler calls anything, so a refused request produced no `auth.api.call` line, no
 * `api.call` line and no error line: **nothing at all**. The only server-side evidence
 * of a refusal was the absence of a line, which cannot be counted.
 *
 * `apps/portal/lib/server/origin-belt-log.ts` closed the same gap one surface over
 * (issue #578), and this module is deliberately its twin. The **reason** the two exist
 * is not the same, and reading this one as a quieter copy of that one gets the
 * operational value backwards:
 *
 *   - The portal's line makes an **accepted risk observable**. A measured floor of
 *     around 1.6% of browsers send no Fetch Metadata and are refused on the no-JS form
 *     path; accepting that population was a decision, and being unable to see it was
 *     not part of the decision.
 *   - This line is **attack detection**. Every route it covers is an authentication
 *     route: sign-in, sign-out, the TOTP challenge, TOTP enrolment, recovery-code
 *     confirmation and the password change. A burst of refusals against
 *     `/two-factor/challenge/verify` is not an old browser. It is something trying
 *     cross-origin requests against the auth surface, and before this module it left
 *     no trace anywhere.
 *
 * "The staff can be asked what they saw" is true of an accidental refusal and
 * irrelevant to a deliberate one: nobody reports that they are probing your
 * two-factor endpoint. For a refusal that nobody will ever call about, the line this
 * module writes is the only evidence that will exist.
 *
 * This module changes nothing about who is refused. Issue #504 settled the belt's
 * behaviour; this only makes the existing refusal visible.
 *
 * ## Every emitted value is a constant from this file
 *
 * SEC-13 is the hard constraint, and it is met structurally rather than by careful
 * redaction: **no field this module emits is derived from request content.** Each one
 * is a selection from a finite vocabulary declared below. The request decides *which*
 * constant is chosen and never *what* the constant is, so there is no path by which a
 * session token, an email address, a TOTP code, a recovery code or an attacker-chosen
 * header value can reach a log line, on the stdout sink or the OTLP one. That matters
 * more here than on the portal: these requests carry credentials.
 *
 * `Origin` in particular is attacker-controlled. It is classified into five outcomes
 * and never copied, which is why {@link classifyOrigin} returns a union rather than a
 * string.
 *
 * `packages/observability/src/otlp-log-allowlist.ts` carries the export-side half:
 * {@link ORIGIN_BELT_REFUSED} is in its event vocabulary and the four field names are
 * in its attribute set, so the line survives export intact instead of collapsing to
 * `application.event` with its fields stripped. Both apps emit the same event name and
 * the same four field names, so that allowlist already admitted this line before this
 * module existed; `origin-belt-log.test.ts` drives the real processor rather than
 * trusting that reading.
 *
 * ## The route is a template, and one belted admin path now has a parameter
 *
 * Stated plainly because the portal's reasoning does not transfer. Three of the four
 * belted portal routes carry a session id in the path, so reducing the URL to a
 * template is what keeps an identifier out of the line. Eight of the admin's nine
 * belted routes carry no dynamic segment, so on those the reduction is an identity on
 * the URL. It is still a reduction rather than the raw pathname, for two reasons that
 * are not hypothetical, and task 041's `/forms/{formId}/assist` is the second of them
 * arriving:
 *
 *   1. The file path is not the URL path here. Two of the eight sit under a route
 *      group (`app/(shell)/settings/...`), which exists to share a layout and does not
 *      appear in the URL, and the tree also carries a parallel-route slot (`@rail`,
 *      no route handlers under it today) that does not appear either. So "the route"
 *      has to be named rather than read off the tree. `origin-belt-log.test.ts`
 *      derives the templates from disk with those segments dropped and asserts they
 *      are exactly {@link BELTED_ROUTE_TEMPLATES}.
 *   2. The admin's URL space is full of identifiers (`/forms/{formId}`,
 *      `/responses/{sessionId}`), so the next belted route added here is more likely
 *      than not to carry one. A vocabulary that admits only templates cannot acquire
 *      a raw path by accident.
 *
 * ## Exactly one line per refusal
 *
 * The call lives inside `isSameOriginPost`, not at the eight call sites. That is what
 * makes "exactly one line per refused request" a property of the code rather than of
 * whoever edits a route next: the belt is the single choke point, and
 * `scripts/check-origin-guards.test.ts` already derives every state-changing handler
 * in both apps from disk and fails if one does not call it. A route added later is
 * therefore logged the day it is belted, with nothing to remember.
 *
 * The cost is that the belt is no longer a pure predicate, and that the route has to
 * be recognised from the URL rather than named by the handler that knows it.
 * {@link BELTED_ROUTES} carries that mapping, and the test derives the admin's
 * state-changing route handlers from disk and fails if any of them is missing from it
 * - so an unmapped route is a red, not an `"unrecognized"` line nobody notices.
 */

/** The event name. Grep this in the admin's stdout to count belt refusals. */
export const ORIGIN_BELT_REFUSED = "origin.belt.refused";

/**
 * A belted route reduced to its path template.
 *
 * Every member is an authentication or credential route, which is the whole reason
 * this field is worth reading: `beltRoute` is what separates "someone bookmarked the
 * sign-out form" from "something is posting at the TOTP verifier".
 */
export type BeltRoute =
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

/**
 * What a refused request gets back, as the person at the keyboard experiences it.
 *
 * Two members rather than the portal's three, because the admin's refusal shape is
 * genuinely narrower: every one of these routes is reached by an ordinary
 * `<form method="post">` and every refusal is a 303. What differs is whether the
 * redirect carries the generic-failure marker the screens turn into their one fixed
 * sentence (SEC-1), so that is what the field records:
 *
 *   - `redirect-with-failure` is the staff member who sees "something went wrong" on
 *     the screen they were already on. It is the shape a support call is about.
 *   - `redirect-without-message` is a refusal that says nothing: sign-out lands on the
 *     sign-in screen (while the session is in fact still live, because the sign-out
 *     never happened) and the recovery-code confirm lands in the shell. Nobody will
 *     ever report one of these, which is exactly why it has to be logged.
 *   - `refused-403` is the third, added by task 041's assist turn: the first belted
 *     admin route reached by the panel's own `fetch` rather than by a
 *     `<form method="post">`. There is no screen to redirect and no person watching a
 *     navigation, so it answers a bare 403 and the panel renders its own error state.
 *     Kept distinct from the two redirect shapes because the operational question the
 *     field answers ("what did the person see?") has a different answer here: nothing,
 *     unless a panel was open.
 *
 * Derived from the route rather than observed, because the belt runs before the
 * handler builds its response. `origin-guard.test.ts` drives each real route handler
 * with a refused request and asserts the value declared here matches the redirect that
 * actually came back, so the two cannot drift apart in silence.
 */
export type BeltOutcome = "redirect-with-failure" | "redirect-without-message" | "refused-403";

/**
 * How the request's `Sec-Fetch-Site` header reads.
 *
 * The four spec values plus the two cases that are not values: no header at all, and a
 * token that is not one of the four, which is `"other"` rather than the token itself.
 *
 * `same-origin` and `none` are admitted by the belt, so they cannot appear on a
 * refusal line. They are in the vocabulary anyway because the classifier is total over
 * what a request can carry, and a vocabulary with holes in it invites a caller to fill
 * them with the raw header.
 */
export type BeltFetchSite =
  "absent" | "same-origin" | "same-site" | "cross-site" | "none" | "other";

/**
 * How the request's `Origin` header reads, relative to this app's own base URL.
 *
 * `null` is its own case rather than a mismatch, and it is the discriminating one.
 * `proxy.ts` sets `Referrer-Policy: no-referrer`, so a navigation POST from the
 * admin's own auth screens serializes its origin as the literal string `null`: that
 * beside `beltFetchSite: "absent"` is an honest browser too old for Fetch Metadata,
 * while `mismatch` is a request that named a foreign origin.
 *
 * `unverifiable` means `QCMS_ADMIN_BASE_URL` is unreadable, so there is nothing to
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
 * Every state-changing admin route the belt guards.
 *
 * Kept in step with the tree by `origin-belt-log.test.ts`, which reads
 * `apps/admin/app` from disk, finds every `route.ts` exporting a state-changing
 * handler, drops the segments Next does not put in a URL, and asserts each derived
 * template appears here and that nothing here has lost its handler. Adding a belted
 * route without adding it here is a failing test rather than a line reading
 * `"unrecognized"`.
 */
const BELTED_ROUTES: readonly BeltedRoute[] = [
  {
    // Task 041, and the first belted admin route to carry a dynamic segment - the
    // reason the docblock above insists this field is a template rather than a
    // pathname. One bounded segment for the form id, so `/forms/a/b/assist` is a
    // different route and not this one.
    route: "/forms/{formId}/assist",
    pattern: /^\/forms\/[^/]+\/assist\/?$/,
    outcome: "refused-403",
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

/**
 * The route templates {@link BELTED_ROUTES} recognises, for the disk-derived
 * enumeration test to compare against. Exported so that test can assert in **both**
 * directions: every state-changing route handler in `apps/admin/app` appears here, and
 * every entry here still corresponds to a handler on disk. One direction alone lets
 * the table rot (a deleted route leaves a stale entry) or lets a route go unrecognised
 * (a new route leaves a hole).
 */
export const BELTED_ROUTE_TEMPLATES: readonly Exclude<BeltRoute, "unrecognized">[] =
  BELTED_ROUTES.map((entry) => entry.route);

/**
 * The default outcome for a request whose path matches no belted route.
 *
 * The less specific of the two, because an unrecognised path is a gap in
 * {@link BELTED_ROUTES} rather than a fact about the response, and claiming the
 * staff member saw a failure message is the wrong half to guess. The enumeration test
 * exists so the gap never reaches a deployment.
 */
const UNRECOGNIZED_OUTCOME: BeltOutcome = "redirect-without-message";

const SPEC_FETCH_SITES = new Set(["same-origin", "same-site", "cross-site", "none"]);

/**
 * The pathname of an absolute URL, or `undefined` when it is not one.
 *
 * Total on purpose: `Request.url` is absolute in every runtime the admin runs in, but
 * a throw from a logging helper would become a 500 on a path whose whole job is to
 * refuse quietly, so an unparseable URL degrades to `"unrecognized"` instead.
 */
function pathnameOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/** The belted route this URL names, or `undefined` if it names none. */
function beltedRouteOf(url: string): BeltedRoute | undefined {
  const pathname = pathnameOf(url);
  if (pathname === undefined) return undefined;
  return BELTED_ROUTES.find((entry) => entry.pattern.test(pathname));
}

/** The path template of a request's URL, or `"unrecognized"` if it matches none. */
export function classifyRoute(url: string): BeltRoute {
  return beltedRouteOf(url)?.route ?? "unrecognized";
}

/** What a refusal on the route this URL names returns to the person who sent it. */
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
 * `warn` rather than `info`: a refusal is a request that did not happen, and on this
 * surface it may well be the first sign of a probe against the auth routes, so it has
 * to be separable from the ordinary call stream at a level filter - both for an
 * operator reading a support call and for a deployment that samples `info` away.
 */
export function logOriginBeltRefusal(request: Request): void {
  // Spread rather than passed through: `LogFields` is an index signature, and an
  // interface without one is not assignable to it. The spread keeps the four fields
  // named by a type at the point they are built, which is where it matters.
  serverLogger.warn(ORIGIN_BELT_REFUSED, { ...originBeltRefusal(request) });
}
