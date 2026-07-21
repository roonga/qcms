import { describe, expect, it } from "vitest";

import { TURNSTILE_ORIGIN } from "../turnstile";
import { buildCsp } from "./csp";

/**
 * SEC-9: the CSP's Turnstile-origin allowance is conditional on the challenge
 * flag. With the default provider `none` the CSP names no challenge origin at
 * all; only `turnstile` admits `challenges.cloudflare.com`.
 */
describe("content security policy", () => {
  it("names no challenge origin when the provider is none", () => {
    const csp = buildCsp("none", "abc123");
    expect(csp).not.toContain(TURNSTILE_ORIGIN);
    expect(csp).not.toContain("cloudflare");
    expect(csp).toContain("frame-src 'none'");
  });

  it("admits the Turnstile origin only when the provider is turnstile", () => {
    const csp = buildCsp("turnstile", "abc123");
    expect(csp).toContain(`script-src 'self' 'nonce-abc123' ${TURNSTILE_ORIGIN}`);
    expect(csp).toContain(`frame-src ${TURNSTILE_ORIGIN}`);
    expect(csp).toContain(`connect-src 'self' ${TURNSTILE_ORIGIN}`);
  });

  it("authorizes inline scripts by nonce, never by 'unsafe-inline'", () => {
    const csp = buildCsp("none", "nonce-value");
    expect(csp).toContain("'nonce-nonce-value'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
