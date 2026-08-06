import {
  ADMIN_SESSION_HEADER,
  INTERNAL_TOKEN_HEADER,
  adminBaseUrl,
  apiBaseUrl,
  internalToken,
} from "./config.ts";
import type { AdminSession } from "./session.ts";

/**
 * The strict BFF's one door to the API (task 031, R2; widened to auth traffic by
 * task 056).
 *
 * Every admin screen that needs questionnaire data goes through here, and what
 * happens here is exactly three things: attach the SEC-4 internal service token
 * (the channel credential), attach the signed-in admin's better-auth session token
 * (the user credential), and forward. No validation, no rule evaluation, no
 * business decision, no domain database access - the API is the sole authority for
 * all of that, and the admin app has no `@qcms/core` value import at all (enforced
 * by `r2-import-surface.test.ts`).
 *
 * The two credentials are separate on purpose (SEC-4): the internal token says
 * "this call came from a trusted app", the session token says "this admin made it".
 * The API's admin-auth middleware verifies the second against the database and
 * rejects a channel-token-only call `401`, so a compromised internal token alone
 * authorizes nothing.
 *
 * Since task 056 there are two doors rather than one, and they differ in exactly the
 * credential they can carry:
 *
 * - {@link adminApiFetch} calls the API's **`/admin` group** as a signed-in admin.
 *   Paths are relative to that group and nothing else, which is the mount-isolation
 *   contract from ADR-09 restated at the caller: the admin app never has a reason to
 *   reach a respondent route, so it cannot express one here.
 * - {@link authApiFetch} calls the API's **`/api/auth` group**, where better-auth now
 *   lives. There is no session token to attach - these are the calls that create one -
 *   so it carries the channel credential plus a curated slice of the browser's own
 *   request headers. `lib/server/auth-api.ts` is the only caller and wraps it per
 *   operation.
 *
 * Both stay in this module so the R2 audit's "the admin issues API requests from one
 * place" property keeps meaning what it says: a new screen (or a new auth step) cannot
 * forget a credential, because it never builds a request.
 */

/** A path under the API's `/admin` group, always leading-slashed. */
export type AdminApiPath = `/${string}`;

export interface AdminApiOptions {
  readonly method?: string;
  readonly body?: unknown;
  /** Extra request headers. Never used for credentials; those are added here. */
  readonly headers?: Record<string, string>;
  /** Passed through to `fetch`, so a server component can opt into caching. */
  readonly cache?: RequestCache;
}

/**
 * Call the API's `/admin` group as the signed-in admin. Returns the raw `Response`
 * so the caller decides how to read it: a screen parses JSON, an export streams
 * bytes through unchanged. Nothing is thrown for a non-2xx - status handling is the
 * caller's, because "404 means this form is gone" is a screen concern.
 */
export function adminApiFetch(
  session: AdminSession,
  path: AdminApiPath,
  options: AdminApiOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...options.headers,
    [INTERNAL_TOKEN_HEADER]: internalToken(),
    [ADMIN_SESSION_HEADER]: session.token,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${apiBaseUrl()}/admin${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    // Admin data is never cached by default: an author who just published expects
    // to see it. A caller that wants otherwise says so.
    cache: options.cache ?? "no-store",
  });
}

/** A path under the API's `/api/auth` group, always leading-slashed. */
export type AuthApiPath = `/${string}`;

/**
 * The browser request headers forwarded to better-auth, and nothing else (task 056).
 *
 * An allowlist rather than `new Headers(request.headers)`, for three separate reasons:
 *
 * - **`host` and `content-length` describe the wrong request.** They belong to the
 *   browser-to-admin hop, not the admin-to-API one, and forwarding them makes the
 *   second hop lie about itself. (`content-length` in particular: the forwarded body is
 *   JSON, the browser's was a form encoding of a different length.)
 * - **`cookie`, `origin` and the Fetch Metadata triplet are what better-auth reads.**
 *   The session and two-factor cookies are its credential store, and `origin` plus
 *   `sec-fetch-site`/`-mode`/`-dest` are its CSRF inputs - it blocks a cross-site
 *   navigation login on the metadata and validates the origin against
 *   `trustedOrigins`. Dropping the triplet would take a control away from it.
 * - **`x-forwarded-for` is what SEC-1's per-IP sign-in throttling keys on.** better-auth
 *   resolves the client address from it; dropping it would key every attempt in a
 *   deployment to the admin container's own address, collapsing per-IP backoff into one
 *   global bucket. It is passed through exactly as received, which is worth stating
 *   precisely because it is **not** a trustworthy value on its own: it is whatever
 *   arrived, so absent an ingress that *overwrites* the header rather than appending to
 *   it, a client can supply its own and shard the backoff into unlimited buckets.
 *   Forwarding it is therefore strictly better than dropping it and strictly weaker than
 *   a guarantee - the guarantee has to come from the deployment's proxy, and task 040
 *   owns verifying SEC-1 as a system rather than as this line.
 *
 * `user-agent` and `accept-language` ride along because better-auth records the former
 * on the session row and neither is a credential. Everything else is dropped.
 */
