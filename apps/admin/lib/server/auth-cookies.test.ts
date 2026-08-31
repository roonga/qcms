import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Reading better-auth's cookies through their security prefix (issue #317).
 *
 * ## Why this needs a test at all, and why it is a unit one
 *
 * better-auth renames its own cookies when it issues secure ones: the name is
 * `${secureCookiePrefix}${prefix}.${cookieName}` and `secureCookiePrefix` is `__Secure-`
 * whenever `advanced.useSecureCookies` is true (better-auth 1.7.1, the pinned version:
 * `dist/cookies/index.mjs:23` decides the prefix, `:28-32` composes the name). The
 * library reads both spellings for
 * itself (`:266`); this app has to do the same, and before #317 it read only the bare
 * name, so the 2FA challenge screen bounced to sign-in forever in any deployment with
 * secure cookies on - which is the default compose shape, because
 * `docker/admin.Dockerfile` bakes `NODE_ENV=production`.
 *
 * **No browser job can catch this.** The Playwright harness runs over http on localhost
 * with secure cookies off, so the prefixed name never appears in CI. That is precisely why
 * the regression survived 031 and 056's green runs, and why the coverage has to be here,
 * at the only layer that can name the prefixed form without a TLS deployment.
 */

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = mocks.jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })),
    }),
}));

const { readAuthCookie, SESSION_COOKIE, TWO_FACTOR_COOKIE } = await import("./auth-api.ts");

afterEach(() => {
  mocks.jar.clear();
});

describe("readAuthCookie", () => {
  it("finds the bare name (development, secure cookies off)", async () => {
    mocks.jar.set(TWO_FACTOR_COOKIE, "challenge-token");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBe("challenge-token");
  });

  it("finds the __Secure- prefixed name (any deployment with secure cookies on)", async () => {
    mocks.jar.set(`__Secure-${TWO_FACTOR_COOKIE}`, "challenge-token");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBe("challenge-token");
  });

  it("finds the __Host- prefixed name too, so an upstream switch stays covered", async () => {
    mocks.jar.set(`__Host-${TWO_FACTOR_COOKIE}`, "challenge-token");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBe("challenge-token");
  });

  it("returns undefined when no spelling is present", async () => {
    mocks.jar.set("unrelated", "x");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBeUndefined();
  });

  it("never crosses between two auth cookies (the suffix is anchored)", async () => {
    // The hazard a bare `endsWith` would create: these two names share a prefix, and a
    // challenge lookup must not be satisfied by a session token or vice versa.
    mocks.jar.set(`__Secure-${SESSION_COOKIE}`, "session-token");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBeUndefined();
    expect(await readAuthCookie(SESSION_COOKIE)).toBe("session-token");
  });

  it("prefers an exact match over a prefixed one when both somehow exist", async () => {
    // A stale prefixed cookie surviving a switch to http would otherwise shadow the live
    // one. Deterministic rather than dependent on jar ordering.
    mocks.jar.set(`__Secure-${TWO_FACTOR_COOKIE}`, "stale");
    mocks.jar.set(TWO_FACTOR_COOKIE, "live");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBe("live");
  });
});
