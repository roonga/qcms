import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The carrier that replaced the recovery-code read-back route (issue #319).
 *
 * `POST /admin/auth/recovery-codes` decrypted the stored codes and returned them to any
 * live admin session, which is what made `SECURITY_DESIGN.md` §2.1's "shown once"
 * untrue. It is gone, and nothing anywhere reads the stored set. What is left are the
 * two moments better-auth *hands the codes over* - enrollment and regeneration - and a
 * short-lived cookie that carries them across the one redirect between that moment and
 * the screen that prints them.
 *
 * A cookie holding secrets earns a test rather than a comment, and the properties worth
 * pinning are the ones a careless edit would drop:
 *
 * - **Hardened the same way as the enrollment cookie.** `HttpOnly` (no script reads
 *   it), `SameSite=Strict` (no cross-site request carries it), path-scoped to
 *   `/two-factor` so it is not attached to every admin request, and short-lived.
 * - **`Secure` follows the deployment**, not a hard-coded default (issue #317 is the
 *   cost of getting cookie attributes wrong in one environment only).
 * - **Actually cleared**, not merely overwritten, when the display is spent - `Max-Age=0`
 *   is what makes "codes never shown again" true rather than aspirational.
 * - **A tampered value reads as nothing owed.** The only writer is this module, so
 *   anything else is a truncated or forged cookie, and the answer is the same redirect
 *   a missing cookie gets - never a crash, and never a partial render.
 */

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
    // Fifteen minutes: long enough to write the codes down, not long enough to be a
    // credential the browser keeps.
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
    // A blank value with a live Max-Age would leave the browser holding a cookie the
    // app then has to reason about. Expiring it removes the question.
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
