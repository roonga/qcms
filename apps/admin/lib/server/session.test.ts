import { beforeEach, describe, expect, it, vi } from "vitest";

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

    expect(outcome.status).toBe(303);
    expect(outcome.headers.get("location")).toBe(SIGN_IN_PATH);
  });
});

describe("the forced password change (task 061, SEC-1)", () => {
  it("comes before the 2FA gate when both apply", async () => {
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, true));
    expect(await pageRefusal()).toBe(CHANGE_PASSWORD_PATH);
    expect(await requestRefusal()).toEqual({ path: CHANGE_PASSWORD_PATH, status: 303 });
  });

  it("is not relaxed by the QCMS_ADMIN_2FA escape hatch", async () => {
    mocks.twoFactorOptional.mockReturnValue(true);
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, true));
    expect(await pageRefusal()).toBe(CHANGE_PASSWORD_PATH);
  });

  it("gates the enrollment screens too, which are outside the shell", async () => {
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

      if (outcome instanceof Response) {
        expect(outcome.status).toBe(303);
        expect(outcome.headers.get("location")).toBe(SIGN_IN_PATH);
      }
    });

    it("refuses an admin whose flag is clear, so it is not a second change surface", async () => {
      mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, true, false));
      await expect(requirePasswordChangeSession()).rejects.toThrow(`REDIRECT:${SHELL_HOME_PATH}`);
    });

    it("sends a cleared-but-unenrolled admin straight on to enrollment", async () => {
      mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, false, false));
      await expect(requirePasswordChangeSession()).rejects.toThrow(`REDIRECT:${ENROLL_PATH}`);
    });
  });

  it("leaves an admin who has already changed their password untouched", async () => {
    mocks.proxiedSession.mockResolvedValue(signedIn(HOUR_MS, true, false));
    await expect(requireAdminSession()).resolves.toMatchObject({ mustChangePassword: false });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.proxiedSession).toHaveBeenCalledTimes(1);
  });

  it("reads an absent field as clear rather than as set", async () => {
    mocks.proxiedSession.mockResolvedValue({
      session: { createdAt: new Date().toISOString(), token: "tok_test" },
      user: {
        id: "usr_test",
        email: "admin@example.test",
        name: "Test Admin",
        twoFactorEnabled: true,
      },
    });
    await expect(requireAdminSession()).resolves.toMatchObject({ mustChangePassword: false });
  });
});