const FORWARDED_AUTH_HEADERS = [
  "cookie",
  "referer",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "user-agent",
  "accept-language",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
] as const;

/**
 * Resolve the `Origin` header for the forwarded request.
 *
 * **This app's own responses carry `Referrer-Policy: no-referrer`** (`lib/server/csp.ts`,
 * SEC-9), and a browser that is told not to send a referrer sends `Origin: null` on a
 * form POST as well - along with no `Referer` at all. So the origin better-auth would see
 * on every single legitimate no-JS sign-in is the literal string `null`, which it refuses
 * `403 MISSING_OR_NULL_ORIGIN`. Measured, not theorized: it is what the admin Playwright
 * suite reported the first time this hop ran.
 *
 * There are three ways out and only one of them is not a weakening:
 *
 * 1. Relax `Referrer-Policy` so the browser volunteers an origin. That trades a privacy
 *    header away to satisfy a library, and referrer leakage is exactly what an
 *    authoring tool full of form ids should not have.
 * 2. Set better-auth's `disableCSRFCheck`. That removes the check for *every* request,
 *    including one carrying a genuinely foreign origin.
 * 3. **Substitute this app's own origin when, and only when, the browser sent none.**
 *
 * Option 3 is what happens here, and it is an assertion of something already verified
 * rather than a bypass. Every handler that reaches an auth POST calls
 * `isSameOriginPost()` first and refuses otherwise, and that check is the *stronger* one
 * for this app precisely because it knows about the referrer policy: it reads
 * `sec-fetch-site` first and only falls back to `Origin`. A foreign origin is still
 * forwarded verbatim, so better-auth rejects it; the Fetch Metadata headers travel too,
 * so its cross-site-navigation block still fires. What the substitution removes is a
 * false negative, not a control.
 */
function forwardedOrigin(from: Headers): string {
  const browserOrigin = from.get("origin");
  if (browserOrigin !== null && browserOrigin !== "" && browserOrigin !== "null") {
    return browserOrigin;
  }
  return adminBaseUrl();
}

/**
 * Build the headers for one forwarded auth request. Exported for its unit test: the
 * allowlist and the origin substitution are security-relevant and cheap to assert
 * directly, and doing so needs no server.
 */
export function authRequestHeaders(from: Headers | undefined): Headers {
  const headers = new Headers({ [INTERNAL_TOKEN_HEADER]: internalToken() });
  if (from === undefined) return headers;
  for (const name of FORWARDED_AUTH_HEADERS) {
    const value = from.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("origin", forwardedOrigin(from));
  return headers;
}

export interface AuthApiOptions {
  readonly method?: "GET" | "POST";
  /** JSON body, serialized here. Omitted for a GET. */
  readonly body?: unknown;
  /** The incoming browser request whose headers are forwarded (see the allowlist). */
  readonly from?: Headers;
}

/**
 * Call the API's `/api/auth` group. Returns the raw `Response` - status, body and
 * `Set-Cookie` headers all - because that is precisely what the auth route handlers
 * need: they read the status to tell a refusal from a success, and they move the
 * cookies onto their own redirect so the browser's cookies stay first-party to the
 * admin origin.
 *
 * Nothing is thrown for a non-2xx. better-auth reports a wrong password, a wrong TOTP
 * code and a rate limit as 4xx responses, and each of those is a redirect the caller
 * chooses, not an exception (`route-helpers.ts` explains the trap this replaced).
 */
export function authApiFetch(path: AuthApiPath, options: AuthApiOptions = {}): Promise<Response> {
  const headers = authRequestHeaders(options.from);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return fetch(`${apiBaseUrl()}/api/auth${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    // A session read must never be served from a cache: it is the freshest fact in
    // the request.
    cache: "no-store",
  });
}
