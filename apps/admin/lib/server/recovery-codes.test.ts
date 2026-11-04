import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  secure: false,
}));

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

vi.mock("./config.ts", () => ({ secureCookies: () => mocks.secure }));

const { RECOVERY_CODES_COOKIE, clearRecoveryCodesCookie, owedRecoveryCodes, recoveryCodesCookie } =
  await import("./enrollment.ts");

const CODES = ["AAAAA-11111", "BBBBB-22222", "CCCCC-33333"];

afterEach(() => {
  mocks.jar.clear();
  mocks.secure = false;
});

describe("recoveryCodesCookie", () => {
  it("is httpOnly, SameSite=Strict, scoped to /two-factor and short-lived", () => {
    const header = recoveryCodesCookie(CODES);
    expect(header.startsWith(`${RECOVERY_CODES_COOKIE}=`)).toBe(true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/two-factor");

    expect(header).toContain("Max-Age=900");
  });

  it("adds Secure exactly when the deployment says the origin is https", () => {
    expect(recoveryCodesCookie(CODES)).not.toContain("Secure");
    mocks.secure = true;
    expect(recoveryCodesCookie(CODES)).toContain("Secure");
  });

  it("clearing the display expires the cookie rather than blanking it", () => {
    const header = clearRecoveryCodesCookie();
    expect(header).toContain("Max-Age=0");

    expect(header).toContain(`${RECOVERY_CODES_COOKIE}=;`);
  });
});

describe("owedRecoveryCodes", () => {
  it("round-trips the codes the issuing step handed over", async () => {
    const header = recoveryCodesCookie(CODES);
    const value = header.slice(header.indexOf("=") + 1, header.indexOf(";"));
    mocks.jar.set(RECOVERY_CODES_COOKIE, decodeURIComponent(value));
    expect(await owedRecoveryCodes()).toEqual(CODES);
  });

  it("answers 'nothing owed' for absent, empty, malformed and wrong-shaped values", async () => {
    expect(await owedRecoveryCodes()).toBeUndefined();

    for (const value of ["", "not json", "[]", '"a string"', "{}", "[1,2,3]", '["ok",7]']) {
      mocks.jar.set(RECOVERY_CODES_COOKIE, value);
      expect(await owedRecoveryCodes(), `value ${JSON.stringify(value)}`).toBeUndefined();
    }
  });
});
