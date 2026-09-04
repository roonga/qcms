/**
 * Public Turnstile constant (safe for the client bundle). Kept out of
 * `lib/server/` so the client widget can reference the origin without pulling a
 * server-only module across the R2 boundary.
 */

/** The Cloudflare Turnstile origin the widget script + iframe are served from. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
