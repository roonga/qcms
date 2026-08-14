/**
 * Response security headers for the API (SEC-9, task 040).
 *
 * `docs/SECURITY_DESIGN.md` §5 lists CSP, `X-Content-Type-Options: nosniff`,
 * `Referrer-Policy` and `frame-ancestors 'none'` for "both Next apps + API" and
 * marked them delivered by 017. Both Next apps set them in their proxies; the
 * API set none of them (issue #471). 040's job is to reconcile the document with
 * the software, and here the software is what moves: the headers are cheap, they
 * are already the house policy in the two apps, and a claim in the security
 * design that a reader cannot check is worse than the header being absent.
 *
 * The practical exposure this closes is small and should be stated honestly: the
 * API container publishes no port and no ingress recipe routes it (ADR-20), so
 * no browser reaches these responses in a stock deployment. It is defense in
 * depth for the deployment that does route it, and for the operator who curls it
 * from a browser-adjacent tool.
 *
 * Three deliberate choices:
 *
 * - **No HSTS.** SEC-9 and ADR-20 put `Strict-Transport-Security` at the
 *   operator's ingress, which is the only hop that terminates TLS. Emitting it
 *   from a service that is only ever spoken to over private-network HTTP would
 *   be a claim the process cannot keep, so `strictTransportSecurity` is off and
 *   `docker/Caddyfile` remains the single emitter.
 * - **`default-src 'none'`, not `'self'`.** The API serves JSON and CSV and
 *   never HTML: it has no scripts, styles, images or frames to allow. The
 *   strictest policy is also the accurate one, and it satisfies §5's "no
 *   unsafe-inline" by containing no source list that could carry it.
 * - **No CORS headers, ever.** Nothing here adds one, and nothing anywhere in
 *   `apps/api` imports Hono's `cors` middleware. The BFF pattern means no
 *   cross-origin caller exists (§5), so the absence is a control rather than an
 *   oversight, and `e2e/security/02-transport-and-limits.e2e.ts` asserts it.
 */

import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../openapi.js";

/**
 * The CSP for a JSON API. `frame-ancestors 'none'` is the §5 requirement;
 * `base-uri` and `form-action` are set to `'none'` for the same reason
 * `default-src` is: there is no document here for them to constrain, so the
 * honest value is "nothing is permitted".
 */
function apiCsp(): {
  defaultSrc: string[];
  frameAncestors: string[];
  baseUri: string[];
  formAction: string[];
} {
  return {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  };
}

/**
 * Install the SEC-9 response headers on every API response, health included.
 * Applied above the mounted groups so an unauthenticated refusal carries them
 * too: a 401 is still a response a browser might render.
 */
export function securityHeaders(): MiddlewareHandler<ApiEnv> {
  return secureHeaders({
    contentSecurityPolicy: apiCsp(),
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    xContentTypeOptions: true,
    // Owned by the ingress (ADR-20); see the module comment.
    strictTransportSecurity: false,
  }) as MiddlewareHandler<ApiEnv>;
}
