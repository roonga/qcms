import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
const challengeRoute = await import("../../app/two-factor/challenge/verify/route.ts");
const enrollRoute = await import("../../app/two-factor/enroll/verify/route.ts");
const recoveryRoute = await import("../../app/two-factor/recovery/verify/route.ts");
const passwordRoute = await import("../../app/(shell)/settings/password/route.ts");
const forcedPasswordRoute = await import("../../app/change-password/submit/route.ts");
const codesRoute = await import("../../app/(shell)/settings/recovery-codes/route.ts");
const { authFailureMessage } = await import("../auth-failure-message.ts");
const { messages } = await import("../i18n/en.ts");

function refusal(status: number): Response {
  return new Response(JSON.stringify({ message: "refused" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function formPost(path: string, fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(`${ADMIN_BASE}${path}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body,
  });
}

const SHARED_MARKERS = { throttled: "throttled", refused: "error" } as const;

const CODES_MARKERS = { throttled: "codesThrottled", refused: "codesError" } as const;

interface RefusingRoute {
  readonly path: string;

  readonly screen: string;

  readonly markers: { readonly throttled: string; readonly refused: string };

  readonly refuseWith: (status: number) => void;
  readonly post: () => Promise<Response>;

  readonly session?: () => unknown;
}

function sentenceRenderedFor(route: RefusingRoute, response: Response): string | undefined {
  const location = response.headers.get("location") ?? "";
  const query = new URL(location, ADMIN_BASE).searchParams;
  return authFailureMessage({
    throttled: query.get(route.markers.throttled) ?? undefined,
    error: query.get(route.markers.refused) ?? undefined,
  });
}

const ROUTES: readonly RefusingRoute[] = [
  {
    path: "app/sign-in/submit/route.ts",
    screen: "/sign-in",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.signInEmail.mockResolvedValue(refusal(status)),
    post: () =>
      signInRoute.POST(
        formPost("/sign-in/submit", {
          email: "admin@example.test",
          password: "correct horse battery staple",
        }),
      ),
  },
  {
    path: "app/two-factor/challenge/verify/route.ts",
    screen: "/two-factor/challenge",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.verifyTotp.mockResolvedValue(refusal(status)),
    post: () => challengeRoute.POST(formPost("/two-factor/challenge/verify", { code: "123456" })),
  },
  {
    path: "app/two-factor/enroll/verify/route.ts",
    screen: "/two-factor/enroll",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.verifyTotp.mockResolvedValue(refusal(status)),
    post: () => enrollRoute.POST(formPost("/two-factor/enroll/verify", { code: "123456" })),
    session: enrollingSession,
  },
  {
    path: "app/two-factor/recovery/verify/route.ts",
    screen: "/two-factor/recovery",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.verifyBackupCode.mockResolvedValue(refusal(status)),
    post: () => recoveryRoute.POST(formPost("/two-factor/recovery/verify", { code: "aaaa-bbbb" })),
  },
  {
    path: "app/(shell)/settings/password/route.ts",
    screen: "/settings",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.changePassword.mockResolvedValue(refusal(status)),
    post: () =>
      passwordRoute.POST(
        formPost("/settings/password", {
          currentPassword: "correct horse battery staple",
          newPassword: "a much longer replacement",
        }),
      ),
  },
  {
    path: "app/change-password/submit/route.ts",
    screen: "/change-password",
    markers: SHARED_MARKERS,
    session: () => provisionalSession(),
    refuseWith: (status) => seams.changePassword.mockResolvedValue(refusal(status)),
    post: () =>
      forcedPasswordRoute.POST(
        formPost("/change-password/submit", {
          currentPassword: "correct horse battery staple",
          newPassword: "a much longer replacement",
          confirmPassword: "a much longer replacement",
        }),
      ),
  },
  {
    path: "app/(shell)/settings/recovery-codes/route.ts",
    screen: "/settings",
    markers: CODES_MARKERS,
    refuseWith: (status) => seams.generateBackupCodes.mockResolvedValue(refusal(status)),
    post: () =>
      codesRoute.POST(
        formPost("/settings/recovery-codes", { password: "correct horse battery staple" }),
      ),
  },
];

function signedInSession(): unknown {
  return {
    session: { createdAt: new Date().toISOString(), token: "session-token" },
    user: {
      id: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: true,
    },
  };
}

function provisionalSession(): unknown {
  return {
    session: { createdAt: new Date().toISOString(), token: "session-token" },
    user: {
      id: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: true,
      mustChangePassword: true,
    },
  };
}

function enrollingSession(): unknown {
  return {
    session: { createdAt: new Date().toISOString(), token: "session-token" },
    user: {
      id: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: false,
      mustChangePassword: false,
    },
  };
}

beforeEach(() => {
  for (const seam of Object.values(seams)) seam.mockReset();
  seams.proxiedSession.mockResolvedValue(signedInSession());
});

describe.each(ROUTES)("$path", (route) => {
  beforeEach(() => {
    if (route.session !== undefined) seams.proxiedSession.mockResolvedValue(route.session());
  });

  it("redirects with the throttled marker when the auth mount answers 429", async () => {
    route.refuseWith(429);
    const response = await route.post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${route.screen}?${route.markers.throttled}=1`);

    expect(sentenceRenderedFor(route, response)).toBe(messages["signIn.throttled"]);
  });

  it("still redirects with the generic marker when the credential was refused", async () => {
    route.refuseWith(401);
    const response = await route.post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${route.screen}?${route.markers.refused}=1`);
    expect(sentenceRenderedFor(route, response)).toBe(messages["signIn.error"]);
  });

  it("issues no cookies on either refusal", async () => {
    for (const status of [429, 401]) {
      route.refuseWith(status);
      expect((await route.post()).headers.getSetCookie()).toEqual([]);
    }
  });
});

describe("the marker the screen reads", () => {
  it("renders the throttled sentence, which tells the operator to wait rather than retype", () => {
    expect(authFailureMessage({ throttled: "1" })).toBe(messages["signIn.throttled"]);
  });

  it("renders the generic failure sentence for the credential refusal", () => {
    expect(authFailureMessage({ error: "1" })).toBe(messages["signIn.error"]);
  });

  it("prefers throttled over a marker that would understate it", () => {
    expect(authFailureMessage({ throttled: "1", error: "1" })).toBe(messages["signIn.throttled"]);
  });

  it("shows nothing on a first visit", () => {
    expect(authFailureMessage({})).toBeUndefined();
  });

  it("keeps the two sentences distinct", () => {
    expect(messages["signIn.throttled"]).not.toBe(messages["signIn.error"]);
  });
});

describe("every admin handler that reads an auth refusal is accounted for", () => {
  it("is the table above and nothing else, with no exclusions left", () => {
    const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
    const handlers = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith("route.ts"))
      .filter((entry) => readFileSync(`${appDir}${entry}`, "utf8").includes("authRefused"))
      .map((entry) => `app/${entry.split("\\").join("/")}`);

    const order = (a: string, b: string): number => a.localeCompare(b);
    expect([...handlers].sort(order)).toEqual([...ROUTES.map((route) => route.path)].sort(order));
  });
});
