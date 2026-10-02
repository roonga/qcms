import { NextResponse, type NextRequest } from "next/server";

// Relative, not the `@/` alias: this module is unit-tested directly
// (`proxy.test.ts`) and Vitest resolves no Next path aliases.
import { challengeProvider } from "./lib/server/challenge";
import { buildCsp } from "./lib/server/csp";
import { REQUEST_ID_HEADER, normalizeRequestId } from "./lib/server/request-id";

/**
 * Security headers for every portal response (task 029). Sets a per-request CSP
 * (SEC-9) whose challenge-origin allowance is conditional on the challenge flag,
 * plus a nonce that authorizes the portal's own inline theme script and Next's
 * runtime scripts. Also carries the nonce forward on a request header so the root
 * layout can stamp it on the inline <script>.
 *
 * Since task 054 it is also the single minting point for `x-request-id` (ADR-34
 * P5): one id per browser request, honoured if the caller supplied one, forwarded
 * to SSR and to the BFF's API calls (which is how the API comes to log the same
 * id), and echoed on the response so a respondent or tester can quote it. It uses
 * the same request-header override mechanism as the nonce, for the same reason.
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

  const requestId =
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Next reads the nonce from the request CSP header to stamp its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  // `same-origin` and not `no-referrer`, and on THIS surface the difference is a
  // mechanism rather than a privacy preference (Code Owner, 2026-10-01, SEC-9 as
  // amended; task 073).
  //
  // The no-JS Add and Remove of a repeating group is a **Next Server Action** on the
  // step form (ADR-43 as amended): the action runs and the page re-renders in the same
  // 200 response, which is what carries the respondent's typed values back with no
  // cookie and no redirect. Next's action handler checks the request's `Origin`
  // against the `Host` (or `X-Forwarded-Host`) itself, and under `no-referrer` a
  // navigation POST serializes its `Origin` as the literal string `null` (Fetch), which
  // Next compares to the host and refuses with `Invalid Server Actions request`. So
  // under the old value the no-JS roster operation was aborted by the framework before
  // any QCMS code ran, and the only in-framework relief,
  // `serverActions.allowedOrigins: ['null']`, would admit EVERY null-origin POST,
  // including a cross-site one from any page that declares `no-referrer` on itself.
  // That was refused.
  //
  // `same-origin` sends a referrer to same-origin requests and none cross-origin, so
  // nothing a third party can see changes: Turnstile and any outbound link still get no
  // `Referer`. What same-origin requests now carry is this page's own URL, which is
  // already in those requests' own paths (`/s/{sessionId}` posting to
  // `/s/{sessionId}/step`), and secure-link entry never renders: `/l/{token}` is a GET
  // that answers 303, so the token cannot become a `Referer`.
  //
  // **The admin and the API keep `no-referrer`**, which is why this is set here rather
  // than shared: neither has a Server Action on a no-JS path, and the admin's own belt
  // reasoning depends on its form posts arriving with `Origin: null`.
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  // All routes except Next static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
