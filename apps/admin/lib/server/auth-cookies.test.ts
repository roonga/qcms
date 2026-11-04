import { afterEach, describe, expect, it, vi } from "vitest";

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
    mocks.jar.set(`__Secure-${SESSION_COOKIE}`, "session-token");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBeUndefined();
    expect(await readAuthCookie(SESSION_COOKIE)).toBe("session-token");
  });

  it("prefers an exact match over a prefixed one when both somehow exist", async () => {
    mocks.jar.set(`__Secure-${TWO_FACTOR_COOKIE}`, "stale");
    mocks.jar.set(TWO_FACTOR_COOKIE, "live");
    expect(await readAuthCookie(TWO_FACTOR_COOKIE)).toBe("live");
  });
});
