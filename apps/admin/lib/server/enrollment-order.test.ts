import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 2FA order enforced on the **handlers**, not only on the screens (task 061, SEC-1,
 * Code Owner ruling 2026-10-01).
 *
 * ## Why this file exists at all
 *
 * `session.test.ts` proves the gate list sends a provisional admin to the change screen,
 * and `forced-password-change.pw.ts` proves a browser follows it. Neither says anything
 * about what the origin *accepts*, and the first-round review of PR #1023 found the gap
 * there: the enrollment screens were guarded and the two handlers behind them were not,
 * so a provisional admin holding the enrollment cookie could post a TOTP code straight at
 * `/two-factor/enroll/verify` and bind a second factor to an account whose password is
 * still the one out of the provisioning script.
 *
 * The API refused that account every admin route throughout, so nothing could be *done*
 * with the factor and the person doing it holds the credential anyway. What was wrong was
 * narrower and worth fixing on its own terms: SEC-1 says such an account "can reach the
 * forced change screen and nothing else", and that is a sentence about the account rather
 * than about what a browser is shown.
 *
 * ## The two refusals, which are different in kind
 *
 * 1. **`two-factor/enroll/verify` refuses outright.** It is the step that flips
 *    `twoFactorEnabled`, so it is the one that would bind the factor.
 * 2. **`sign-in/submit` never provisions in the first place.** The enrollment secret and
 *    the ten recovery codes are minted by the sign-in POST, so refusing only at verify
 *    would still have handed a provisional account a secret and its codes. This is the
 *    half that makes the order true of what the account *has*, not just of what it can
 *    complete.
 *
 * Both are asserted against a **2FA-enrolled** provisional account as well as an
 * unenrolled one where the distinction bites, because an unenrolled account is bounced by
 * gate 4 in several of these paths and a test that only used one could pass with the
 * provisional check removed.
 */

const ADMIN_BASE = "https://admin.qcms.test";

function stubAdminEnv(): void {
  vi.stubEnv("QCMS_ADMIN_BASE_URL", ADMIN_BASE);
  vi.stubEnv("QCMS_API_BASE_URL", "http://api.internal");
  vi.stubEnv("QCMS_INTERNAL_TOKEN", "internal-token");
}

stubAdminEnv();
beforeEach(stubAdminEnv);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const seams = {
  signInEmail: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  enableTwoFactor: vi.fn(),
  proxiedSession: vi.fn(),
  generateBackupCodes: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/lib/server/auth-api", () => ({
  signInEmail: seams.signInEmail,
  verifyTotp: seams.verifyTotp,
  verifyBackupCode: seams.verifyBackupCode,
  enableTwoFactor: seams.enableTwoFactor,
  proxiedSession: seams.proxiedSession,
  generateBackupCodes: seams.generateBackupCodes,
  changePassword: seams.changePassword,
  signOut: seams.signOut,
}));

// The guards under test read `headers()`, which a direct call to a route handler has no
// request scope for. Only the accessor is substituted: the guard itself and the session it
// reads are the real thing, the latter arriving through the mocked auth mount above.
vi.mock("next/headers", () => ({
  headers: (): Promise<Headers> => Promise.resolve(new Headers()),
}));

vi.mock("@/lib/server/enrollment", () => ({
  pendingEnrollmentCookie: (): string => "qcms_admin.enrollment=uri; Path=/",
  recoveryCodesCookie: (): string => "qcms_admin.recovery_codes=%5B%5D; Path=/",
  clearEnrollmentCookie: (): string => "qcms_admin.enrollment=; Max-Age=0; Path=/",
  clearRecoveryCodesCookie: (): string => "qcms_admin.recovery_codes=; Max-Age=0; Path=/",
}));

const signInRoute = await import("../../app/sign-in/submit/route.ts");
const enrollRoute = await import("../../app/two-factor/enroll/verify/route.ts");
const { CHANGE_PASSWORD_PATH, ENROLL_PATH, SHELL_HOME_PATH } = await import("./session.ts");

