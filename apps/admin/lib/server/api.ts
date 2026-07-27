import {
  ADMIN_SESSION_HEADER,
  INTERNAL_TOKEN_HEADER,
  apiBaseUrl,
  internalToken,
} from "./config.ts";
import type { AdminSession } from "./session.ts";

/**
 * The strict BFF's one door to the API (task 031, R2).
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
 * Paths are relative to the API's **`/admin` group** and nothing else. That is the
 * mount-isolation contract from ADR-09 restated at the caller: the admin app never
 * has a reason to reach a respondent route, so it cannot express one here.
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
