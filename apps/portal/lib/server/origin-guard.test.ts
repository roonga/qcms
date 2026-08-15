import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-9's CSRF belt on the portal's state-changing BFF routes (issue #487).
 *
 * ## What is being defended, stated at its real size
 *
 * `SameSite=Lax` on `qcms_session` is the primary control and it holds. A respondent
 * session token authorizes only `{read step, answer, submit}` on exactly one session
 * (SEC-2, SEC-3), so the worst a forged cross-origin POST could do is corrupt the
 * victim's own in-progress response. There is no cross-session, cross-form or admin
 * reach in it. This is defense in depth, not an account-takeover path, and the tests
 * below should not be read as closing one.
 *
 * ## Why the assertions are shaped this way
 *
 * Every case asserts on the **API client**, not only on the status code. A route that
 * refuses after already forwarding the answer has not refused, and a status assertion
 * alone cannot tell the two apart: the refusal shape on two of these routes is a 303
 * that the success path also emits. So the invariant each case pins is "the internal
 * API was reached" or "the internal API was not reached", which is the thing that
 * actually decides whether state changed.
 *
 * The negative cases send a genuinely foreign `Origin`, because a request with **no**
 * `Origin` header is not a discriminating probe on every guard shape, and a test that
 * passes against the unguarded handler is the exact defect class the 040 review spent
 * its run cataloguing.
 *
 * `Origin: null` has its own case. It is not a hypothetical: `proxy.ts` sets
 * `Referrer-Policy: no-referrer`, and per Fetch a navigation POST under that policy
 * serializes its origin as the literal string `null`. It is therefore what the
 * portal's own no-JS form path sends, and also what an attacker's page sends if it
 * declares the same policy, so it must be refused rather than read as "local".
 * `Sec-Fetch-Site` is what separates the two, which is why it is read first.
 */

const PORTAL_BASE = "https://forms.qcms.test";

/**
 * The server configuration the real `./config` reads, which these tests deliberately do
 * not mock: the belt's `Origin` comparison must run against a genuinely configured base
 * URL, or it would be comparing a stub to itself.
 *
 * Applied once at module scope so the route imports below cannot observe an unset
 * environment, and re-applied per test because {@link afterEach} clears it. Restoring
 * matters here rather than being tidiness: Vitest shares a worker process across files,
 * so a stub left standing is a value some unrelated portal test reads without asking
 * for it, and a security suite that leaks configuration is exactly how a test ends up
 * passing for a reason nobody chose. Raised in review of PR #500; the convention is
 * already `vi.unstubAllEnvs()` in `config.test.ts`, `api.test.ts` and `client-address.test.ts`.
 */
function stubPortalEnv(): void {
  vi.stubEnv("QCMS_PORTAL_BASE_URL", PORTAL_BASE);
  vi.stubEnv("QCMS_API_BASE_URL", "http://api.internal");
  vi.stubEnv("QCMS_INTERNAL_TOKEN", "internal-token");
}

stubPortalEnv();
beforeEach(stubPortalEnv);
afterEach(() => {
  vi.unstubAllEnvs();
});

/** The internal API client: the seam every "did state change?" assertion reads. */
const api = {
  startSession: vi.fn(),
  submitAnswer: vi.fn(),
  submitSession: vi.fn(),
  getStep: vi.fn(),
};

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

// The factory runs when the route modules below are first imported, which is after
// `api` is initialised, so the mocks are the very same spies the assertions read.
vi.mock("@/lib/server/api", () => ({
  ApiError: FakeApiError,
  startSession: api.startSession,
  submitAnswer: api.submitAnswer,
  submitSession: api.submitSession,
  getStep: api.getStep,
}));

vi.mock("@/lib/server/session-cookie", () => ({
  readSessionToken: () => Promise.resolve("respondent-bearer"),
  writeSessionToken: () => Promise.resolve(),
  clearSessionToken: () => Promise.resolve(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

/*
 * The `@/` alias is a tsconfig path that Next resolves and Vitest does not, so a route
 * module imported here cannot load its own dependencies by that specifier. These four
 * entries are alias plumbing rather than test doubles: each hands back the **real**
 * module, reached by a relative path from this file. Without them the routes could
 * only be exercised against doubles of every collaborator, and a test that replaces
 * everything the handler talks to proves progressively less about the handler.
 *
 * `route-helpers` in particular must be the real module: it is where the belt under
 * test lives, and mocking it would make every assertion below a tautology.
 */
vi.mock("@/lib/server/config", async () => await import("./config"));
vi.mock("@/lib/server/route-helpers", async () => await import("./route-helpers"));
vi.mock("@/lib/server/step-form", async () => await import("./step-form"));
vi.mock("@/lib/i18n/en", async () => await import("../i18n/en"));
vi.mock("@/lib/validation-message", async () => await import("../validation-message"));

const { isSameOriginPost } = await import("./route-helpers");
const startRoute = await import("../../app/f/[formSlug]/start/route");
const answersRoute = await import("../../app/s/[sessionId]/answers/route");
const stepRoute = await import("../../app/s/[sessionId]/step/route");
const submitRoute = await import("../../app/s/[sessionId]/submit/route");

/** One header shape a POST can arrive with, and whether the belt lets it through. */
interface OriginCase {
  readonly name: string;
  readonly headers: Record<string, string>;
  readonly allowed: boolean;
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
  },
  {
    name: "Sec-Fetch-Site: same-site (a sibling subdomain, not us)",
    headers: { "sec-fetch-site": "same-site", origin: "https://other.qcms.test" },
    allowed: false,
  },
  {
    name: "a foreign Origin and no Fetch Metadata (a client that sends neither)",
    headers: { origin: "https://evil.example" },
    allowed: false,
  },
  {
    name: "our own Origin and no Fetch Metadata (the hydrated fetch() path)",
    headers: { origin: PORTAL_BASE },
    allowed: true,
  },
  {
    name: "Origin: null and no Fetch Metadata (Referrer-Policy: no-referrer, either side)",
    headers: { origin: "null" },
    allowed: false,
  },
  {
    name: "neither header (fails closed rather than assuming friendly)",
    headers: {},
    allowed: false,
  },
];

/** One state-changing route, driven end to end through its exported `POST`. */
interface GuardedRoute {
  /** Repo-relative path, so a red names the file to open. */
  readonly path: string;
  /** Invoke `POST` with these request headers. */
  readonly post: (headers: Record<string, string>) => Promise<Response>;
  /** The API call this route makes once it is past the belt. */
  readonly reached: () => (typeof api)[keyof typeof api];
  /** What the refusal looks like on the wire, beyond having changed nothing. */
  readonly assertRefusal: (response: Response) => void | Promise<void>;
}

function formPost(url: string, headers: Record<string, string>, form: FormData): Request {
  return new Request(url, { method: "POST", headers, body: form });
}

function jsonPost(url: string, headers: Record<string, string>, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROUTES: readonly GuardedRoute[] = [
  {
    path: "app/f/[formSlug]/start/route.ts",
    post: (headers) => {
      const form = new FormData();
      form.set("challengeToken", "tok");
      return startRoute.POST(formPost(`${PORTAL_BASE}/f/survey/start`, headers, form), {
        params: Promise.resolve({ formSlug: "survey" }),
      });
    },
    reached: () => api.startSession,
    assertRefusal: (response) => {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/f/survey?state=error`);
    },
  },
  {
    path: "app/s/[sessionId]/answers/route.ts",
    post: (headers) =>
      answersRoute.POST(
        jsonPost(`${PORTAL_BASE}/s/ses_1/answers`, headers, { questionId: "q_1", value: "x" }),
        { params: Promise.resolve({ sessionId: "ses_1" }) },
      ),
    reached: () => api.submitAnswer,
    assertRefusal: async (response) => {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: { code: "forbidden" } });
    },
  },
  {
    path: "app/s/[sessionId]/step/route.ts",
    post: (headers) =>
      stepRoute.POST(formPost(`${PORTAL_BASE}/s/ses_1/step`, headers, new FormData()), {
        params: Promise.resolve({ sessionId: "ses_1" }),
      }),
    reached: () => api.getStep,
    assertRefusal: (response) => {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/s/ses_1`);
    },
  },
  {
    path: "app/s/[sessionId]/submit/route.ts",
    post: (headers) =>
      submitRoute.POST(jsonPost(`${PORTAL_BASE}/s/ses_1/submit`, headers, {}), {
        params: Promise.resolve({ sessionId: "ses_1" }),
      }),
    reached: () => api.submitSession,
    assertRefusal: async (response) => {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: { code: "forbidden" } });
    },
  },
];

describe("isSameOriginPost", () => {
  it.each(ORIGIN_CASES)("$name -> allowed: $allowed", ({ headers, allowed }) => {
    expect(
      isSameOriginPost(new Request(`${PORTAL_BASE}/s/ses_1/submit`, { method: "POST", headers })),
    ).toBe(allowed);
  });

  it("compares against the configured base URL rather than the request's own host", () => {
    // The request URL is attacker-chosen on a forged POST, so reading the origin back
    // off it would compare a value to itself and pass everything.
    const request = new Request("https://evil.example/s/ses_1/submit", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(isSameOriginPost(request)).toBe(false);
  });
});

describe.each(ROUTES)("$path", (route) => {
  beforeEach(() => {
    api.startSession.mockReset().mockResolvedValue({ sessionId: "ses_1", sessionToken: "bearer" });
    api.submitAnswer.mockReset().mockResolvedValue({ flowState: { readyToSubmit: false } });
    api.getStep.mockReset().mockResolvedValue({ flowState: { readyToSubmit: false } });
    api.submitSession
      .mockReset()
      .mockResolvedValue({ submittedAt: new Date().toISOString(), contentHash: "hash" });
  });

  it.each(ORIGIN_CASES.filter((probe) => probe.allowed))(
    "proceeds to the internal API with $name",
    async ({ headers }) => {
      await route.post(headers);
      expect(route.reached()).toHaveBeenCalled();
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "changes nothing and refuses with $name",
    async ({ headers }) => {
      const response = await route.post(headers);
      expect(route.reached()).not.toHaveBeenCalled();
      // Nothing else on the client may have been reached either: a route that
      // refused one call but made another has still let a cross-site caller act.
      for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
      await route.assertRefusal(response);
    },
  );
});
