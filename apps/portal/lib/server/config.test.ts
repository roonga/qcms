import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSecureCookiesConfigured, portalBaseUrl, secureCookies } from "./config.js";

/**
 * The server-only BFF configuration readers (task 029, extended for the Compose
 * topology in task 036).
 *
 * `portalBaseUrl()` is required rather than defaulted on purpose: the Start route
 * builds its 303 redirect from it, so an unset value must fail loudly at the first
 * request instead of silently emitting the container-internal origin a respondent's
 * browser cannot follow. That makes "who passes this variable" a real contract, and
 * every process that serves the portal (Compose, the Playwright harness, and
 * `scripts/dev-portal.mjs`) has to honour it.
 *
 * `vi.stubEnv` rather than assignment: `NODE_ENV` is typed read-only by Next's
 * ambient types, and stubbing restores every variable in one call whichever way a
 * case ends.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("portalBaseUrl", () => {
  it("returns the configured origin unchanged", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
    expect(portalBaseUrl()).toBe("https://forms.example.test");
  });

  it("trims trailing slashes so a path can always be appended", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test///");
    expect(portalBaseUrl()).toBe("https://forms.example.test");
  });

  it("throws a message naming the variable when it is unset or empty", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", undefined);
    expect(() => portalBaseUrl()).toThrow(/QCMS_PORTAL_BASE_URL/);
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
    expect(() => portalBaseUrl()).toThrow(/QCMS_PORTAL_BASE_URL/);
  });
});

describe("secureCookies", () => {
  it('honours QCMS_SECURE_COOKIES="true" whatever NODE_ENV says', () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(true);
  });

  it('honours QCMS_SECURE_COOKIES="false" whatever NODE_ENV says', () => {
    // The documented localhost Compose profile: a plain-HTTP stack browsed at an
    // origin the browser does not trust could create a session and then fail to
    // resume it after Start. `assertSecureCookiesConfigured` below is what keeps
    // that exception confined to loopback.
    vi.stubEnv("QCMS_SECURE_COOKIES", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(false);
  });

  it("falls back to NODE_ENV when the override is unset", () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(false);
  });

  it("ignores an unrecognized override value and uses NODE_ENV", () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "yes");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(false);
  });
});

/**
 * The boot-time refusal (issue #292 point 1).
 *
 * **This matrix is paired with `apps/admin/lib/server/config.test.ts`.** The two apps
 * disagreeing about exactly this decision is what the issue was filed about, so the same
 * cases are asserted on both sides and a change made to one and not the other goes red.
 *
 * The positive controls come first on purpose: a red then distinguishes "the refusal
 * broke" from "the fixture was never a configuration that boots".
 */
describe("assertSecureCookiesConfigured", () => {
  describe("permits the configurations it exists to allow", () => {
    it("passes the shape .env.compose.example ships: downgrade on, browsed at http://localhost", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes a plain dev server: no override, NODE_ENV development, loopback origin", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it.each([
      "http://127.0.0.1:7000",
      "http://127.0.0.53:7000",
      "http://[::1]:7000",
      "http://portal.localhost:7000",
      "https://localhost:7000",
    ])("passes the loopback origin %s", (base) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes any origin at all once Secure is on", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "true");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes when the base URL is absent or unparseable, which is a different defect", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", undefined);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "forms.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });
  });

  describe("refuses the downgrade off loopback", () => {
    it.each([
      "https://forms.example.test",
      "http://forms.example.test",
      "http://192.168.1.10:7000",
      "http://0.0.0.0:7000",
      // A name that merely CONTAINS localhost is not loopback, and an attacker-chosen
      // hostname is exactly where a sloppy substring check would let the downgrade out.
      "http://localhost.forms.example.test",
    ])("refuses %s when the override is false", (base) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
    });

    it("refuses when the downgrade came from NODE_ENV rather than the override", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(/NODE_ENV is not "production"/);
    });

    it("names the variable, the observed condition and the remedy", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

      let message = "";
      try {
        assertSecureCookiesConfigured();
      } catch (error) {
        message = (error as Error).message;
      }

      // The variable that has to change, and the one that was read to decide.
      expect(message).toContain("QCMS_SECURE_COOKIES");
      expect(message).toContain("QCMS_PORTAL_BASE_URL");
      // What was observed, in both halves.
      expect(message).toContain('QCMS_SECURE_COOKIES is set to "false"');
      expect(message).toContain('"https://forms.example.test"');
      expect(message).toContain('host "forms.example.test" is not loopback');
      // The remedy, actionable without reading the source.
      expect(message).toContain("QCMS_SECURE_COOKIES=true");
      expect(message).toContain("HTTPS");
      expect(message).toContain("http://localhost");
      // SEC-8: no credential is echoed. The only values quoted are this flag and the
      // public origin, so nothing secret can reach a log through this path.
      expect(message).not.toMatch(/token|secret|password|key/i);
    });
  });
});
