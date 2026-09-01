import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-9's CSRF belt on the admin's state-changing BFF routes, and the line each refusal
 * now writes (issue #620).
 *
 * ## What is being defended, stated at its real size
 *
 * Every route below is an authentication or credential route: sign-in, sign-out, the
 * TOTP challenge, TOTP enrolment, the recovery-code redemption and confirmation, and
 * the password change. `SameSite=Lax` on the session cookie is the primary control and
 * it holds; this belt is the second layer for a client that does not enforce it.
 *
 * That is also why the log line matters more here than on the portal, and for a
 * different reason. The portal's equivalent counts an accepted population of
 * respondents on browsers too old for Fetch Metadata. This one is the only trace a
 * cross-origin probe against the admin's authentication surface leaves anywhere: a
 * burst of refusals on `/two-factor/challenge/verify` is not an old browser, and nobody
 * files a support ticket to report that they are probing your two-factor endpoint. A
 * refusal that produces no line is a refusal that never happened as far as an operator
 * can tell.
 *
 * ## Why the assertions are shaped this way
 *
 * Every case asserts on the **collaborator seam**, not only on the status code. A route
 * that refuses after already calling the API's auth mount has not refused, and a status
 * assertion alone cannot tell the two apart: every refusal here is a 303, and so is
 * every success. So the invariant each case pins is "nothing downstream was reached",
 * which is what actually decides whether auth state changed.
 *
 * The negative cases send a genuinely foreign `Origin`, because a request with **no**
 * `Origin` header is not a discriminating probe on every guard shape.
 *
 * `Origin: null` has its own case. It is not a hypothetical: `proxy.ts` sets
 * `Referrer-Policy: no-referrer`, and per Fetch a navigation POST under that policy
 * serializes its origin as the literal string `null`. Every auth screen here is exactly
 * such a POST, and an attacker's page can declare the same policy, so it must be
 * refused rather than read as "local". `Sec-Fetch-Site` is what separates the two,
 * which is why it is read first (`docs/RETRO.md`, the 031 entry, is what happens when
 * it is not).
 *
 * ## The refusal is asserted to be observable
 *
 * Every refusal case pins that the belt wrote **exactly one** log line, and every
 * admitted case pins that it wrote none. Exactly-one rather than at-least-one because a
 * duplicated line on any route would silently double an operator's refusal count, and
 * on this surface that count is the alarm.
 *
 * The capture is a **real** `createJsonLogger` writing into an array, not a spy on the
 * logger interface: the assertions then read the serialized line the admin's stdout
 * would carry, so they see the SEC-8 redaction pass as well as the fields the caller
 * chose. A spy would assert what the belt *asked* to log, which is the weaker claim.
 */

const ADMIN_BASE = "https://admin.qcms.test";

/**
 * The server configuration the real `./config.ts` reads, which these tests deliberately
 * do not mock: the belt's `Origin` comparison must run against a genuinely configured
 * base URL, or it would be comparing a stub to itself.
 *
 * Applied once at module scope so the route imports below cannot observe an unset
 * environment, and re-applied per test because {@link afterEach} clears it. Restoring
 * matters here rather than being tidiness: Vitest shares a worker process across files,
 * so a stub left standing is a value some unrelated admin test reads without asking for
 * it.
 */
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

/** The session a signed-in admin has, for the two `(shell)/settings` handlers. */
const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

/** A better-auth response as the API's auth mount would return it. */
function authResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "qcms_admin.session_token=s" },
    ...init,
  });
}

/**
 * Every seam a belted admin handler can reach once it is past the belt.
 *
 * One object rather than a mock per route, so that "a refused request reached nothing"
 * can be asserted over the whole set on every route. A handler that refused its own
 * call but made a neighbour's has still let a cross-site caller act.
 */
