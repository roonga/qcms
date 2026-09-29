import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #177, behavioural half: the route-handler guard applies the same four gates
 * as the page guard, and refuses with a 303.
 *
 * `shell-route-guards.test.ts` (structural) proves every handler under `app/(shell)/`
 * *names* a guard. This file proves the guard a route handler names actually enforces
 * the two rules a layout-only gate was skipping: the SEC-1 absolute 12h lifetime and
 * the 2FA-enrollment gate. Naming a guard that did not check them would satisfy the
 * tripwire and leave the hole open, so both halves are needed.
 *
 * The gates are asserted through **both** entry points from one table, because the bug
 * class here is the two drifting apart: the original handler open-coded its own copy of
 * the policy, and a fourth gate added to `requireAdminSession()` would not have reached
 * it.
 */

/**
 * The proxied session read, narrowed to the fields `session.ts` uses.
 *
 * Task 056 moved the read from an in-process `getAuth().api.getSession()` call to one
 * HTTP request to the API`s auth mount, so what is mocked below is
 * `auth-api.proxiedSession` rather than the library. The fields are the same ones
 * better-auth returns, which is the point: the hop changed, the contract did not.
 */
interface AuthSessionResult {
  readonly session: { readonly createdAt: string; readonly token: string };
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly role?: string;
    readonly twoFactorEnabled?: boolean;
    readonly mustChangePassword?: boolean;
  };
}

const mocks = vi.hoisted(() => ({
  proxiedSession: vi.fn<() => Promise<AuthSessionResult | undefined>>(),
  twoFactorOptional: vi.fn<() => boolean>(),
  // `redirect()` signals by throwing, which is the behaviour under test for pages: a
  // caller must not be able to continue past it. The thrown marker stands in for Next's
  // own `NEXT_REDIRECT`.
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./auth-api.ts", () => ({ proxiedSession: mocks.proxiedSession }));
vi.mock("./config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config.ts")>()),
  twoFactorOptional: mocks.twoFactorOptional,
}));

const {
  CHANGE_PASSWORD_PATH,
  ENROLL_PATH,
  SHELL_HOME_PATH,
  SIGN_IN_PATH,
  requireAdminSession,
  requireAdminSessionForRequest,
  requireEnrollingSession,
  requirePasswordChangeSession,
  requirePasswordChangeSessionForRequest,
} = await import("./session.ts");

const HOUR_MS = 60 * 60 * 1000;
/** SEC-1's absolute lifetime, and `sessionMaxAgeMs()`'s default when the env is unset. */
const MAX_AGE_MS = 12 * HOUR_MS;

function signedIn(
  ageMs: number,
  twoFactorEnabled: boolean,
  mustChangePassword = false,
): AuthSessionResult {
  return {
    session: { createdAt: new Date(Date.now() - ageMs).toISOString(), token: "tok_test" },
    user: {
      id: "usr_test",
      email: "admin@example.test",
      name: "Test Admin",
      role: "admin",
      twoFactorEnabled,
      mustChangePassword,
    },
  };
}

/** Where the page guard sent the visitor, or `undefined` when it let them through. */
async function pageRefusal(): Promise<string | undefined> {
  try {
    await requireAdminSession();
    return undefined;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) {
      return error.message.slice("REDIRECT:".length);
    }
    throw error;
  }
}

/** Where the request guard sent the visitor, or `undefined` when it let them through. */
async function requestRefusal(): Promise<{ path?: string; status?: number }> {
  const outcome = await requireAdminSessionForRequest();
  if (!(outcome instanceof Response)) return {};
  return { path: outcome.headers.get("location") ?? "", status: outcome.status };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.twoFactorOptional.mockReturnValue(false);
});

