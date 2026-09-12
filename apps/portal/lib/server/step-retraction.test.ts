import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Clearing an answer on the no-JS whole-step route (issue #127), at the route.
 *
 * `step-form.test.ts` pins the decoding rule over hand-built form entries. This file
 * pins what the ROUTE does with it, which is the part the respondent feels: the same
 * empty submission either reaches the internal API as an ADR-33 retraction or reaches
 * it not at all, and which of the two it is turns on the renderer's `__qa__` marker
 * and on nothing else.
 *
 * Every case therefore asserts on the **API client**, not on the response status. A
 * 303 back to the step is what the buggy behaviour already returned - it is what the
 * success path returns too - so a status assertion cannot tell "cleared" from
 * "silently ignored", which is the entire subject of the issue. What state changed is
 * decided by whether `submitAnswer` was called and with what body.
 *
 * The API itself is a double here on purpose: this is the BFF's own decision, and the
 * real ledger consequence of the `null` body is pinned where a real Postgres is in
 * play (`packages/db` for the tombstone row, `apps/api` for the endpoint semantics,
 * and `apps/portal/e2e/no-js-retraction.pw.ts` for the whole chain in a browser with
 * scripting off).
 */

const PORTAL_BASE = "https://forms.qcms.test";

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

/** The internal API client: the seam every "what did the server hear?" assertion reads. */
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

/** The cookies the route sets, captured so the re-render context can be read back. */
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => cookieJar.set(name, value),
    }),
}));

/**
 * The logger's SINK, silenced. The origin belt writes one structured line per refusal
 * and `origin-guard.test.ts` is where that line is asserted; here it would only be
 * noise on the suite's stdout.
 */
vi.mock("./logger", async () => {
  const { createJsonLogger } = await import("@roonga/qcms-observability/logger");
  return {
    serverLogger: createJsonLogger({ base: { service: "qcms-portal" }, write: () => {} }),
  };
});

// Alias plumbing, not doubles: `@/` is a tsconfig path Next resolves and Vitest does
// not, so each of these hands back the real module by a relative path. The decoder and
// the route helpers in particular must be real - they are what is under test.
vi.mock("@/lib/server/config", async () => await import("./config"));
vi.mock("@/lib/server/route-helpers", async () => await import("./route-helpers"));
vi.mock("@/lib/server/step-form", async () => await import("./step-form"));
vi.mock("@/lib/i18n/en", async () => await import("../i18n/en"));
vi.mock("@/lib/validation-message", async () => await import("../validation-message"));

const stepRoute = await import("../../app/s/[sessionId]/step/route");
const { STEP_CTX_COOKIE } = await import("./route-helpers");

const SESSION_ID = "ses_127";

/** A projection the route can read `readyToSubmit` off. */
function projection(readyToSubmit: boolean) {
  return {
    step: null,
    values: {},
    progress: { stepIndex: 0, totalVisibleSteps: 1 },
    a2uiSpecVersion: "1.0",
    flowState: { readyToSubmit, visibleQuestions: [], missingRequired: [] },
  };
}

/** POST the given form fields to the whole-step route as a same-origin navigation. */
async function postStep(
  fields: readonly (readonly [string, string])[],
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
): Promise<Response> {
  const body = new FormData();
  for (const [name, value] of fields) body.append(name, value);
  const request = new Request(`${PORTAL_BASE}/s/${SESSION_ID}/step`, {
    method: "POST",
    headers,
    body,
  });
  return await stepRoute.POST(request, { params: Promise.resolve({ sessionId: SESSION_ID }) });
}

/** Every `submitAnswer` call as `[questionId, value]`, in the order they were made. */
function posted(): [string, unknown][] {
  return api.submitAnswer.mock.calls.map((call) => [call[2] as string, call[3]]);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  api.submitAnswer.mockResolvedValue(projection(false));
  api.getStep.mockResolvedValue(projection(false));
});

describe("the no-JS route retracts a marked field submitted empty (issue #127)", () => {
  it("posts a null retraction for an emptied text field that the form marked as answered", async () => {
    await postStep([
      ["__qk__q_full_name", "string"],
      ["__qa__q_full_name", "1"],
      ["q_full_name", ""],
    ]);

    // The same body, on the same endpoint, that the scripted path posts when the
    // respondent empties this control and blurs it (issue #98). One gesture, one
    // ledger call, whichever transport carried it.
    expect(posted()).toEqual([["q_full_name", null]]);
    expect(api.submitAnswer).toHaveBeenCalledWith(
      SESSION_ID,
      "respondent-bearer",
      "q_full_name",
      null,
    );
  });

  it("posts NOTHING for the same empty field when the form did not mark it", async () => {
    // The control half of the pair above, and the behaviour that must not change: an
    // empty box on a question nobody has answered is silence, not a tombstone. Without
    // this the marker would have bought a ledger row on every unanswered field of
    // every no-JS submit.
    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", ""],
    ]);

    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it("retracts an emptied multiChoice, which posts no field of its own at all", async () => {
    // An all-unchecked checkbox group serializes nothing: the question's only trace in
    // the whole post is its kind tag and its marker. This is the case the old decoder
    // could not see even in principle, because it walked the posted values.
    await postStep([
      ["__qk__q_optional_cover", "multi"],
      ["__qa__q_optional_cover", "1"],
    ]);

    expect(posted()).toEqual([["q_optional_cover", null]]);
  });

  it("leaves a marked field that still carries a value as an ordinary answer", async () => {
    await postStep([
      ["__qk__q_full_name", "string"],
      ["__qa__q_full_name", "1"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    expect(posted()).toEqual([["q_full_name", "Ada Lovelace"]]);
  });

  it("clears and answers in one whole-step post, in the form's own field order", async () => {
    await postStep([
      ["__qk__q_full_name", "string"],
      ["__qa__q_full_name", "1"],
      ["q_full_name", ""],
      ["__qk__q_at_fault_accident", "radio"],
      ["q_at_fault_accident", "true"],
    ]);

    expect(posted()).toEqual([
      ["q_full_name", null],
      ["q_at_fault_accident", true],
    ]);
  });

  it("does not re-seed the cleared field from the re-render cookie", async () => {
    // The cookie exists to re-show what the API does not hold. After a retraction the
    // API holds nothing for the question precisely because the call succeeded, so the
    // key must be ABSENT and the stored (now empty) answer must show through. A key
    // recorded here would blank or re-fill the field on the reload by accident rather
    // than by the API's account of it - see `mergeStepValues`.
    await postStep([
      ["__qk__q_full_name", "string"],
      ["__qa__q_full_name", "1"],
      ["q_full_name", ""],
      ["__qk__q_at_fault_accident", "radio"],
      ["q_at_fault_accident", "true"],
    ]);

    const context = JSON.parse(cookieJar.get(STEP_CTX_COOKIE) ?? "{}") as {
      values?: Record<string, unknown>;
    };
    expect(context.values).toEqual({ q_at_fault_accident: true });
    expect("q_full_name" in (context.values ?? {})).toBe(false);
  });

  it("still refuses a cross-origin post carrying a marker (the origin belt, SEC-9)", async () => {
    // The marker is respondent-editable, so the belt is what keeps a forged
    // cross-origin form from clearing a victim's in-progress answers. It is asserted
    // on the API client rather than on the status, because the refusal and the success
    // are the same 303 back to the step.
    const response = await postStep(
      [
        ["__qk__q_full_name", "string"],
        ["__qa__q_full_name", "1"],
        ["q_full_name", ""],
      ],
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    );

    expect(api.submitAnswer).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });
});
