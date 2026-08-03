/**
 * Server-only BFF configuration (task 029). These values are read from the
 * environment at request time and MUST never reach the client bundle: the
 * internal API base URL and the SEC-4 internal service token are server secrets.
 * Nothing here is imported by a client component (enforced by the R2
 * import-surface test).
 */

/** The name of the httpOnly cookie that holds the respondent's session bearer token. */
export const SESSION_COOKIE = "qcms_session";

/** The SEC-4 internal-token header the API requires on every call. */
export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required server env var ${name}`);
  }
  return value;
}

/** The internal API base URL (server-only). No trailing slash. */
export function apiBaseUrl(): string {
  let base = required("QCMS_API_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/** The SEC-4 internal service token presented to the API (server-only). */
export function internalToken(): string {
  return required("QCMS_INTERNAL_TOKEN");
}

/** Public portal origin used for redirects produced inside the container. */
export function portalBaseUrl(): string {
  let base = required("QCMS_PORTAL_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/**
 * Whether browser cookies must carry the Secure attribute.
 *
 * Production is the safe default. Compose's documented localhost profile is the
 * deliberate exception: browsers never return Secure cookies over plain HTTP,
 * so its portal could create a session but could not resume it after Start.
 */
export function isProduction(): boolean {
  const configured = process.env.QCMS_SECURE_COOKIES;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}
