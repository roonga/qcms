import { TURNSTILE_ORIGIN } from "../turnstile";
import type { ChallengeProvider } from "./challenge";

/**
 * Content-Security-Policy builder (SEC-9). Pure and unit-tested: the Turnstile
 * origin is present in `script-src` / `frame-src` / `connect-src` ONLY when the
 * challenge provider is `turnstile`. With the default `none` the CSP names no
 * challenge origin at all - the allowance is conditional on the flag.
 *
 * A per-request nonce authorizes the portal's own inline theme-bootstrap script
 * (and Next's runtime scripts), so `script-src` never needs `'unsafe-inline'`.
 * The portal is same-origin with its BFF and sends NO CORS headers (SEC).
 */
export function buildCsp(provider: ChallengeProvider, nonce: string): string {
  const turnstile = provider === "turnstile" ? ` ${TURNSTILE_ORIGIN}` : "";
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `img-src 'self' data:`,
    // Tailwind injects a stylesheet; 'unsafe-inline' for styles only (not script).
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'nonce-${nonce}'${turnstile}`,
    `connect-src 'self'${turnstile}`,
    `frame-src${turnstile === "" ? " 'none'" : turnstile}`,
  ];
  return directives.join("; ");
}
