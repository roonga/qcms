import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAdminCsp } from "./csp";

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
  "frame-src 'none'; " +
  "worker-src 'self'; " +
  "manifest-src 'self'";

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

  it("grants the worker and the manifest this origin and no wider", () => {
    expect(buildAdminCsp("n1")).toContain("worker-src 'self'");
    expect(buildAdminCsp("n1")).toContain("manifest-src 'self'");
    expect(buildAdminCsp("n1")).not.toMatch(/(worker|manifest)-src [^;]*(\*|blob:|data:)/);
  });

  it("never grants 'unsafe-inline' to script, in either mode", () => {
    for (const mode of ["production", "development"]) {
      vi.stubEnv("NODE_ENV", mode);

      expect(buildAdminCsp("n1")).not.toContain("script-src 'self' 'unsafe-inline'");
    }
  });
});
