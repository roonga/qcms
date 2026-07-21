import { NextResponse, type NextRequest } from "next/server";

import { challengeProvider } from "@/lib/server/challenge";
import { buildCsp } from "@/lib/server/csp";

/**
 * Security headers for every portal response (task 029). Sets a per-request CSP
 * (SEC-9) whose challenge-origin allowance is conditional on the challenge flag,
 * plus a nonce that authorizes the portal's own inline theme script and Next's
 * runtime scripts. Also carries the nonce forward on a request header so the root
 * layout can stamp it on the inline <script>.
 */
export function middleware(request: NextRequest): NextResponse {
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
