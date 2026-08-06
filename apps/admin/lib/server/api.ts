import {
  ADMIN_SESSION_HEADER,
  INTERNAL_TOKEN_HEADER,
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
 *   second hop lie about itself.
 * - **`cookie` and `origin` are the two better-auth genuinely reads.** The session and
 *   two-factor cookies are its credential store, and `origin` is what its CSRF check
 *   compares against `trustedOrigins` (the admin's public origin).
 * - **`x-forwarded-for` keeps SEC-1's per-IP sign-in throttling honest.** better-auth
 *   resolves the client address from it; dropping it would key every attempt in a
 *   deployment to the admin container's own address, quietly collapsing per-IP backoff
 *   into one global bucket. It is passed through exactly as received rather than
 *   appended to, so the value is still the ingress's statement about the client and
 *   nothing is invented here.
 *
 * `user-agent` and `accept-language` ride along because better-auth records the former
 * on the session row and neither is a credential. Everything else is dropped.
 */
const FORWARDED_AUTH_HEADERS = [
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "accept-language",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
] as const;

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
  const headers = new Headers({ [INTERNAL_TOKEN_HEADER]: internalToken() });
  const from = options.from;
  if (from !== undefined) {
    for (const name of FORWARDED_AUTH_HEADERS) {
      const value = from.get(name);
      if (value !== null) headers.set(name, value);
    }
  }
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
