import { describe, expect, it } from "vitest";

import { buildAdminCsp } from "./lib/server/csp";
import { config, proxy } from "./proxy";

/**
 * Security-header tests for the admin's proxy (task 031, SEC-9).
 *
 * The assertions are about *absences* as much as presences, because that is where this
 * class of header fails: a CSP that allows one extra origin, a policy that quietly
 * gains `unsafe-eval`, or a CORS header appearing because a library added it.
 */

function headersFor(url = "http://localhost:3200/questions"): Headers {
  // `proxy` only reads the request to pass it through, so a plain Request is enough;
  // NextRequest's extra surface is unused here.
  return proxy(new Request(url) as never).headers;
}

describe("admin CSP (SEC-9)", () => {
  const csp = buildAdminCsp();

  it("locks the document down to its own origin", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("allows form posts to this origin only (state changes are same-origin forms)", () => {
    expect(csp).toContain("form-action 'self'");
  });

  it("never grants script any inline or eval allowance", () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    // No nonce, deliberately: the admin ships no inline script of its own, so the
    // stronger policy is available and taken. A nonce appearing here would mean an
    // inline script was added without revisiting this decision.
    expect(csp).not.toContain("nonce-");
  });

  it("allows data: images for the inline enrollment QR code and nothing remote", () => {
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toContain("https:");
  });

  it("names no third-party origin at all", () => {
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https?:\/\//);
  });
});

describe("admin security headers", () => {
  it("sets the CSP plus the three hardening headers on every response", () => {
    const headers = headersFor();
    expect(headers.get("content-security-policy")).toBe(buildAdminCsp());
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("sets no CORS header, ever (SEC: the BFF pattern eliminates CORS)", () => {
    const headers = headersFor();
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers",
    ]) {
      expect(headers.get(name)).toBeNull();
    }
  });

  it("covers the auth screens too, not just the authenticated shell", () => {
    // A matcher that skipped `/sign-in` would ship the one page that handles a
    // credential without a CSP.
    expect(headersFor("http://localhost:3200/sign-in").get("content-security-policy")).toBe(
      buildAdminCsp(),
    );
  });

  it("matches every route except Next's static assets", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });
});
