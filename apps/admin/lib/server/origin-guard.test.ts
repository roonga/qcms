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
});

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

function authResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "qcms_admin.session_token=s" },
    ...init,
  });
}

const seams = {
  signInEmail: vi.fn(),
  signOut: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  generateBackupCodes: vi.fn(),
  changePassword: vi.fn(),
  enableTwoFactor: vi.fn(),
  proxiedSession: vi.fn(),
  assist: vi.fn(),
  screenAssist: vi.fn(),
  requireAdminSessionForRequest: vi.fn(),
  pendingEnrollmentCookie: vi.fn(() => "qcms_admin.enrollment=uri; Path=/"),
  recoveryCodesCookie: vi.fn(() => "qcms_admin.recovery_codes=%5B%5D; Path=/"),
  clearEnrollmentCookie: vi.fn(() => "qcms_admin.enrollment=; Max-Age=0; Path=/"),
  clearRecoveryCodesCookie: vi.fn(() => "qcms_admin.recovery_codes=; Max-Age=0; Path=/"),
};

vi.mock("@/lib/server/auth-api", () => ({
  signInEmail: seams.signInEmail,
  signOut: seams.signOut,
  verifyTotp: seams.verifyTotp,
  verifyBackupCode: seams.verifyBackupCode,
  generateBackupCodes: seams.generateBackupCodes,
  changePassword: seams.changePassword,
  enableTwoFactor: seams.enableTwoFactor,
  proxiedSession: seams.proxiedSession,
}));

vi.mock("@/lib/server/forms", async () => ({
  ...(await import("./forms.ts")),
  assist: seams.assist,
  screenAssist: seams.screenAssist,
}));

