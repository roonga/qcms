import { NextResponse, type NextRequest } from "next/server";

// Relative, not the `@/` alias: this module is unit-tested directly
// (`proxy.test.ts`) and Vitest resolves no Next path aliases.
import { challengeProvider } from "./lib/server/challenge";
import { buildCsp } from "./lib/server/csp";

/**
 * Security headers for every portal response (task 029). Sets a per-request CSP
 * (SEC-9) whose challenge-origin allowance is conditional on the challenge flag,
 * plus a nonce that authorizes the portal's own inline theme script and Next's
 * runtime scripts. Also carries the nonce forward on a request header so the root
 * layout can stamp it on the inline <script>.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy` (issue #32).
 * Under `proxy.ts` the framework resolves `mod.proxy || mod.default`, so the
 * export name is part of the convention, not cosmetic. Everything else is the
 * same code path: both conventions compile through the one middleware entrypoint
 * template and the same edge adapter, and the request-header override mechanism
 * `NextResponse.next({ request: { headers } })` uses (the `x-middleware-request-*`
 * / `x-middleware-override-headers` pair) has no proxy-versus-middleware branch.
 * That mechanism is what carries `x-nonce` to the root layout, so the nonce chain
 * is unchanged by the rename.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const csp = buildCsp(challengeProvider(), nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the nonce from the request CSP header to stamp its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
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
