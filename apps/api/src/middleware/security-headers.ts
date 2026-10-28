/**
 * No CORS header is emitted here or anywhere in `apps/api`: under the BFF pattern no
 * cross-origin caller exists, so the absence is a control rather than an oversight
 * (SEC-9).
 */

import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../openapi.js";

/**
 * `'none'` rather than `'self'` throughout: the API serves JSON and CSV and never a
 * document, so there is nothing for any of these to permit.
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
 * Applied above the mounted groups so an unauthenticated refusal carries the headers
 * too: a 401 is still a response a browser might render (SEC-9).
 */
export function securityHeaders(): MiddlewareHandler<ApiEnv> {
  return secureHeaders({
    contentSecurityPolicy: apiCsp(),
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    xContentTypeOptions: true,
    // Owned by the ingress (ADR-20), the only hop that terminates TLS.
    strictTransportSecurity: false,
    // `secureHeaders` is typed `MiddlewareHandler<any>`; the cast only narrows the generic
    // parameter. Emitted headers are pinned by `02-transport-and-limits.e2e.ts`.
  }) as MiddlewareHandler<ApiEnv>;
}
