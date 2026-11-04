import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const forcedChangeRoute = await import("../../app/change-password/submit/route.ts");
const { CHANGE_PASSWORD_PATH, ENROLL_PATH, SHELL_HOME_PATH } = await import("./session.ts");

const PROVISIONAL_PASSWORD = `provisional-${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url")}`;
const CHOSEN_PASSWORD = `chosen-${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url")}`;

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
      formPost("/sign-in/submit", { email: "admin@example.test", password: PROVISIONAL_PASSWORD }),
    );

    expect(response.status).toBe(303);
    expect(location(response)).toBe(CHANGE_PASSWORD_PATH);

    expect(seams.enableTwoFactor).not.toHaveBeenCalled();
    const cookies = response.headers.getSetCookie().join("; ");
    expect(cookies).not.toContain("qcms_admin.enrollment");
    expect(cookies).not.toContain("qcms_admin.recovery_codes");

    expect(cookies).toContain("qcms_admin.session_token");
  });

  it("does the same for a provisional account that is ALREADY enrolled", async () => {
    seams.signInEmail.mockResolvedValue(signInOk());
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: true, mustChangePassword: true }),
    );

    const response = await signInRoute.POST(
      formPost("/sign-in/submit", { email: "admin@example.test", password: PROVISIONAL_PASSWORD }),
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
      formPost("/sign-in/submit", { email: "admin@example.test", password: CHOSEN_PASSWORD }),
    );

    expect(seams.enableTwoFactor).toHaveBeenCalledTimes(1);
    expect(location(response)).toBe(ENROLL_PATH);
  });
});

describe("the forced change hands the enrollment over once the password has moved", () => {
  function changePost(): Request {
    return formPost("/change-password/submit", {
      currentPassword: PROVISIONAL_PASSWORD,
      newPassword: CHOSEN_PASSWORD,
      confirmPassword: CHOSEN_PASSWORD,
    });
  }

  function changeOk(): Response {
    return new Response(JSON.stringify({ token: "fresh" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "qcms_admin.session_token=fresh; Path=/; HttpOnly",
      },
    });
  }

  it("provisions the secret and the codes, and lands on enrollment with both", async () => {
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: false, mustChangePassword: true }),
    );
    seams.changePassword.mockResolvedValue(changeOk());
    seams.enableTwoFactor.mockResolvedValue(
      new Response(JSON.stringify({ totpURI: "otpauth://totp/x", backupCodes: ["a", "b"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await forcedChangeRoute.POST(changePost());

    expect(location(response)).toBe(ENROLL_PATH);
    expect(seams.enableTwoFactor).toHaveBeenCalledTimes(1);

    expect(seams.enableTwoFactor.mock.calls[0]?.[1]).toBe(CHOSEN_PASSWORD);

    expect(seams.enableTwoFactor.mock.calls[0]?.[2]).toContain("fresh");

    const cookies = response.headers.getSetCookie().join("; ");
    expect(cookies).toContain("qcms_admin.enrollment");
    expect(cookies).toContain("qcms_admin.recovery_codes");
  });

  it("provisions nothing for an already-enrolled admin and goes to the shell", async () => {
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: true, mustChangePassword: true }),
    );
    seams.changePassword.mockResolvedValue(changeOk());

    const response = await forcedChangeRoute.POST(changePost());

    expect(location(response)).toBe(SHELL_HOME_PATH);
    expect(seams.enableTwoFactor).not.toHaveBeenCalled();
  });

  it("provisions nothing when the change was refused", async () => {
    seams.proxiedSession.mockResolvedValue(
      session({ twoFactorEnabled: false, mustChangePassword: true }),
    );
    seams.changePassword.mockResolvedValue(
      new Response(JSON.stringify({ message: "refused" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await forcedChangeRoute.POST(changePost());

    expect(location(response)).toBe(`${CHANGE_PASSWORD_PATH}?error=1`);
    expect(seams.enableTwoFactor).not.toHaveBeenCalled();
  });
});
