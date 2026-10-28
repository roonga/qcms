import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

import { proxy } from "./proxy";

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
      expect(requestNonce).toHaveLength(24);
      seen.add(requestNonce ?? "");
    }
    expect(seen.size).toBe(25);
  });

  /**
   * The proxy is the single minting point for the correlation id (ADR-34 P5): one per
   * browser request, forwarded to SSR and echoed on the response so it can be quoted.
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

  it("sets Referrer-Policy: same-origin, which Next's Server Action check requires", () => {
    const response = responseFor();

    expect(response.headers.get("referrer-policy")).toBe("same-origin");
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
    expect(response.headers.get(REWRITE)).toBe("https://portal.example/s/ses_1?step=2");
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("test");
  });

  it("does not honour an environment header a client sent", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    const response = at("https://portal.example/s/ses_1", { "x-qcms-environment": "test" });
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("prod");
  });

  it("leaves an unconfigured first segment to the route tree's own 404", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    const response = at("https://portal.example/staging/s/ses_1");
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
    expect(response.headers.get(REWRITE)).toBe("https://portal.example/qcms-no-such-route");
  });

  it("serves no anonymous entry on a host reserved for a non-prod environment (SEC-14)", () => {
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENTS", "test");
    vi.stubEnv("QCMS_PORTAL_ENVIRONMENT_HOSTS", "test=test-forms.example");
    const response = at("https://test-forms.example/f/demo", { host: "test-forms.example" });
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
    expect(response.headers.get(REWRITE)).toBe("https://portal.example/l/a-token");
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("test");
  });
});
