import { afterEach, describe, expect, it, vi } from "vitest";

import { isProduction, portalBaseUrl } from "./config.js";

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

describe("isProduction", () => {
  it('honours QCMS_SECURE_COOKIES="true" whatever NODE_ENV says', () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(isProduction()).toBe(true);
  });

  it('honours QCMS_SECURE_COOKIES="false" whatever NODE_ENV says', () => {
    // The documented localhost Compose profile: browsers never return Secure
    // cookies over plain HTTP, so a production build there could create a session
    // and then fail to resume it after Start.
    vi.stubEnv("QCMS_SECURE_COOKIES", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(false);
  });

  it("falls back to NODE_ENV when the override is unset", () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isProduction()).toBe(false);
  });

  it("ignores an unrecognized override value and uses NODE_ENV", () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "yes");
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isProduction()).toBe(false);
  });
});
