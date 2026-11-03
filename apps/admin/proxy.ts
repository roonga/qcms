import { NextResponse, type NextRequest } from "next/server";

// Relative, not the `@/` alias: this module is unit-tested directly
// (`proxy.test.ts`) and Vitest resolves no Next path aliases.
import { buildAdminCsp } from "./lib/server/csp";
import { REQUEST_ID_HEADER, normalizeRequestId } from "./lib/server/request-id";

/** Next reads the request CSP to nonce its scripts; browsers enforce the response CSP. */
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
