import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

/**
 * The nonce contract at its source (SEC-9, issue #20). The proxy is the ONLY
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

function responseFor(headers?: HeadersInit): Response {
  const request = new NextRequest(
    "https://portal.example/f/demo",
    headers === undefined ? undefined : { headers },
  );
  return proxy(request);
}

function runProxy(headers?: HeadersInit): {
  requestNonce: string | null;
  csp: string;
  requestId: string | null;
  echoedRequestId: string | null;
} {
  const response = responseFor(headers);
  return {
    // `NextResponse.next({ request: { headers } })` encodes the forwarded request
    // headers as an override header; read the nonce back through the same public
    // shape the framework hands to the route/layout.
    requestNonce: response.headers.get("x-middleware-request-x-nonce"),
    csp: response.headers.get("Content-Security-Policy") ?? "",
    requestId: response.headers.get("x-middleware-request-x-request-id"),
    echoedRequestId: response.headers.get("x-request-id"),
  };
}

function cspNonce(csp: string): string | undefined {
  return /script-src [^;]*'nonce-([^']+)'/.exec(csp)?.[1];
}

describe("portal security-header proxy", () => {
  it("forwards to SSR exactly the nonce its own CSP names", () => {
    const { requestNonce, csp } = runProxy();

    expect(requestNonce).not.toBeNull();
    expect(requestNonce).not.toBe("");
    expect(cspNonce(csp)).toBe(requestNonce);
  });

  it("mints an unguessable nonce per request", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const { requestNonce } = runProxy();
      // 16 random bytes, base64: 24 characters, never repeated across requests.
      expect(requestNonce).toHaveLength(24);
      seen.add(requestNonce ?? "");
    }
    expect(seen.size).toBe(25);
  });

  /**
   * The correlation id (task 054, ADR-34 P5). The proxy is the single minting
   * point: one id per browser request, forwarded to SSR (where the BFF reads it
   * and puts it on its API calls) and echoed on the response so a respondent or
   * tester can quote it.
   */
  it("mints one x-request-id per request, forwards it to SSR, and echoes it", () => {
    const { requestId, echoedRequestId } = runProxy();

    expect(requestId).not.toBeNull();
    expect(requestId).toBe(echoedRequestId);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honours an inbound x-request-id rather than replacing it", () => {
    const { requestId, echoedRequestId } = runProxy({ "x-request-id": "caller-supplied-id" });

    expect(requestId).toBe("caller-supplied-id");
    expect(echoedRequestId).toBe("caller-supplied-id");
  });

  it("replaces an unusable inbound id (over the API's 200-character limit)", () => {
    const { requestId } = runProxy({ "x-request-id": "x".repeat(201) });

    expect(requestId).not.toBe("x".repeat(201));
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  /**
   * `Referrer-Policy: no-referrer`, which on THIS surface is a security control and
   * not only a privacy header (issue #555).
   *
   * Per Fetch, a form-navigation POST made under `no-referrer` serializes its
   * `Origin` as the literal string `null`. That is the entire reason the portal's
   * CSRF belt cannot tell an honest old browser apart from a forged request on the
   * no-JS form path, and therefore the reason it fails closed: see the reasoning in
   * `lib/server/route-helpers.ts` (`isSameOriginPost`), `docs/SECURITY_DESIGN.md` §5,
   * and the operator runbook in `docs/operations.md`.
   *
   * So a reader who changes this value for privacy reasons is changing what a
   * security control observes, and two things would follow with nothing going red:
   * the privacy property is lost quietly, and the documented premise that `Origin`
   * arrives as `null` becomes false. The admin and the API both pin the same value
   * (`apps/admin/proxy.test.ts`, `apps/api/e2e/security/02-transport-and-limits.e2e.ts`);
   * the portal was the one surface asserting nothing, and the one where the value is
   * load-bearing.
   */
  it("sets Referrer-Policy: no-referrer, which the no-JS CSRF belt reads", () => {
    const response = responseFor();

    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    // The other two hardening headers alongside it, so the whole set is pinned in
    // one place rather than one header having its own private test.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("leaves the nonce as the only authorization for inline script", () => {
    const scriptSrc = /script-src ([^;]*)/.exec(runProxy().csp)?.[1] ?? "";

    expect(scriptSrc).toContain("'nonce-");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
