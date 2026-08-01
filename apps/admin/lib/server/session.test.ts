import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #177, behavioural half: the route-handler guard applies the same three gates
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

/** better-auth's `getSession` shape, narrowed to the fields `session.ts` reads. */
interface AuthSessionResult {
  readonly session: { readonly createdAt: string; readonly token: string };
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly role?: string;
    readonly twoFactorEnabled?: boolean;
  };
}

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<AuthSessionResult | null>>(),
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
vi.mock("./auth.ts", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
  twoFactorOptional: mocks.twoFactorOptional,
}));

const { ENROLL_PATH, SIGN_IN_PATH, requireAdminSession, requireAdminSessionForRequest } =
  await import("./session.ts");

const HOUR_MS = 60 * 60 * 1000;
/** SEC-1's absolute lifetime, and `sessionPolicy()`'s default when the env is unset. */
const MAX_AGE_MS = 12 * HOUR_MS;

function signedIn(ageMs: number, twoFactorEnabled: boolean): AuthSessionResult {
  return {
    session: { createdAt: new Date(Date.now() - ageMs).toISOString(), token: "tok_test" },
    user: {
      id: "usr_test",
      email: "admin@example.test",
      name: "Test Admin",
      role: "admin",
      twoFactorEnabled,
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

describe("the three gates, applied identically by both guards (issue #177)", () => {
  const cases = [
    { name: "no session at all", result: null, expected: () => SIGN_IN_PATH },
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
  ];

  it.each(cases)("page guard refuses $name", async ({ result, expected }) => {
    mocks.getSession.mockResolvedValue(result);
    expect(await pageRefusal()).toBe(expected());
  });

  it.each(cases)("route-handler guard refuses $name", async ({ result, expected }) => {
    mocks.getSession.mockResolvedValue(result);
    expect(await requestRefusal()).toEqual({ path: expected(), status: 303 });
  });

  it.each(cases)(
    "route-handler guard never reaches the handler body for $name",
    async ({ result }) => {
      mocks.getSession.mockResolvedValue(result);
      // The narrowing the call sites use. If this stopped being a `Response`, every
      // handler's `if (x instanceof Response) return x;` would fall through into the
      // credential-changing code path with no session.
      expect(await requireAdminSessionForRequest()).toBeInstanceOf(Response);
    },
  );
});

describe("a session that passes all three gates", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue(signedIn(HOUR_MS, true));
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
    mocks.getSession.mockResolvedValue(signedIn(HOUR_MS, false));
    await expect(requireAdminSession()).resolves.toMatchObject({ twoFactorEnabled: false });
    expect(await requireAdminSessionForRequest()).not.toBeInstanceOf(Response);

    // The cap is not part of the escape hatch: an expired session is still refused.
    mocks.getSession.mockResolvedValue(signedIn(MAX_AGE_MS + HOUR_MS, false));
    expect(await pageRefusal()).toBe(SIGN_IN_PATH);
    expect(await requestRefusal()).toEqual({ path: SIGN_IN_PATH, status: 303 });
  });
});

describe("the refusal shape a form POST needs", () => {
  it("is a 303 so the browser follows with GET, never a 307 that re-posts", async () => {
    mocks.getSession.mockResolvedValue(null);
    const outcome = await requireAdminSessionForRequest();
    expect(outcome).toBeInstanceOf(Response);
    if (!(outcome instanceof Response)) return;
    // 307/308 preserve the method and body, which would re-send the submitted password
    // to the sign-in screen. That is why the handler cannot simply call `redirect()`.
    expect(outcome.status).toBe(303);
    expect(outcome.headers.get("location")).toBe(SIGN_IN_PATH);
  });
});