describe("the four gates, applied identically by both guards (issue #177, task 061)", () => {
  const cases = [
    { name: "no session at all", result: undefined, expected: () => SIGN_IN_PATH },
    {
      name: "a session kept warm past the SEC-1 12h absolute cap",
      result: signedIn(MAX_AGE_MS + HOUR_MS, true),
      expected: () => SIGN_IN_PATH,
    },
    {
      name: "a session exactly at the cap (the boundary is closed)",
      result: signedIn(MAX_AGE_MS, true),
      expected: () => SIGN_IN_PATH,
    },
    {
      name: "a live session that has not finished 2FA enrollment",
      result: signedIn(HOUR_MS, false),
      expected: () => ENROLL_PATH,
    },
    {
      name: "a live enrolled session still holding the bootstrap credential",
      result: signedIn(HOUR_MS, true, true),
      expected: () => CHANGE_PASSWORD_PATH,
    },
  ];

  it.each(cases)("page guard refuses $name", async ({ result, expected }) => {
    mocks.proxiedSession.mockResolvedValue(result);
    expect(await pageRefusal()).toBe(expected());
  });

  it.each(cases)("route-handler guard refuses $name", async ({ result, expected }) => {
    mocks.proxiedSession.mockResolvedValue(result);
    expect(await requestRefusal()).toEqual({ path: expected(), status: 303 });
  });

  it.each(cases)(
    "route-handler guard never reaches the handler body for $name",
    async ({ result }) => {
      mocks.proxiedSession.mockResolvedValue(result);
      // The narrowing the call sites use. If this stopped being a `Response`, every
      // handler's `if (x instanceof Response) return x;` would fall through into the
      // credential-changing code path with no session.
      expect(await requireAdminSessionForRequest()).toBeInstanceOf(Response);
    },
  );
});

describe("a session that passes all four gates", () => {
  beforeEach(() => {
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, true));
  });

  it("is returned to a page, not redirected", async () => {
    const session = await requireAdminSession();
    expect(session.email).toBe("admin@example.test");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("is returned to a route handler, not redirected", async () => {
    const session = await requireAdminSessionForRequest();
    expect(session).not.toBeInstanceOf(Response);
    expect(session instanceof Response ? undefined : session.token).toBe("tok_test");
  });
});

describe("the documented 2FA escape hatch (QCMS_ADMIN_2FA=optional)", () => {
  it("lets an un-enrolled session through both guards, and only that gate", async () => {
    mocks.twoFactorOptional.mockReturnValue(true);
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false));
    await expect(requireAdminSession()).resolves.toMatchObject({ twoFactorEnabled: false });
    expect(await requireAdminSessionForRequest()).not.toBeInstanceOf(Response);

    // The cap is not part of the escape hatch: an expired session is still refused.
    mocks.proxiedSession.mockResolvedValue(signedIn(MAX_AGE_MS + HOUR_MS, false));
    expect(await pageRefusal()).toBe(SIGN_IN_PATH);
    expect(await requestRefusal()).toEqual({ path: SIGN_IN_PATH, status: 303 });
  });
});

describe("the refusal shape a form POST needs", () => {
  it("is a 303 so the browser follows with GET, never a 307 that re-posts", async () => {
    mocks.proxiedSession.mockResolvedValue(undefined);
    const outcome = await requireAdminSessionForRequest();
    expect(outcome).toBeInstanceOf(Response);
    if (!(outcome instanceof Response)) return;
    // 307/308 preserve the method and body, which would re-send the submitted password
    // to the sign-in screen. That is why the handler cannot simply call `redirect()`.
    expect(outcome.status).toBe(303);
    expect(outcome.headers.get("location")).toBe(SIGN_IN_PATH);
  });
});

/**
 * Task 061: the provisional bootstrap credential.
 *
 * Exit criterion 1 ("cannot reach any admin route") is asserted in the browser, by
 * driving a real sign-in and typing deep URLs - `apps/admin/e2e/forced-password-change.pw.ts`.
 * What is asserted here is the policy those routes inherit: the ORDER relative to 2FA
 * enrollment (criterion 5), the fact that the enrollment screens are inside the gate
 * rather than beside it, and that an admin who has already changed their password
 * meets nothing at all (criterion 4).
 */
