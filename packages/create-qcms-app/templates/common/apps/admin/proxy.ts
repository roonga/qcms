import { NextResponse, type NextRequest } from "next/server";

// Relative, not the `@/` alias: this module is unit-tested directly
// (`proxy.test.ts`) and Vitest resolves no Next path aliases.
import { buildAdminCsp } from "./lib/server/csp";
import { REQUEST_ID_HEADER, normalizeRequestId } from "./lib/server/request-id";

/**
 * Security headers for every admin response (task 031, SEC-9).
 *
 * Next 16 renamed this file convention from `middleware` to `proxy` (issue #32), and the
 * export name is part of the convention: the framework resolves `mod.proxy || mod.default`.
 *
 * ## The nonce chain
 *
 * A fresh nonce per request authorizes the inline scripts **Next itself** emits (the RSC
 * payload arrives as inline `self.__next_f.push(...)` calls), so `script-src` never needs
 * `'unsafe-inline'`. The mechanism is the same one the portal uses: the CSP goes on the
 * *request* headers via `NextResponse.next({ request: { headers } })` so the framework can
 * read the nonce and stamp its own scripts, and on the response so the browser enforces
 * it. Unlike the portal, the admin authors no inline script of its own, so no `x-nonce`
 * request header is set and no React component takes a nonce prop - which is why none of
 * issue #20's hydration-warning handling is needed here.
 *
 * ## This is not the authentication gate
 *
 * Deliberately. It runs before every request and could cheaply bounce a cookie-less
 * visitor, but it cannot answer the question that matters - does the session behind that
 * cookie exist, is it expired, has 2FA completed - without a database read. So the
 * authority is `lib/server/session.ts`, called from the authenticated route group's
 * layout, and this file does headers only. A cookie-presence check here would look like
 * security while being worth nothing (a forged cookie passes it), and would add a second
 * place to keep the route list in sync.
 *
 * `Referrer-Policy: no-referrer` matches the portal: admin URLs carry form and response
 * identifiers, and nothing should learn them from an outbound link.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const csp = buildAdminCsp(nonce);
  const requestId =
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Next reads the nonce from the request CSP header to stamp its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  // All routes except Next static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
