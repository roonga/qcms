import { NextResponse, type NextRequest } from "next/server";

// Relative, not the `@/` alias: this module is unit-tested directly
// (`proxy.test.ts`) and Vitest resolves no Next path aliases.
import { buildAdminCsp } from "./lib/server/csp";

/**
 * Security headers for every admin response (task 031, SEC-9).
 *
 * Next 16 renamed this file convention from `middleware` to `proxy` (issue #32), and
 * the export name is part of the convention: the framework resolves
 * `mod.proxy || mod.default`.
 *
 * **This is not the authentication gate**, deliberately. It runs before every request
 * and could cheaply bounce a cookie-less visitor, but it cannot answer the question
 * that matters - does the session behind that cookie exist, is it expired, has 2FA
 * completed - without a database read. So the authority is
 * `lib/server/session.ts`, called from the authenticated route group's layout, and
 * this file does headers only. A cookie-presence check here would look like security
 * while being worth nothing (a forged cookie passes it), and would add a second place
 * to keep the route list in sync.
 *
 * `Referrer-Policy: no-referrer` matches the portal: admin URLs carry form and
 * response identifiers, and nothing should learn them from an outbound link.
 */
export function proxy(_request: NextRequest): NextResponse {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildAdminCsp());
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  // All routes except Next static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
