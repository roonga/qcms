import { TURNSTILE_ORIGIN } from "../turnstile";
import type { ChallengeProvider } from "./challenge";

/**
 * The Content-Security-Policy (SEC-9). The challenge origin's allowance is conditional
 * on the provider flag, and the per-request nonce is what lets `script-src` authorize
 * the inline theme bootstrap without `'unsafe-inline'`.
 *
 * `'unsafe-eval'` is added under `next dev` and nowhere else: that server compiles with
 * `eval`-based sourcemaps and its Fast Refresh client evaluates the modules it swaps in,
 * so without it the reload machinery loops instead of the page loading. `NODE_ENV` is the
 * whole condition, and a production policy is byte-identical to the one before it.
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
    `script-src 'self' 'nonce-${nonce}'${turnstile}${devScriptSrc()}`,
    `connect-src 'self'${turnstile}`,
    `frame-src${turnstile === "" ? " 'none'" : turnstile}`,
  ];
  return directives.join("; ");
}

/** Read per call rather than captured at import, so a test can state both policies. */
function devScriptSrc(): string {
  return process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
}
