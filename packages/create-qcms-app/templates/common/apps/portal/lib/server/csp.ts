import { TURNSTILE_ORIGIN } from "../turnstile";
import type { ChallengeProvider } from "./challenge";

/**
 * The Content-Security-Policy (SEC-9). The challenge origin's allowance is conditional
 * on the provider flag, and the per-request nonce is what lets `script-src` authorize
 * the inline theme bootstrap without `'unsafe-inline'`.
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
    // `'unsafe-inline'` for styles only, never script: Tailwind injects a stylesheet.
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'nonce-${nonce}'${turnstile}`,
    `connect-src 'self'${turnstile}`,
    `frame-src${turnstile === "" ? " 'none'" : turnstile}`,
  ];
  return directives.join("; ");
}
