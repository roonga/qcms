import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAdminCsp } from "./csp";

/**
 * SEC-9, and the one conditional the admin's policy has: `'unsafe-eval'` under `next dev`
 * and nowhere else. The production string is stated in full rather than probed, because
 * what has to hold is that no deployed policy changed at all.
 */
const PRODUCTION =
  "default-src 'self'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "img-src 'self' data:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'nonce-n1'; " +
  "connect-src 'self'; " +
  "frame-src 'none'";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the admin content security policy", () => {
  it("is byte-identical to the production policy outside development", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(buildAdminCsp("n1")).toBe(PRODUCTION);
  });

  it("adds 'unsafe-eval' to script-src, and only that, under next dev", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(buildAdminCsp("n1")).toBe(
      PRODUCTION.replace(
        "script-src 'self' 'nonce-n1'",
        "script-src 'self' 'nonce-n1' 'unsafe-eval'",
      ),
    );
  });

  it("never grants 'unsafe-inline' to script, in either mode", () => {
    for (const mode of ["production", "development"]) {
      vi.stubEnv("NODE_ENV", mode);

      expect(buildAdminCsp("n1")).not.toContain("script-src 'self' 'unsafe-inline'");
    }
  });
});