vi.mock("@/lib/server/enrollment", () => ({
  pendingEnrollmentCookie: seams.pendingEnrollmentCookie,
  recoveryCodesCookie: seams.recoveryCodesCookie,
  clearEnrollmentCookie: seams.clearEnrollmentCookie,
  clearRecoveryCodesCookie: seams.clearRecoveryCodesCookie,
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, getAll: () => [], set: () => undefined }),
  headers: () => Promise.resolve(new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect to ${path}`);
  },
}));

/** The admin's stdout, captured. `vi.hoisted` because the `vi.mock` factory below is lifted above every other statement in this file, so an ordinary `const` would not exist yet when the factory runs. */
const { emitted } = vi.hoisted(() => ({ emitted: [] as string[] }));

vi.mock("./logger.ts", async () => {
  const { createJsonLogger } = await import("@roonga/qcms-observability/logger");
  return {
    serverLogger: createJsonLogger({
      base: { service: "qcms-admin" },
      write: (line: string) => emitted.push(line),
    }),
  };
});

beforeEach(() => {
  emitted.length = 0;
});

vi.mock("@/lib/server/session", async () => ({
  ...(await import("./session.ts")),
  requireAdminSessionForRequest: seams.requireAdminSessionForRequest,
}));

const { isSameOriginPost } = await import("./route-helpers.ts");
const signInRoute = await import("../../app/sign-in/submit/route.ts");
const signOutRoute = await import("../../app/sign-out/route.ts");
const challengeRoute = await import("../../app/two-factor/challenge/verify/route.ts");
const enrollRoute = await import("../../app/two-factor/enroll/verify/route.ts");
const recoveryRoute = await import("../../app/two-factor/recovery/verify/route.ts");
const confirmRoute = await import("../../app/two-factor/recovery-codes/confirm/route.ts");
const passwordRoute = await import("../../app/(shell)/settings/password/route.ts");
const forcedPasswordRoute = await import("../../app/change-password/submit/route.ts");
const codesRoute = await import("../../app/(shell)/settings/recovery-codes/route.ts");
const assistRoute = await import("../../app/(shell)/forms/[formId]/assist/route.ts");
const screenAssistRoute = await import("../../app/(shell)/assist/route.ts");

function refusalLines(): Record<string, unknown>[] {
  return emitted
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["msg"] === "origin.belt.refused");
}

function outcomeOnTheWire(response: Response): string {
  if (response.status !== 303) return `refused-${response.status}`;
  const location = new URL(response.headers.get("location") ?? "", ADMIN_BASE);
  return location.search === "" ? "redirect-without-message" : "redirect-with-failure";
}

interface OriginCase {
  readonly name: string;
  readonly headers: Record<string, string>;
  readonly allowed: boolean;

  readonly logged?: { readonly beltFetchSite: string; readonly beltOrigin: string };
}

const ORIGIN_CASES: readonly OriginCase[] = [
  {
    name: "Sec-Fetch-Site: same-origin (what a current browser sends from our own page)",
    headers: { "sec-fetch-site": "same-origin" },
    allowed: true,
  },
  {
    name: "Sec-Fetch-Site: none (a typed or bookmarked navigation, user-initiated)",
    headers: { "sec-fetch-site": "none" },
    allowed: true,
  },
  {
    name: "Sec-Fetch-Site: cross-site with a foreign Origin (the forged POST)",
    headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    allowed: false,
    logged: { beltFetchSite: "cross-site", beltOrigin: "mismatch" },
  },
  {
    name: "Sec-Fetch-Site: same-site (a sibling subdomain, not us)",
    headers: { "sec-fetch-site": "same-site", origin: "https://other.qcms.test" },
    allowed: false,
    logged: { beltFetchSite: "same-site", beltOrigin: "mismatch" },
  },
  {
    name: "a foreign Origin and no Fetch Metadata (a client that sends neither)",
    headers: { origin: "https://evil.example" },
    allowed: false,
    logged: { beltFetchSite: "absent", beltOrigin: "mismatch" },
  },
  {
    name: "our own Origin and no Fetch Metadata (a same-origin API-style call)",
    headers: { origin: ADMIN_BASE },
    allowed: true,
  },
  {
    name: "Origin: null and no Fetch Metadata (Referrer-Policy: no-referrer, either side)",
    headers: { origin: "null" },
    allowed: false,

    logged: { beltFetchSite: "absent", beltOrigin: "null" },
  },
  {
    name: "neither header (fails closed rather than assuming friendly)",
    headers: {},
    allowed: false,
    logged: { beltFetchSite: "absent", beltOrigin: "absent" },
  },
];

interface GuardedRoute {
  readonly path: string;

  readonly post: (headers: Record<string, string>) => Promise<Response> | Response;

  readonly reached: () => (typeof seams)[keyof typeof seams];

  readonly refusalLocation: string | null;

  readonly refusalStatus?: number;

  readonly logged: { readonly beltRoute: string; readonly beltOutcome: string };

  readonly session?: unknown;
}

function formPost(path: string, headers: Record<string, string>, fields: FormData): Request {
  return new Request(`${ADMIN_BASE}${path}`, { method: "POST", headers, body: fields });
}

function form(entries: Record<string, string>): FormData {
  const fields = new FormData();
  for (const [name, value] of Object.entries(entries)) fields.set(name, value);
  return fields;
}

const ROUTES: readonly GuardedRoute[] = [
  {
    path: "app/sign-in/submit/route.ts",
    post: (headers) =>
      signInRoute.POST(
        formPost(
          "/sign-in/submit",
          headers,
          form({ email: "admin@example.test", password: "correct horse battery staple" }),
        ),
      ),
    reached: () => seams.signInEmail,
    refusalLocation: "/sign-in?error=1",
    logged: { beltRoute: "/sign-in/submit", beltOutcome: "redirect-with-failure" },
  },
  {
    path: "app/sign-out/route.ts",
    post: (headers) => signOutRoute.POST(formPost("/sign-out", headers, form({}))),
    reached: () => seams.signOut,
    refusalLocation: "/sign-in",
    logged: { beltRoute: "/sign-out", beltOutcome: "redirect-without-message" },
  },
  {
    path: "app/two-factor/challenge/verify/route.ts",
    post: (headers) =>
      challengeRoute.POST(
        formPost("/two-factor/challenge/verify", headers, form({ code: "123456" })),
      ),
    reached: () => seams.verifyTotp,
    refusalLocation: "/two-factor/challenge?error=1",
    logged: { beltRoute: "/two-factor/challenge/verify", beltOutcome: "redirect-with-failure" },
  },
  {
    path: "app/two-factor/enroll/verify/route.ts",
    post: (headers) =>
      enrollRoute.POST(formPost("/two-factor/enroll/verify", headers, form({ code: "123456" }))),
    reached: () => seams.verifyTotp,
    refusalLocation: "/two-factor/enroll?error=1",
    logged: { beltRoute: "/two-factor/enroll/verify", beltOutcome: "redirect-with-failure" },

    session: {
      session: { createdAt: new Date().toISOString(), token: "session-token" },
      user: { id: "usr_1", twoFactorEnabled: false, mustChangePassword: false },
    },
  },
  {
    path: "app/two-factor/recovery/verify/route.ts",
    post: (headers) =>
      recoveryRoute.POST(
        formPost("/two-factor/recovery/verify", headers, form({ code: "aaaa-bbbb" })),
      ),
    reached: () => seams.verifyBackupCode,
    refusalLocation: "/two-factor/recovery?error=1",
    logged: { beltRoute: "/two-factor/recovery/verify", beltOutcome: "redirect-with-failure" },
  },
  {
    path: "app/two-factor/recovery-codes/confirm/route.ts",
    post: (headers) =>
      confirmRoute.POST(formPost("/two-factor/recovery-codes/confirm", headers, form({}))),
    reached: () => seams.clearRecoveryCodesCookie,

    refusalLocation: "/",
    logged: {
      beltRoute: "/two-factor/recovery-codes/confirm",
      beltOutcome: "redirect-without-message",
    },
  },
  {
    path: "app/(shell)/settings/password/route.ts",
    post: (headers) =>
      passwordRoute.POST(
        formPost(
          "/settings/password",
          headers,
          form({ currentPassword: "old password here", newPassword: "new password here" }),
        ),
      ),
    reached: () => seams.changePassword,
    refusalLocation: "/settings?error=1",
    logged: { beltRoute: "/settings/password", beltOutcome: "redirect-with-failure" },
  },
  {
    path: "app/change-password/submit/route.ts",
    post: (headers) =>
      forcedPasswordRoute.POST(
        formPost(
          "/change-password/submit",
          headers,
          form({
            currentPassword: "old password here",
            newPassword: "new password here",
            confirmPassword: "new password here",
          }),
        ),
      ),
    reached: () => seams.changePassword,
    refusalLocation: "/change-password?error=1",
    logged: { beltRoute: "/change-password/submit", beltOutcome: "redirect-with-failure" },
    session: {
      session: { createdAt: new Date().toISOString(), token: "session-token" },
      user: { id: "usr_1", twoFactorEnabled: true, mustChangePassword: true },
    },
  },
  {
    path: "app/(shell)/settings/recovery-codes/route.ts",
    post: (headers) =>
      codesRoute.POST(
        formPost("/settings/recovery-codes", headers, form({ password: "old password here" })),
      ),
    reached: () => seams.generateBackupCodes,
    refusalLocation: "/settings?codesError=1",
    logged: { beltRoute: "/settings/recovery-codes", beltOutcome: "redirect-with-failure" },
  },
  {
    path: "app/(shell)/forms/[formId]/assist/route.ts",
    post: (headers) => {
      vi.stubEnv("QCMS_FLAG_AGENT_AUTHORING", "fake");
      return assistRoute.POST(
        new Request(`${ADMIN_BASE}/forms/frm_quote/assist`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ conversation: [] }),
        }) as never,
        { params: Promise.resolve({ formId: "frm_quote" }) },
      );
    },
    reached: () => seams.assist,
    refusalLocation: null,
    refusalStatus: 403,
    logged: { beltRoute: "/forms/{formId}/assist", beltOutcome: "refused-403" },
  },
  {
    path: "app/(shell)/assist/route.ts",
    post: (headers) => {
      vi.stubEnv("QCMS_FLAG_AGENT_AUTHORING", "fake");
      return screenAssistRoute.POST(
        new Request(`${ADMIN_BASE}/assist`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ conversation: [], screen: "/settings", conversationId: "cnv_1" }),
        }) as never,
      );
    },
    reached: () => seams.screenAssist,
    refusalLocation: null,
    refusalStatus: 403,
    logged: { beltRoute: "/assist", beltOutcome: "refused-403" },
  },
];

describe("isSameOriginPost", () => {
  it.each(ORIGIN_CASES)("$name -> allowed: $allowed", ({ headers, allowed }) => {
    expect(
      isSameOriginPost(new Request(`${ADMIN_BASE}/sign-in/submit`, { method: "POST", headers })),
    ).toBe(allowed);
  });

  it.each(ORIGIN_CASES)("$name -> writes one line only when it refuses", ({ headers, allowed }) => {
    isSameOriginPost(new Request(`${ADMIN_BASE}/sign-in/submit`, { method: "POST", headers }));

    expect(refusalLines()).toHaveLength(allowed ? 0 : 1);
  });

  it("every refused case says what the line must classify it as", () => {
    for (const probe of ORIGIN_CASES) {
      expect({ name: probe.name, hasExpectation: probe.logged !== undefined }).toEqual({
        name: probe.name,
        hasExpectation: !probe.allowed,
      });
    }
  });

  it("compares against the configured base URL rather than the request's own host", () => {
    const request = new Request("https://evil.example/sign-in/submit", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(isSameOriginPost(request)).toBe(false);
  });

  it("covers every belted route the module claims", async () => {
    const { BELTED_ROUTE_TEMPLATES } = await import("./origin-belt-log.ts");
    const order = (a: string, b: string): number => a.localeCompare(b);
    expect(ROUTES.map((route) => route.logged.beltRoute).sort(order)).toEqual(
      [...BELTED_ROUTE_TEMPLATES].sort(order),
    );
  });
});

describe.each(ROUTES)("$path", (route) => {
  beforeEach(() => {
    for (const seam of Object.values(seams)) seam.mockClear();
    seams.signInEmail.mockResolvedValue(authResponse({}));
    seams.signOut.mockResolvedValue(authResponse({}));
    seams.verifyTotp.mockResolvedValue(authResponse({}));
    seams.verifyBackupCode.mockResolvedValue(authResponse({}));
    seams.generateBackupCodes.mockResolvedValue(authResponse({ backupCodes: [] }));
    seams.changePassword.mockResolvedValue(authResponse({}));
    seams.enableTwoFactor.mockResolvedValue(
      authResponse({ totpURI: "otpauth://", backupCodes: [] }),
    );
    seams.proxiedSession.mockResolvedValue({ user: { twoFactorEnabled: true } });

    seams.assist.mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    seams.screenAssist.mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    seams.requireAdminSessionForRequest.mockResolvedValue(SESSION);
    if (route.session !== undefined) seams.proxiedSession.mockResolvedValue(route.session);
  });

  it.each(ORIGIN_CASES.filter((probe) => probe.allowed))(
    "proceeds past the belt with $name",
    async ({ headers }) => {
      await route.post(headers);
      expect(route.reached()).toHaveBeenCalled();

      expect(refusalLines()).toEqual([]);
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "changes nothing and refuses with $name",
    async ({ headers }) => {
      const response = await route.post(headers);

      for (const seam of Object.values(seams)) expect(seam).not.toHaveBeenCalled();
      expect(response.status).toBe(route.refusalStatus ?? 303);
      expect(response.headers.get("location")).toBe(route.refusalLocation);
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "writes exactly one refusal line, carrying route, signals and outcome, with $name",
    async ({ headers, logged }) => {
      await route.post(headers);

      expect(refusalLines()).toEqual([
        expect.objectContaining({
          level: "warn",
          msg: "origin.belt.refused",
          service: "qcms-admin",
          beltRoute: route.logged.beltRoute,
          beltOutcome: route.logged.beltOutcome,
          ...logged,
        }),
      ]);
    },
  );

  it("names the outcome the person at the keyboard actually gets", async () => {
    const refused = ORIGIN_CASES.find((probe) => !probe.allowed);
    const response = await route.post(refused?.headers ?? {});
    expect(response.headers.get("location")).toBe(route.refusalLocation);
    expect(route.logged.beltOutcome).toBe(outcomeOnTheWire(response));
  });
});
