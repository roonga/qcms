import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
   * `Referrer-Policy: same-origin`, pinned because two mechanisms read it and neither
   * would go red if it moved (issue #555, then the Code Owner's ruling of 2026-10-01).
   *
   * The portal sent `no-referrer` until task 073. It was **widened to `same-origin` for
   * the `__qop` Server Action**: per Fetch, a form-navigation POST under `no-referrer`
   * serializes its `Origin` as the literal `null`, and Next's action handler compares
   * `Origin` to the `Host` and refuses `null` outright, so the no-JS Add and Remove of a
   * repeating group died in the framework before any QCMS code ran.
   * `serverActions.allowedOrigins: ['null']` would have admitted every null-origin POST
   * from anywhere and was refused.
   *
   * So the value is pinned against movement in both directions:
   *
   * - **back to `no-referrer`** and the `__qop` action breaks again, with a framework
   *   error rather than a QCMS one;
   * - **wider than `same-origin`** (`origin`, `strict-origin-when-cross-origin`, or
   *   nothing) and the portal starts leaking `/s/{sessionId}` URLs cross-origin, to
   *   Turnstile and to any outbound link a form's help text carries.
   *
   * `same-origin` itself gives up nothing to a third party: a cross-origin request
   * still receives no `Referer` at all (Referrer Policy section 3.3). What a
   * same-origin request now carries is the submitting page's own URL, which is already
   * in that request's own path.
   *
   * **The admin and the API deliberately keep `no-referrer`** (`apps/admin/proxy.test.ts`,
   * `apps/api/e2e/security/02-transport-and-limits.e2e.ts`): neither has a Server Action
   * reachable without scripting, admin URLs carry form and response identifiers, and the
   * admin's own belt reasoning depends on its form posts arriving with `Origin: null`.
   */
  it("sets Referrer-Policy: same-origin, which Next's Server Action check requires", () => {
    const response = responseFor();

    expect(response.headers.get("referrer-policy")).toBe("same-origin");
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

/**
 * The environment's address, resolved and stripped in the one place (ADR-40, Q21, SEC-14,
 * task 066).
 *
 * Every assertion reads the framework's own public shape for a rewrite: the `Location`
 * (`x-middleware-rewrite`) and the request-header override pair. A test that reached
 * inside the response object would be asserting against an implementation detail of the
 * edge adapter rather than against the contract the route tree sees.
 */
describe("the environment prefix (task 066)", () => {
  const ENVIRONMENT_HEADER = "x-middleware-request-x-qcms-environment";
  const REWRITE = "x-middleware-rewrite";

  function at(url: string, headers?: HeadersInit): Response {
    return proxy(new NextRequest(url, headers === undefined ? undefined : { headers }));
  }

  it("leaves a prod address alone and names prod on the request", () => {
    const response = at("https://portal.example/s/ses_1");
    expect(response.headers.get(REWRITE)).toBeNull();
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("prod");
  });

  it("strips a configured environment's prefix and names it on the request", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    const response = at("https://portal.example/test/s/ses_1?step=2");
    // Rewritten to the one route tree, with the query intact: there is one
    // `/s/[sessionId]` and not one per environment, so a new respondent screen cannot
    // forget to exist in `test`.
    expect(response.headers.get(REWRITE)).toBe("https://portal.example/s/ses_1?step=2");
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("test");
  });

  it("does not honour an environment header a client sent", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    const response = at("https://portal.example/s/ses_1", { "x-qcms-environment": "test" });
    // The address names the environment and nothing else does (Q21). A respondent who
    // sends a header of their own is served `prod`, which is the address they used.
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("prod");
  });

  it("leaves an unconfigured first segment to the route tree's own 404", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    const response = at("https://portal.example/staging/s/ses_1");
    // Nothing is stripped, so no route matches `/staging/s/ses_1` and Next answers 404.
    // An environment this deployment does not serve has no addresses, which is the
    // fail-closed direction.
    expect(response.headers.get(REWRITE)).toBeNull();
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("prod");
  });

  it("filters `prod` out of the configured set, so `/prod/...` is not an address", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "prod,test");
    const response = at("https://portal.example/prod/s/ses_1");
    expect(response.headers.get(REWRITE)).toBeNull();
  });

  it("serves no anonymous entry under a prefix (criterion 3)", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    const response = at("https://portal.example/test/f/demo");
    // Rewritten to a path no route matches, so the answer is Next's own 404 and not a
    // 403 a handler composed (ADR-09). `/<env>/f/{slug}` does not exist.
    expect(response.headers.get(REWRITE)).toBe("https://portal.example/qcms-no-such-route");
  });

  it("serves no anonymous entry on a host reserved for a non-prod environment (SEC-14)", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENT_HOSTS", "test=test-forms.example");
    const response = at("https://test-forms.example/f/demo", { host: "test-forms.example" });
    // The public anonymous door does not exist on the restricted hostname, which is the
    // handle a network-layer rule and a DNS split act on. Both handles hold
    // independently: this one fires on the unprefixed address.
    expect(response.headers.get(REWRITE)).toBe("https://test-forms.example/qcms-no-such-route");
  });

  it("still serves a secure link on that host, which is the only door it has", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENT_HOSTS", "test=test-forms.example");
    const response = at("https://test-forms.example/test/l/a-token", {
      host: "test-forms.example",
    });
    expect(response.headers.get(REWRITE)).toBe("https://test-forms.example/l/a-token");
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("test");
  });

  it("leaves the prefixed path working on the public host, because the two handles are independent", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENT_HOSTS", "test=test-forms.example");
    const response = at("https://portal.example/test/l/a-token", { host: "portal.example" });
    // A path rule has to survive a wildcard certificate or a hostname somebody
    // consolidated onto (Q21), so the host map restricts the anonymous door and does not
    // confine the prefix.
    expect(response.headers.get(REWRITE)).toBe("https://portal.example/l/a-token");
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("test");
  });
});
