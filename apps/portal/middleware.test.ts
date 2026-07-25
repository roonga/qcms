import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "./middleware";

/**
 * The nonce contract at its source (SEC-9, issue #20). The middleware is the ONLY
 * place a portal nonce is minted, and three properties make it a control rather
 * than decoration:
 *
 * 1. The value forwarded to SSR on `x-nonce` is the value the response CSP names.
 *    If they ever diverge, the root layout stamps a nonce the policy does not
 *    authorize and the inline theme script is blocked.
 * 2. It is unguessable and per request. A constant or predictable nonce is
 *    equivalent to `'unsafe-inline'` to anyone who can read one page.
 * 3. `script-src` names no `'unsafe-inline'` and no `'unsafe-eval'`, so the nonce
 *    is the only thing that can authorize inline script. This is the regression
 *    guard against "quiet the hydration warning by loosening the policy".
 *
 * `e2e/csp-nonce.pw.ts` proves the same chain end to end through a real browser.
 */

function runMiddleware(): { requestNonce: string | null; csp: string } {
  const request = new NextRequest("https://portal.example/f/demo");
  const response = middleware(request);
  return {
    // `NextResponse.next({ request: { headers } })` encodes the forwarded request
    // headers as an override header; read the nonce back through the same public
    // shape the framework hands to the route/layout.
    requestNonce: response.headers.get("x-middleware-request-x-nonce"),
    csp: response.headers.get("Content-Security-Policy") ?? "",
  };
}

function cspNonce(csp: string): string | undefined {
  return /script-src [^;]*'nonce-([^']+)'/.exec(csp)?.[1];
}

describe("portal security-header middleware", () => {
  it("forwards to SSR exactly the nonce its own CSP names", () => {
    const { requestNonce, csp } = runMiddleware();

    expect(requestNonce).not.toBeNull();
    expect(requestNonce).not.toBe("");
    expect(cspNonce(csp)).toBe(requestNonce);
  });

  it("mints an unguessable nonce per request", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const { requestNonce } = runMiddleware();
      // 16 random bytes, base64: 24 characters, never repeated across requests.
      expect(requestNonce).toHaveLength(24);
      seen.add(requestNonce ?? "");
    }
    expect(seen.size).toBe(25);
  });

  it("leaves the nonce as the only authorization for inline script", () => {
    const scriptSrc = /script-src ([^;]*)/.exec(runMiddleware().csp)?.[1] ?? "";

    expect(scriptSrc).toContain("'nonce-");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