/** A same-origin form POST, which is what every auth screen sends. */
function formPost(path: string, fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(`${ADMIN_BASE}${path}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body,
  });
}

function session(options: {
  readonly twoFactorEnabled: boolean;
  readonly mustChangePassword: boolean;
}): unknown {
  return {
    session: { createdAt: new Date().toISOString(), token: "session-token" },
    user: {
      id: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: options.twoFactorEnabled,
      mustChangePassword: options.mustChangePassword,
    },
  };
}

/** A successful sign-in, with the cookies better-auth would have set. */
function signInOk(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": "qcms_admin.session_token=t; Path=/; HttpOnly",
    },
  });
}

function location(response: Response): string | null {
  return response.headers.get("location");
}

describe("two-factor/enroll/verify refuses a provisional session", () => {
  it("sends it to the forced change screen instead of verifying the factor", async () => {
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: false, mustChangePassword: true }),
    );

    const response = await enrollRoute.POST(
      formPost("/two-factor/enroll/verify", { code: "123456" }),
    );

    expect(response.status).toBe(303);
    expect(location(response)).toBe(CHANGE_PASSWORD_PATH);
    // The whole point: the auth mount is never called, so no factor is bound. A guard
    // that redirected *after* verifying would satisfy the two assertions above and defeat
    // the control.
    expect(seams.verifyTotp).not.toHaveBeenCalled();
  });

  it("still admits the ordinary unenrolled session it exists to serve", async () => {
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: false, mustChangePassword: false }),
    );
    seams.verifyTotp.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "qcms_admin.session_token=t2; Path=/; HttpOnly",
        },
      }),
    );

    const response = await enrollRoute.POST(
      formPost("/two-factor/enroll/verify", { code: "123456" }),
    );

    expect(seams.verifyTotp).toHaveBeenCalledTimes(1);
    expect(location(response)).toBe("/two-factor/recovery-codes");
  });

  it("sends an already-enrolled admin to the shell rather than re-provisioning", async () => {
    // Gate 4's own half of this guard, asserted here because adding the provisional check
    // above it is exactly the kind of edit that can reorder the other two by accident.
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: true, mustChangePassword: false }),
    );

    const response = await enrollRoute.POST(
      formPost("/two-factor/enroll/verify", { code: "123456" }),
    );

    expect(location(response)).toBe(SHELL_HOME_PATH);
    expect(seams.verifyTotp).not.toHaveBeenCalled();
  });
});

describe("sign-in/submit provisions no enrollment for a provisional account", () => {
  it("redirects to the forced change screen and mints no secret or recovery codes", async () => {
    seams.signInEmail.mockResolvedValue(signInOk());
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: false, mustChangePassword: true }),
    );

    const response = await signInRoute.POST(
      formPost("/sign-in/submit", { email: "admin@example.test", password: "provisional-pw" }),
    );

    expect(response.status).toBe(303);
    expect(location(response)).toBe(CHANGE_PASSWORD_PATH);
    // The assertion the finding is actually about. `enableTwoFactor` is the only moment
    // the otpauth URI and the ten recovery codes exist outside the database, and handing
    // them to an account still on the provisioning script's password is what the order
    // exists to prevent.
    expect(seams.enableTwoFactor).not.toHaveBeenCalled();
    const cookies = response.headers.getSetCookie().join("; ");
    expect(cookies).not.toContain("qcms_admin.enrollment");
    expect(cookies).not.toContain("qcms_admin.recovery_codes");
    // The session cookies still land, because the visitor has to arrive at the change
    // screen signed in or its own guard would bounce them to sign-in.
    expect(cookies).toContain("qcms_admin.session_token");
  });

  it("does the same for a provisional account that is ALREADY enrolled", async () => {
    // The case that makes this test bite. An unenrolled provisional account would be
    // routed past the enrollment branch by gate 4 anyway in some arrangements; an enrolled
    // one reaches outcome 3 and lands in the shell the moment the provisional check is
    // removed.
    seams.signInEmail.mockResolvedValue(signInOk());
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: true, mustChangePassword: true }),
    );

    const response = await signInRoute.POST(
      formPost("/sign-in/submit", { email: "admin@example.test", password: "provisional-pw" }),
    );

    expect(location(response)).toBe(CHANGE_PASSWORD_PATH);
    expect(seams.enableTwoFactor).not.toHaveBeenCalled();
  });

  it("still provisions for an ordinary unenrolled account, which is outcome 2", async () => {
    seams.signInEmail.mockResolvedValue(signInOk());
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: false, mustChangePassword: false }),
    );
    seams.enableTwoFactor.mockResolvedValue(
      new Response(JSON.stringify({ totpURI: "otpauth://totp/x", backupCodes: ["a", "b"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await signInRoute.POST(
      formPost("/sign-in/submit", { email: "admin@example.test", password: "chosen-pw" }),
    );

    expect(seams.enableTwoFactor).toHaveBeenCalledTimes(1);
    expect(location(response)).toBe(ENROLL_PATH);
  });
});