const seams = {
  signInEmail: vi.fn(),
  signOut: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  generateBackupCodes: vi.fn(),
  changePassword: vi.fn(),
  enableTwoFactor: vi.fn(),
  proxiedSession: vi.fn(),
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

/**
 * The admin's stdout, captured. `vi.hoisted` because the `vi.mock` factory below is
 * lifted above every other statement in this file, so an ordinary `const` would not
 * exist yet when the factory runs.
 */
const { emitted } = vi.hoisted(() => ({ emitted: [] as string[] }));

/**
 * The one substitution: the logger's **sink**, not the logger. `createJsonLogger` is the
 * real one, so redaction, field ordering and serialization all run exactly as they do in
 * the admin, and `emitted` holds the very lines an operator would grep.
 */
vi.mock("./logger.ts", async () => {
  const { createJsonLogger } = await import("@qcms/observability/logger");
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

/*
 * `route-helpers` and `config` carry no registration at all: they are where the belt under
 * test lives, and faking either would make every assertion below a tautology. `session` is
 * the real module too, so the redirect paths the handlers use are the ones the app uses -
 * only its request guard is a spy, because it reaches the API.
 */
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
const codesRoute = await import("../../app/(shell)/settings/recovery-codes/route.ts");

/** The refusal lines written since the last test started, parsed. */
function refusalLines(): Record<string, unknown>[] {
  return emitted
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["msg"] === "origin.belt.refused");
}

/**
 * The refusal outcome read back off a real refusal response, in the same vocabulary the
 * log line uses.
 *
 * Derived from the wire rather than from the route table, so that comparing the two says
 * something. Every admin refusal is a 303; what separates them is whether the redirect
 * carries the opaque failure marker that makes a screen render its one generic sentence.
 */
function outcomeOnTheWire(response: Response): string {
  const location = new URL(response.headers.get("location") ?? "", ADMIN_BASE);
  return location.search === "" ? "redirect-without-message" : "redirect-with-failure";
}

/** One header shape a POST can arrive with, and whether the belt lets it through. */
interface OriginCase {
  readonly name: string;
  readonly headers: Record<string, string>;
  readonly allowed: boolean;
  /**
   * How the refusal line must classify these headers. Required on every refused case and
   * absent on every admitted one, which is checked below: a refused case that forgot its
   * expectation would otherwise assert only that *some* line was written.
   */
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
    // The shape that separates the honest old browser from the forgery: no Fetch
    // Metadata at all, and the `null` origin the admin's own auth forms produce.
    logged: { beltFetchSite: "absent", beltOrigin: "null" },
  },
  {
    name: "neither header (fails closed rather than assuming friendly)",
    headers: {},
    allowed: false,
    logged: { beltFetchSite: "absent", beltOrigin: "absent" },
  },
];

/** One state-changing route, driven end to end through its exported `POST`. */
interface GuardedRoute {
  /** Repo-relative path, so a red names the file to open. */
  readonly path: string;
  /** Invoke `POST` with these request headers. */
  readonly post: (headers: Record<string, string>) => Promise<Response> | Response;
  /** The seam this route reaches once it is past the belt. */
  readonly reached: () => (typeof seams)[keyof typeof seams];
  /** Where a refusal lands, as an app-relative `Location`. */
  readonly refusalLocation: string;
  /**
   * The route template the refusal line must carry, and the outcome it must name.
   *
   * `beltOutcome` is asserted here, beside {@link refusalLocation}, on purpose: the belt
   * runs before the handler builds its response, so the outcome is derived from the
   * route rather than observed, and the two would otherwise be free to drift. Asserting
   * the real response and the logged claim about it in one case makes a drift a red.
   */
  readonly logged: { readonly beltRoute: string; readonly beltOutcome: string };
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
    refusalLocation: "/questions",
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
    path: "app/(shell)/settings/recovery-codes/route.ts",
    post: (headers) =>
      codesRoute.POST(
        formPost("/settings/recovery-codes", headers, form({ password: "old password here" })),
      ),
    reached: () => seams.generateBackupCodes,
    refusalLocation: "/settings?codesError=1",
    logged: { beltRoute: "/settings/recovery-codes", beltOutcome: "redirect-with-failure" },
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
    // At the belt itself rather than only through the routes: this is the seam that
    // guarantees the count, so a second `return false` branch added here without a
    // second line, or with two, is caught before any route is involved.
    expect(refusalLines()).toHaveLength(allowed ? 0 : 1);
  });

  it("every refused case says what the line must classify it as", () => {
    // Guards the table rather than the code. A refused case added below without a
    // `logged` expectation would still pass the route assertions, having asserted only
    // that some line was written - which is the weaker claim this file is avoiding.
    for (const probe of ORIGIN_CASES) {
      expect({ name: probe.name, hasExpectation: probe.logged !== undefined }).toEqual({
        name: probe.name,
        hasExpectation: !probe.allowed,
      });
    }
  });

  it("compares against the configured base URL rather than the request's own host", () => {
    // The request URL is attacker-chosen on a forged POST, so reading the origin back off
    // it would compare a value to itself and pass everything.
    const request = new Request("https://evil.example/sign-in/submit", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(isSameOriginPost(request)).toBe(false);
  });

  it("covers every belted route the module claims", async () => {
    // The enumeration in `origin-belt-log.test.ts` derives the belted set from disk. This
    // asserts that the set is the set driven end to end here, so a route added to the
    // table without a case below is a red rather than an untested handler.
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
    seams.requireAdminSessionForRequest.mockResolvedValue(SESSION);
  });

  it.each(ORIGIN_CASES.filter((probe) => probe.allowed))(
    "proceeds past the belt with $name",
    async ({ headers }) => {
      await route.post(headers);
      expect(route.reached()).toHaveBeenCalled();
      // An admitted request writes no refusal line. Without this, a belt that logged
      // unconditionally would pass every "exactly one" assertion below while making the
      // count useless.
      expect(refusalLines()).toEqual([]);
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "changes nothing and refuses with $name",
    async ({ headers }) => {
      const response = await route.post(headers);
      // Nothing anywhere downstream may have been reached: a route that refused its own
      // call but made another has still let a cross-site caller act. `requireAdminSession
      // ForRequest` is in the sweep too, so a refusal must not even resolve the session.
      for (const seam of Object.values(seams)) expect(seam).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(route.refusalLocation);
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "writes exactly one refusal line, carrying route, signals and outcome, with $name",
    async ({ headers, logged }) => {
      await route.post(headers);
      // `toEqual` on the whole array rather than a length check plus a member check: it
      // fails readably on a duplicate and pins the fields at the same time.
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
    // The belt runs before the handler builds its response, so `beltOutcome` is derived
    // from the route rather than observed. This is the cross-check that keeps the
    // derivation honest: the response asserted here is the real one this route returns,
    // and the mapping under test is what the log line claims about it.
    const refused = ORIGIN_CASES.find((probe) => !probe.allowed);
    const response = await route.post(refused?.headers ?? {});
    expect(response.headers.get("location")).toBe(route.refusalLocation);
    expect(route.logged.beltOutcome).toBe(outcomeOnTheWire(response));
  });
});