describe("the forced password change (task 061, SEC-1)", () => {
  it("comes before the 2FA gate when both apply", async () => {
    // Both flags set: unenrolled AND still on the bootstrap credential, which is
    // exactly the state `qcms:create-admin` leaves an account in. Enrolment binds a
    // second factor, and binding it to an account whose first factor came out of a CI
    // variable is the thing the order exists to prevent.
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, true));
    expect(await pageRefusal()).toBe(CHANGE_PASSWORD_PATH);
    expect(await requestRefusal()).toEqual({ path: CHANGE_PASSWORD_PATH, status: 303 });
  });

  it("is not relaxed by the QCMS_ADMIN_2FA escape hatch", async () => {
    // The hatch exists because enrollment needs a device a developer may not have.
    // Changing a password needs nothing, so it buys no exemption here - and a hatch
    // that silently widened to a second control is how one gets left on.
    mocks.twoFactorOptional.mockReturnValue(true);
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, true));
    expect(await pageRefusal()).toBe(CHANGE_PASSWORD_PATH);
  });

  it("gates the enrollment screens too, which are outside the shell", async () => {
    // `requireEnrollingSession` deliberately skips the 2FA gate, so without this it
    // would be the one reachable screen for a provisional credential - and the screen
    // that binds a factor, at that.
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, true));
    await expect(requireEnrollingSession()).rejects.toThrow(`REDIRECT:${CHANGE_PASSWORD_PATH}`);
  });

  describe("the forced screen's own guard", () => {
    it("admits the session the other guards refuse", async () => {
      mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, true));
      await expect(requirePasswordChangeSession()).resolves.toMatchObject({
        mustChangePassword: true,
      });
      expect(await requirePasswordChangeSessionForRequest()).not.toBeInstanceOf(Response);
    });

    it("sends an anonymous visitor to sign-in, as a 303 for the handler", async () => {
      mocks.proxiedSession.mockResolvedValue(undefined);
      await expect(requirePasswordChangeSession()).rejects.toThrow(`REDIRECT:${SIGN_IN_PATH}`);
      const outcome = await requirePasswordChangeSessionForRequest();
      expect(outcome).toBeInstanceOf(Response);
      // 307 would re-post the credential at the sign-in screen (see `route-helpers.ts`).
      if (outcome instanceof Response) {
        expect(outcome.status).toBe(303);
        expect(outcome.headers.get("location")).toBe(SIGN_IN_PATH);
      }
    });

    it("refuses an admin whose flag is clear, so it is not a second change surface", async () => {
      // Criterion 4 at the URL rather than at the redirect: typing this path must not
      // give an ordinary signed-in admin a change-password form outside Settings.
      mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, true, false));
      await expect(requirePasswordChangeSession()).rejects.toThrow(`REDIRECT:${SHELL_HOME_PATH}`);
    });

    it("sends a cleared-but-unenrolled admin straight on to enrollment", async () => {
      // Not to the shell, which would only bounce off gate 4 one round trip later.
      // This is the state the forced screen's own handler leaves behind.
      mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, false));
      await expect(requirePasswordChangeSession()).rejects.toThrow(`REDIRECT:${ENROLL_PATH}`);
    });
  });

  it("leaves an admin who has already changed their password untouched", async () => {
    // Criterion 4. No redirect anywhere, and the same one session read every other
    // request makes - the gate is a predicate over a body the app already fetches, so
    // it costs no extra round trip.
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, true, false));
    await expect(requireAdminSession()).resolves.toMatchObject({ mustChangePassword: false });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.proxiedSession).toHaveBeenCalledTimes(1);
  });

  it("reads an absent field as clear rather than as set", async () => {
    // The wire contract is between two deployables, so the field can be missing. The
    // fail-closed half of this control is the API's own gate on the column; the BFF
    // reading absent as "set" would instead park every admin on a screen whose form
    // the API would refuse.
    mocks.proxiedSession.mockResolvedValue({
      session: { createdAt: new Date().toISOString(), token: "tok_test" },
      user: { id: "usr_test", email: "admin@example.test", name: "Test Admin", twoFactorEnabled: true },
    });
    await expect(requireAdminSession()).resolves.toMatchObject({ mustChangePassword: false });
  });
});
