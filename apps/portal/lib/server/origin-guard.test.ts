import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-9's CSRF belt on the portal's state-changing BFF routes.
 *
 * Every case asserts on the API client rather than only the status code, because a
 * route that refuses after forwarding the answer has not refused, and the refusal shape
 * on two of these routes is a 303 the success path also emits.
 *
 * The negative cases send a genuinely foreign `Origin`: a request with no `Origin` is
 * not a discriminating probe on every guard shape, so such a test can pass against an
 * unguarded handler.
 *
 * Each refusal case also pins that the belt wrote exactly one log line, and each
 * admitted case that it wrote none. Exactly one, because a duplicate would silently
 * double an operator's refusal count, which is the whole reason the line exists. The
 * capture is a real logger writing into an array rather than a spy, so the assertions
 * read the serialized line the portal's stdout would carry, redaction pass included.
 */

const PORTAL_BASE = "https://forms.qcms.test";

/**
 * The real `./config` is deliberately not mocked: the belt's `Origin` comparison has to
 * run against a genuinely configured base URL, or it would be comparing a stub to
 * itself.
 *
 * Applied at module scope so the route imports cannot observe an unset environment, and
 * re-applied per test because {@link afterEach} clears it. Restoring matters because
 * Vitest shares a worker process across files, so a stub left standing is a value some
 * unrelated test reads without asking for it.
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

/** The seam every "did state change?" assertion reads. */
const api = {
  startAnonymousSession: vi.fn(),
  startLinkSession: vi.fn(),
  submitAnswer: vi.fn(),
  submitSession: vi.fn(),
  getStep: vi.fn(),
  rosterOp: vi.fn(),
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

// The factory runs when the route modules are first imported, which is after `api` is
// initialised, so the mocks are the same spies the assertions read.
vi.mock("@/lib/server/api", () => ({
  ApiError: FakeApiError,
  startAnonymousSession: api.startAnonymousSession,
  startLinkSession: api.startLinkSession,
  submitAnswer: api.submitAnswer,
  submitSession: api.submitSession,
  getStep: api.getStep,
  rosterOp: api.rosterOp,
}));

vi.mock("@/lib/server/session-cookie", () => ({
  readSessionToken: () => Promise.resolve("respondent-bearer"),
  writeSessionToken: () => Promise.resolve(),
  clearSessionToken: () => Promise.resolve(),
}));

/**
 * `headers()` is the only way an action reaches its own request, so this is the seam the
 * action's belt reads; a route handler is handed a `Request` and needs none of it.
 */
const { actionHeaders } = vi.hoisted(() => ({ actionHeaders: { current: new Headers() } }));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
  headers: () => Promise.resolve(actionHeaders.current),
}));

/**
 * `vi.hoisted` because the `vi.mock` factory below is lifted above every other statement
 * in this file, so an ordinary `const` would not exist yet when the factory runs.
 */
const { emitted } = vi.hoisted(() => ({ emitted: [] as string[] }));

/**
 * The substitution is the logger's sink, not the logger: `createJsonLogger` is the real
 * one, so redaction, field ordering and serialization run as they do in the portal.
 */
vi.mock("./logger", async () => {
  const { createJsonLogger } = await import("@roonga/qcms-observability/logger");
  return {
    serverLogger: createJsonLogger({
      base: { service: "qcms-portal" },
      write: (line: string) => emitted.push(line),
    }),
  };
});

beforeEach(() => {
  emitted.length = 0;
});

/**
 * Derived from the wire rather than from the route table, so that comparing the two says
 * something.
 */
function outcomeOnTheWire(response: Response): string {
  if (response.status === 403) return "forbidden";
  const location = new URL(response.headers.get("location") ?? "", PORTAL_BASE);
  if (location.pathname === "/") return "redirect-to-root";
  return location.pathname.startsWith("/f/") ? "redirect-to-entry" : "redirect-to-step";
}

function refusalLines(): Record<string, unknown>[] {
  return emitted
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["msg"] === "origin.belt.refused");
}

/*
 * The `@/` alias is a tsconfig path Next resolves and Vitest does not, so a route module
 * imported here cannot load its own dependencies by that specifier. Every entry below is
 * alias plumbing rather than a test double: each hands back the real module by a relative
 * path. `route-helpers` in particular must be real, since it is where the belt under test
 * lives and mocking it would make every assertion a tautology.
 */
