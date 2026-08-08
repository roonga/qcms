import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSecureCookiesConfigured, secureCookies } from "./config.ts";

/**
 * The admin's cookie-security configuration (task 056, guarded for issue #292).
 *
 * `vi.stubEnv` rather than assignment: `NODE_ENV` is typed read-only by Next's ambient
 * types, and stubbing restores every variable in one call whichever way a case ends.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("secureCookies", () => {
  it("honours the override whatever NODE_ENV says", () => {
    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(true);

    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(false);
  });

  it("falls back to NODE_ENV when the override is unset or blank", () => {
    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(false);

    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "  ");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
  });

  it("accepts the API's boolean spellings, so the two processes cannot disagree", () => {
    for (const raw of ["on", "1", "yes", "TRUE"]) {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(true);
    }
    for (const raw of ["off", "0", "no", "FALSE"]) {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(false);
    }
  });

  it("refuses a value that is not a boolean at all", () => {
    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "maybe");
    expect(() => secureCookies()).toThrow(/QCMS_ADMIN_SECURE_COOKIES/);
  });
});

/**
 * The boot-time refusal (issue #292 point 1).
 *
 * **This matrix is paired with `apps/portal/lib/server/config.test.ts`.** The two apps
 * disagreeing about exactly this decision is what the issue was filed about, so the same
 * cases are asserted on both sides and a change made to one and not the other goes red.
 *
 * The positive controls come first on purpose: a red then distinguishes "the refusal
 * broke" from "the fixture was never a configuration that boots".
 */
describe("assertSecureCookiesConfigured", () => {
  describe("permits the configurations it exists to allow", () => {
    it("passes the shape .env.compose.example ships: override unset, browsed at http://localhost", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "http://localhost:7040");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes a plain dev server: no override, NODE_ENV development, loopback origin", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "http://localhost:7042");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it.each([
      "http://127.0.0.1:7040",
      "http://127.0.0.53:7040",
      "http://[::1]:7040",
      "http://admin.localhost:7040",
      "https://localhost:7040",
    ])("passes the loopback origin %s", (base) => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes any origin at all once Secure is on", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "true");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes when the base URL is absent or unparseable, which is a different defect", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", undefined);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "admin.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });
  });

  describe("refuses the downgrade off loopback", () => {
    it.each([
      "https://admin.example.test",
      "http://admin.example.test",
      "http://192.168.1.10:7040",
      "http://0.0.0.0:7040",
      // A name that merely CONTAINS localhost is not loopback, and an attacker-chosen
      // hostname is exactly where a sloppy substring check would let the downgrade out.
      "http://localhost.admin.example.test",
    ])("refuses %s when the override is false", (base) => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
    });

    it("refuses every false spelling, not only the literal `false`", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
      for (const raw of ["false", "0", "no", "off"]) {
        vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", raw);
        expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
      }
    });

    it("refuses when the downgrade came from NODE_ENV rather than the override", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(/NODE_ENV is not "production"/);
    });

    it("names the variable, the observed condition and the remedy", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");

      let message = "";
      try {
        assertSecureCookiesConfigured();
      } catch (error) {
        message = (error as Error).message;
      }

      // The variable that has to change, and the one that was read to decide.
      expect(message).toContain("QCMS_ADMIN_SECURE_COOKIES");
      expect(message).toContain("QCMS_ADMIN_BASE_URL");
      // What was observed, in both halves.
      expect(message).toContain('QCMS_ADMIN_SECURE_COOKIES is set to "false"');
      expect(message).toContain('"https://admin.example.test"');
      expect(message).toContain('host "admin.example.test" is not loopback');
      // The remedy, actionable without reading the source, including the part an
      // operator gets wrong on this origin: the API service reads the same variable.
      expect(message).toContain("QCMS_ADMIN_SECURE_COOKIES=true");
      expect(message).toContain("HTTPS");
      expect(message).toContain("http://localhost");
      expect(message).toContain("api");
      // SEC-8: no credential is echoed. The only values quoted are this flag and the
      // public origin, so nothing secret can reach a log through this path.
      expect(message).not.toMatch(/token|secret|password|key/i);
    });
  });
});
