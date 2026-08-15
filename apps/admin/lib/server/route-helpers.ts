import { adminBaseUrl } from "./config.ts";

/**
 * Shared plumbing for the admin's auth route handlers (task 031).
 *
 * The auth screens are plain `<form method="post">` posting to these handlers
 * rather than client-side fetches or server actions, and that is a deliberate
 * choice with three payoffs: the whole sign-in / 2FA loop works before (or without)
 * hydration, the credential never passes through client JavaScript, and each step
 * is an ordinary HTTP request a test or a curl can drive. It also keeps R2 honest -
 * a route handler that does sessions and credentials is exactly what a BFF is for.
 */

/**
 * A form POST's redirect. **303 See Other**, not 302: it tells the browser to
 * follow with GET, so the address bar lands on a real page and a reload does not
 * re-submit the credential. The `Location` is always an app-relative path, never
 * anything derived from the request, so no open redirect is possible.
 */
export function redirectAfterPost(
  path: `/${string}`,
  setCookies: readonly string[] = [],
): Response {
  const headers = new Headers({ location: path });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * Whether a better-auth call refused the request.
 *
 * This exists because of a trap that cost a debugging cycle: `asResponse: true` changes
 * better-auth's **error channel**, not just its return shape. Without it a rejected call
 * throws an `APIError`; with it, the same rejection comes back as an ordinary `Response`
 * carrying a 4xx status, and nothing throws. A handler that only caught `APIError`
 * therefore treated "wrong TOTP code" as success and fell through to its
 * cookie-inspection branch, which redirected to "your session expired" - a wrong message
 * for a wrong code, arrived at via three redirects.
 *
 * So every call site checks the status explicitly. The `catch (APIError)` blocks stay as
 * well, because the calls made *without* `asResponse` (`enableTwoFactor`) still throw.
 */
export function authRefused(response: Response): boolean {
  return !response.ok;
}

/** True when the refusal was rate limiting, the one failure worth its own message. */
export function authThrottled(response: Response): boolean {
  return response.status === 429;
}

/**
 * Carry better-auth's `Set-Cookie` headers onto our own response.
 *
 * The library's `auth.api.*` calls are asked for `asResponse: true` so that they
 * emit real cookie headers (session issued, two-factor challenge opened, session
 * cleared). Those responses are not what we send to the browser - we send a
 * redirect - so the cookies have to be moved across. `getSetCookie()` is the only
 * correct reader here: `Headers.get("set-cookie")` folds multiple cookies into one
 * comma-joined string that no browser parses back into separate cookies, and
 * sign-out emits three at once.
 */
export function cookiesFrom(response: Response): string[] {
  return response.headers.getSetCookie();
}

/**
 * Reject a cross-site state-changing request (SEC-9's CSRF belt).
 *
 * `SameSite=Lax` on the session cookie is the primary control and it already
 * blocks a cross-site POST from carrying the cookie. This is the second layer for
 * clients that do not enforce it: a state-changing request must either declare a
 * same-origin `Sec-Fetch-Site` or carry an `Origin` matching this app's own base
 * URL. A request with neither header is refused rather than assumed friendly.
 *
 * Returns `true` when the request may proceed.
 *
 * **The header order is not a preference, and the `Origin` branch is not merely a
 * fallback for old clients.** `proxy.ts` sets `Referrer-Policy: no-referrer`, and per
 * Fetch a navigation POST (which is what every auth screen's `<form method="post">`
 * is) serializes its `Origin` as the literal string `null` under that policy. So on
 * this app's own form path a current browser sends `Origin: null` and the comparison
 * below can never match: `Sec-Fetch-Site` is the header actually doing the work.
 * Reading them the other way round answers 403 to 100% of legitimate sign-ins, which
 * is what happened in 031 (`docs/RETRO.md`) and cost a browser run plus a debug run
 * to diagnose, because this comment did not say so. The `Origin` branch stays live
 * for Fetch API calls, which are mode `cors` and so keep their real origin.
 * (Spelled without the parentheses on purpose: `r2-import-surface.test.ts` regexes
 * this file's raw text for a call to the global, comments included.)
 *
 * ## Twin
 *
 * `apps/portal/lib/server/route-helpers.ts` carries the same function over
 * `portalBaseUrl()` (issue #487). It is a copy for the reason `config.ts` gives:
 * there is no shared package for a Next BFF's server code. What keeps the two from
 * drifting is `scripts/check-origin-guards.test.ts`, which derives both apps'
 * state-changing route handlers from disk and asserts each one calls this function
 * by name.
 */
export function isSameOriginPost(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return origin === adminBaseUrl();
}

/** A single trimmed form field, or `undefined` when absent or blank. */
export function formField(form: FormData, name: string): string | undefined {
  const raw = form.get(name);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The generic failure redirect. Auth failures are reported by an opaque marker in
 * the query string (`?error=1`), never by a message from the library: SEC-1
 * requires the same response for an unknown email and a wrong password, and an
 * error string travelling through a URL is exactly how a distinguishable message
 * leaks. The page turns the marker into one fixed sentence.
 */
export function redirectWithGenericFailure(
  path: `/${string}`,
  marker: "error" | "throttled" = "error",
): Response {
  return redirectAfterPost(`${path}?${marker}=1`);
}