vi.mock("@/lib/server/config", async () => await import("./config"));
vi.mock("@/lib/server/environment", async () => await import("./environment"));
vi.mock("@/lib/server/route-helpers", async () => await import("./route-helpers"));
vi.mock("@/lib/server/step-form", async () => await import("./step-form"));
vi.mock("@/lib/server/appearance-form", async () => await import("./appearance-form"));
vi.mock("@/lib/server/theme", async () => await import("./theme"));
vi.mock("@/lib/appearance", async () => await import("../appearance"));
vi.mock("@/lib/i18n/en", async () => await import("../i18n/en"));
vi.mock("@/lib/repeat", async () => await import("../repeat"));
vi.mock("@/lib/validation-message", async () => await import("../validation-message"));

const { isSameOriginPost } = await import("./route-helpers");
const appearanceRoute = await import("../../app/appearance/route");
const startRoute = await import("../../app/f/[formSlug]/start/route");
const answersRoute = await import("../../app/s/[sessionId]/answers/route");
const stepRoute = await import("../../app/s/[sessionId]/step/route");
const submitRoute = await import("../../app/s/[sessionId]/submit/route");

interface OriginCase {
  readonly name: string;
  readonly headers: Record<string, string>;
  readonly allowed: boolean;
  /**
   * Required on every refused case and absent on every admitted one, which is checked
   * below: a refused case that forgot its expectation would otherwise assert only that
   * some line was written.
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
    name: "our own Origin and no Fetch Metadata (hydrated fetch, and the no-JS path on an old browser)",
    headers: { origin: PORTAL_BASE },
    allowed: true,
  },
  {
    name: "Origin: null and no Fetch Metadata (an attacker's page, or a sandboxed context)",
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
  /** Repo-relative, so a red names the file to open. */
  readonly path: string;
  readonly post: (headers: Record<string, string>) => Promise<Response>;
  /**
   * Whether the route acted. A predicate rather than "the API spy this route calls",
   * because one belted route changes state without calling the API at all: the no-JS
   * appearance form writes presentation cookies, and asserting only on the API client
   * would declare it guarded while never looking at what it does.
   */
  readonly acted: (response: Response) => boolean;
  readonly assertRefusal: (response: Response) => void | Promise<void>;
  /**
   * `beltOutcome` is asserted beside `assertRefusal` on purpose: the belt runs before
   * the handler builds its response, so the outcome is derived rather than observed, and
   * asserting both in one case makes a drift a red.
   */
  readonly logged: { readonly beltRoute: string; readonly beltOutcome: string };
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
    path: "app/appearance/route.ts",
    post: (headers) => {
      const form = new FormData();
      form.set("mode", "hc");
      form.set("returnTo", "/s/ses_1");
      return appearanceRoute.POST(formPost(`${PORTAL_BASE}/appearance`, headers, form));
    },
    // This route calls no internal API: what it changes is three presentation cookies,
    // so that is what acting means here.
    acted: (response) => response.headers.getSetCookie().length > 0,
    assertRefusal: (response) => {
      expect(response.status).toBe(303);
      // The site root, not the path the request asked for: a request that cannot prove
      // its origin does not choose where the browser goes next. Absolute, so no
      // `Location` this handler emits can read as protocol-relative.
      expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/`);
      expect(response.headers.getSetCookie()).toEqual([]);
    },
    logged: { beltRoute: "/appearance", beltOutcome: "redirect-to-root" },
  },
  {
    path: "app/f/[formSlug]/start/route.ts",
    post: (headers) => {
      const form = new FormData();
      form.set("challengeToken", "tok");
      return startRoute.POST(formPost(`${PORTAL_BASE}/f/survey/start`, headers, form), {
        params: Promise.resolve({ formSlug: "survey" }),
      });
    },
    acted: () => api.startAnonymousSession.mock.calls.length > 0,
    assertRefusal: (response) => {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/f/survey?state=error`);
    },
    logged: { beltRoute: "/f/{formSlug}/start", beltOutcome: "redirect-to-entry" },
  },
  {
    path: "app/s/[sessionId]/answers/route.ts",
    post: (headers) =>
      answersRoute.POST(
        jsonPost(`${PORTAL_BASE}/s/ses_1/answers`, headers, { questionId: "q_1", value: "x" }),
        { params: Promise.resolve({ sessionId: "ses_1" }) },
      ),
    acted: () => api.submitAnswer.mock.calls.length > 0,
    assertRefusal: async (response) => {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: { code: "forbidden" } });
    },
    logged: { beltRoute: "/s/{sessionId}/answers", beltOutcome: "forbidden" },
  },
  {
    path: "app/s/[sessionId]/step/route.ts",
    post: (headers) =>
      stepRoute.POST(formPost(`${PORTAL_BASE}/s/ses_1/step`, headers, new FormData()), {
        params: Promise.resolve({ sessionId: "ses_1" }),
      }),
    acted: () => api.getStep.mock.calls.length > 0,
    assertRefusal: (response) => {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/s/ses_1`);
    },
    logged: { beltRoute: "/s/{sessionId}/step", beltOutcome: "redirect-to-step" },
  },
  {
    path: "app/s/[sessionId]/submit/route.ts",
    post: (headers) =>
      submitRoute.POST(jsonPost(`${PORTAL_BASE}/s/ses_1/submit`, headers, {}), {
        params: Promise.resolve({ sessionId: "ses_1" }),
      }),
    acted: () => api.submitSession.mock.calls.length > 0,
    assertRefusal: async (response) => {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: { code: "forbidden" } });
    },
    logged: { beltRoute: "/s/{sessionId}/submit", beltOutcome: "forbidden" },
  },
];

describe("isSameOriginPost", () => {
  it.each(ORIGIN_CASES)("$name -> allowed: $allowed", ({ headers, allowed }) => {
    expect(
      isSameOriginPost(new Request(`${PORTAL_BASE}/s/ses_1/submit`, { method: "POST", headers })),
    ).toBe(allowed);
  });

  it.each(ORIGIN_CASES)("$name -> writes one line only when it refuses", ({ headers, allowed }) => {
    isSameOriginPost(new Request(`${PORTAL_BASE}/s/ses_1/submit`, { method: "POST", headers }));
    // At the belt itself rather than only through the routes, so a `return false` branch
    // added without a line, or with two, is caught before any route is involved.
    expect(refusalLines()).toHaveLength(allowed ? 0 : 1);
  });

  it("every refused case says what the line must classify it as", () => {
    // Guards the table rather than the code: a refused case with no `logged` expectation
    // would still pass the route assertions, having asserted only that some line exists.
    for (const probe of ORIGIN_CASES) {
      expect({ name: probe.name, hasExpectation: probe.logged !== undefined }).toEqual({
        name: probe.name,
        hasExpectation: !probe.allowed,
      });
    }
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

/**
 * The open-redirect class, closed at the handler rather than only at the pure function,
 * which `appearance-form.test.ts` covers. Two things have to hold for such a payload to
 * escape, so both are asserted: the path validator refuses it, and the header is
 * absolute on this deployment's own base.
 */
describe("app/appearance/route.ts does not emit a Location off this origin", () => {
  const ADMITTED = { "sec-fetch-site": "same-origin" };

  function apply(returnTo: string): Promise<Response> {
    const form = new FormData();
    form.set("mode", "dark");
    form.set("returnTo", returnTo);
    return appearanceRoute.POST(formPost(`${PORTAL_BASE}/appearance`, ADMITTED, form));
  }

  it.each([
    "/..//evil.example",
    "/x/..//evil.example",
    "/%2e%2e//evil.example",
    "/..\\evil.example",
    "/%2F%2Fevil.example",
    "//evil.example",
    "https://evil.example/x",
  ])("sends %s to the site root instead", async (payload) => {
    const response = await apply(payload);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/`);
  });

  it("still returns a legitimate page, absolutely, with the cookies written", async () => {
    // The negative cases above are only meaningful while the positive one still works:
    // a validator that refused everything would pass all of them.
    const response = await apply("/s/ses_1?step=2");
    expect(response.headers.get("location")).toBe(`${PORTAL_BASE}/s/ses_1?step=2`);
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it("names this origin on every answer it can give", async () => {
    for (const candidate of ["/s/ses_1", "/..//evil.example", "", "//evil.example@x"]) {
      const location = (await apply(candidate)).headers.get("location") ?? "";
      expect(new URL(location).origin, candidate).toBe(PORTAL_BASE);
    }
  });
});

