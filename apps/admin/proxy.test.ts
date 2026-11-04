import { describe, expect, it } from "vitest";

import { buildAdminCsp } from "./lib/server/csp";
import { config, proxy } from "./proxy";

const NONCE = "dGVzdC1ub25jZS0xMjM0NTY3OA==";

function responseFor(url = "http://localhost:7040/questions"): NextLikeResponse {
  return proxy(new Request(url) as never);
}

type NextLikeResponse = ReturnType<typeof proxy>;

function cspOf(response: NextLikeResponse): string {
  return response.headers.get("content-security-policy") ?? "";
}

describe("admin CSP (SEC-9)", () => {
  const csp = buildAdminCsp(NONCE);

  it("locks the document down to its own origin", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("allows form posts to this origin only (state changes are same-origin forms)", () => {
    expect(csp).toContain("form-action 'self'");
  });

  it("authorizes inline script by nonce only, never by unsafe-inline or eval", () => {
    expect(csp).toContain(`script-src 'self' 'nonce-${NONCE}'`);
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("grants unsafe-inline to styles only (Tailwind injects a stylesheet)", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("allows data: images for the inline enrollment QR code and nothing remote", () => {
    expect(csp).toContain("img-src 'self' data:");
  });

  it("names no third-party origin at all", () => {
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https?:\/\//);
  });
});

describe("admin security headers", () => {
  it("sets the CSP plus the three hardening headers on every response", () => {
    const response = responseFor();
    expect(cspOf(response)).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("issues a fresh nonce per request", () => {
    expect(cspOf(responseFor())).not.toBe(cspOf(responseFor()));
  });

  it("sets no CORS header, ever (SEC: the BFF pattern eliminates CORS)", () => {
    const response = responseFor();
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers",
    ]) {
      expect(response.headers.get(name)).toBeNull();
    }
  });

  it("covers the auth screens too, not just the authenticated shell", () => {
    expect(cspOf(responseFor("http://localhost:7040/sign-in"))).toContain("default-src 'self'");
  });

  it("matches every route except Next's static assets", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });
});