describe.each(ROUTES)("$path", (route) => {
  beforeEach(() => {
    api.startAnonymousSession
      .mockReset()
      .mockResolvedValue({ sessionId: "ses_1", sessionToken: "bearer" });
    api.startLinkSession
      .mockReset()
      .mockResolvedValue({ sessionId: "ses_1", sessionToken: "bearer" });
    // The double carries the whole published `flowState` rather than the members this
    // file happens to look at.
    const flowState = { readyToSubmit: false, missingRequired: [], visibleQuestions: [] };
    api.submitAnswer.mockReset().mockResolvedValue({ flowState });
    api.getStep.mockReset().mockResolvedValue({ flowState });
    api.submitSession
      .mockReset()
      .mockResolvedValue({ submittedAt: new Date().toISOString(), contentHash: "hash" });
  });

  it.each(ORIGIN_CASES.filter((probe) => probe.allowed))(
    "acts on the request with $name",
    async ({ headers }) => {
      const response = await route.post(headers);
      expect(route.acted(response)).toBe(true);
      // Without this, a belt that logged unconditionally would pass every "exactly one"
      // assertion below while making the count useless.
      expect(refusalLines()).toEqual([]);
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "changes nothing and refuses with $name",
    async ({ headers }) => {
      const response = await route.post(headers);
      expect(route.acted(response)).toBe(false);
      // A route that refused one call but made another has still let a cross-site
      // caller act.
      for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
      await route.assertRefusal(response);
    },
  );

  it.each(ORIGIN_CASES.filter((probe) => !probe.allowed))(
    "writes exactly one refusal line, carrying route, signals and outcome, with $name",
    async ({ headers, logged }) => {
      await route.post(headers);
      // `toEqual` on the whole array rather than a length check plus a member check, so
      // it fails readably on a duplicate and pins the fields at once.
      expect(refusalLines()).toEqual([
        expect.objectContaining({
          level: "warn",
          msg: "origin.belt.refused",
          service: "qcms-portal",
          beltRoute: route.logged.beltRoute,
          beltOutcome: route.logged.beltOutcome,
          ...logged,
        }),
      ]);
    },
  );

  it("names the outcome the respondent actually gets", async () => {
    // The cross-check that keeps the derivation honest: the response asserted here is
    // the real one this route returns.
    const refused = ORIGIN_CASES.find((probe) => !probe.allowed);
    const response = await route.post(refused?.headers ?? {});
    await route.assertRefusal(response);
    expect(route.logged.beltOutcome).toBe(outcomeOnTheWire(response));
  });
});

/**
 * The belted caller that is a Server Action rather than a route handler (R-B2).
 *
 * Driven here rather than left to the static gate because the two prove different
 * things: with the belt call deleted from the action, the gate goes red while the whole
 * browser suite stays green, every spec in it posting from a real same-origin page. A
 * scan that reads the call is not a test that the call does anything.
 */
describe("task 073: the Server Action's belt refuses and applies nothing (R-B2)", () => {
  const SESSION = "ses_c0ffee";

  function pressAdd(): FormData {
    const form = new FormData();
    form.set("__qsid", SESSION);
    form.set("__qop", "add:grp_vehicles:op_7f3");
    form.set("__qk__q_rf_fleet_ref", "string");
    form.set("q_rf_fleet_ref", "NORTH-1");
    return form;
  }

  beforeEach(() => {
    api.rosterOp.mockReset();
    api.getStep.mockReset();
    // The action reads `view` to learn whether the group paginates the step; null here,
    // because this is a stacked group.
    api.getStep.mockResolvedValue({
      rosters: [{ groupId: "grp_vehicles", instances: [] }],
      view: { groupId: null, instanceId: null },
    });
    api.rosterOp.mockResolvedValue({ rosters: [], minted: [], replayed: false });
  });

  it("applies nothing when the request proves no origin, and says so", async () => {
    // Neither header: the shape Next's own action check admits after a warning.
    actionHeaders.current = new Headers();
    const { rosterOperation } = await import("../../app/s/[sessionId]/roster-action");

    const state = await rosterOperation({ values: {} }, pressAdd());

    expect(api.rosterOp, "a refused action must not write").not.toHaveBeenCalled();
    expect(api.getStep, "a refused action must not even read the roster").not.toHaveBeenCalled();
    // The respondent gets their own step back with their typed value and a message:
    // there is no 403 to show on a page that is the response to its own POST.
    expect(state.values).toEqual({ q_rf_fleet_ref: "NORTH-1" });
    expect(state.message).toBeDefined();
    expect(state.autofocusId).toBeUndefined();
    const line = emitted.map((raw) => JSON.parse(raw) as Record<string, unknown>).at(-1);
    expect(line?.msg).toBe("origin.belt.refused");
    expect(line?.beltRoute).toBe("/s/{sessionId}");
    expect(line?.beltOutcome).toBe("rendered-unchanged");
  });

  it("applies the operation when the request proves same origin", async () => {
    // The control, without which the assertion above passes for any reason.
    actionHeaders.current = new Headers({ "sec-fetch-site": "same-origin" });
    const { rosterOperation } = await import("../../app/s/[sessionId]/roster-action");

    const state = await rosterOperation({ values: {} }, pressAdd());

    expect(api.rosterOp).toHaveBeenCalledTimes(1);
    expect(state.message).toBeUndefined();
    expect(state.values).toEqual({ q_rf_fleet_ref: "NORTH-1" });
    expect(emitted.filter((raw) => raw.includes("origin.belt.refused"))).toEqual([]);
  });

  it("refuses a cross-site post, the shape the belt exists for", async () => {
    actionHeaders.current = new Headers({
      "sec-fetch-site": "cross-site",
      origin: "https://evil.test",
    });
    const { rosterOperation } = await import("../../app/s/[sessionId]/roster-action");

    const state = await rosterOperation({ values: {} }, pressAdd());

    expect(api.rosterOp).not.toHaveBeenCalled();
    expect(state.message).toBeDefined();
  });
});
