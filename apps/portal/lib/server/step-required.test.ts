import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A required question left blank on the no-JS whole-step route (issue #920).
 *
 * ## What this is pinning, and what it deliberately is not
 *
 * Not the rule. `required` is the kernel's (`evaluateRules`, invariant I9) and the
 * API serves the result on every projection as `flowState.missingRequired`; that
 * the API refuses to store an empty answer and refuses to submit a session with a
 * required gap is pinned where a real Postgres is in play
 * (`apps/api/src/features/responses/**`). Nothing in this file decides whether a
 * question is required or whether it holds an answer, and nothing in the route it
 * exercises does either.
 *
 * What is pinned here is the round trip the respondent feels, and it is asserted on
 * the RE-RENDER CONTEXT rather than on the response status for the same reason
 * `step-retraction.test.ts` gives: the 303 back to the step is what the silent
 * behaviour already returned. Before this change a no-JS respondent who left a
 * required question blank - or who defeated the browser's own `required` with a
 * crafted post - got that identical 303 and a reload of the same step with no
 * message anywhere on it. What changed is the context the reload reads.
 *
 * The browser gate (`apps/portal/e2e/no-js-required.pw.ts`) carries the same three
 * cases end to end with scripting off, including the crafted post, which is the one
 * that proves the API is authoritative whichever path a submission takes.
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

vi.mock("./logger", async () => {
  const { createJsonLogger } = await import("@roonga/qcms-observability/logger");
  return {
    serverLogger: createJsonLogger({ base: { service: "qcms-portal" }, write: () => {} }),
  };
});

// Alias plumbing, not doubles: `@/` is a tsconfig path Next resolves and Vitest does
// not. The decoder and the route helpers must be real - they are what is under test.
vi.mock("@/lib/server/config", async () => await import("./config"));
vi.mock("@/lib/server/route-helpers", async () => await import("./route-helpers"));
vi.mock("@/lib/server/step-form", async () => await import("./step-form"));
vi.mock("@/lib/i18n/en", async () => await import("../i18n/en"));
vi.mock("@/lib/validation-message", async () => await import("../validation-message"));

const stepRoute = await import("../../app/s/[sessionId]/step/route");
const { STEP_CTX_COOKIE, readStepContext } = await import("./route-helpers");

const SESSION_ID = "ses_920";

/** A projection carrying the API's authoritative missing-required set. */
function projection(options: {
  readonly readyToSubmit?: boolean;
  readonly missingRequired?: readonly string[];
  readonly visibleQuestions?: readonly string[];
}) {
  return {
    step: null,
    values: {},
    progress: { stepIndex: 0, totalVisibleSteps: 1 },
    a2uiSpecVersion: "1.0",
    flowState: {
      readyToSubmit: options.readyToSubmit ?? false,
      visibleQuestions: options.visibleQuestions ?? [],
      missingRequired: options.missingRequired ?? [],
    },
  };
}

async function postStep(fields: readonly (readonly [string, string])[]): Promise<Response> {
  const body = new FormData();
  for (const [name, value] of fields) body.append(name, value);
  const request = new Request(`${PORTAL_BASE}/s/${SESSION_ID}/step`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body,
  });
  return await stepRoute.POST(request, { params: Promise.resolve({ sessionId: SESSION_ID }) });
}

/** The re-render context the route left for the next page render. */
function writtenContext(): { missingRequired?: unknown; errors?: unknown; values?: unknown } {
  return JSON.parse(cookieJar.get(STEP_CTX_COOKIE) ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
});

describe("a required question left blank is reported, not silently reloaded (issue #920)", () => {
  it("carries the API's missing-required set for the fields the posted form asked", async () => {
    // Nothing is posted for the date, so no answer call is made at all: the gap is
    // only visible in the projection the API returns for the answer that WAS posted.
    api.submitAnswer.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_full_name", "q_dob"] }),
    );

    const response = await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
      ["__qk__q_dob", "string"],
      ["q_dob", ""],
    ]);

    expect(response.status).toBe(303);
    expect(writtenContext().missingRequired).toEqual(["q_dob"]);
    // The other answer survives the round trip, so the reload does not make the
    // respondent retype what they got right.
    expect(writtenContext().values).toEqual({ q_full_name: "Ada Lovelace" });
  });

  it("reads the projection from a fresh step read when the whole form arrived empty", async () => {
    // The crafted-post shape at its most extreme: every field blank, so `forwardAnswers`
    // posts nothing and there is no projection to read the gap off. The route reads one.
    api.getStep.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_dob"] }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["q_dob", ""],
    ]);

    expect(api.submitAnswer).not.toHaveBeenCalled();
    expect(api.getStep).toHaveBeenCalledTimes(1);
    expect(writtenContext().missingRequired).toEqual(["q_dob"]);
  });

  it("reports a required question the respondent RETRACTED past the browser (issue #127)", async () => {
    // The #919 marker aimed at a required question: the field is marked as answered
    // and arrives empty, so the route posts the ADR-33 retraction, the API accepts it
    // (a retraction is not a validation outcome) and immediately reports the gap.
    api.submitAnswer.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_dob"] }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["__qa__q_dob", "1"],
      ["q_dob", ""],
    ]);

    expect(api.submitAnswer).toHaveBeenCalledWith(SESSION_ID, "respondent-bearer", "q_dob", null);
    expect(writtenContext().missingRequired).toEqual(["q_dob"]);
  });

  it("does not report a required question that was not on the posted form", async () => {
    // `missingRequired` is flow-wide and cursor-independent. A required question on a
    // step ahead, or one a just-changed branch has only now revealed, must not be
    // accused before the respondent has been shown it.
    api.submitAnswer.mockResolvedValue(
      projection({
        missingRequired: ["q_accident_count"],
        visibleQuestions: ["q_at_fault_accident", "q_accident_count"],
      }),
    );

    await postStep([
      ["__qk__q_at_fault_accident", "radio"],
      ["q_at_fault_accident", "true"],
    ]);

    expect(writtenContext().missingRequired).toEqual([]);
  });

  it("leaves a question the API refused with its own 422 message instead", async () => {
    // A refused answer is missing an answer too, by construction. The kernel's message
    // about the value it refused says more than "this needs an answer", so it wins.
    api.submitAnswer.mockRejectedValue(
      new FakeApiError(422, "INVALID_ANSWER", {
        questionId: "q_dob",
        errors: [{ code: "VALUE_ABOVE_MAX", constraint: "max", message: "Too late" }],
      }),
    );
    api.getStep.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_dob"] }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["q_dob", "2999-01-01"],
    ]);

    const context = writtenContext();
    expect(context.missingRequired).toEqual([]);
    expect(context.errors).toEqual({ q_dob: "Too late" });
  });

  it("keeps the refusals and the typed values when the projection read FAILS", async () => {
    // The narrow regression this change introduced and then closed (reviewer finding).
    // When every posted answer is refused there is no projection in hand, so the route
    // reads one; if that read throws, the round must still re-render with the 422 and
    // the value the respondent typed. Returning before the write would hand them the
    // silent reload this whole change exists to remove.
    api.submitAnswer.mockRejectedValue(
      new FakeApiError(422, "INVALID_ANSWER", {
        questionId: "q_full_name",
        errors: [{ code: "PATTERN_MISMATCH", constraint: "pattern", message: "Letters only" }],
      }),
    );
    api.getStep.mockRejectedValue(new FakeApiError(503, "UPSTREAM"));

    const response = await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada1"],
    ]);

    expect(response.status).toBe(303);
    const context = writtenContext();
    expect(context.errors).toEqual({ q_full_name: "Letters only" });
    expect(context.values).toEqual({ q_full_name: "Ada1" });
    // The missing-required half is the only casualty of the failed read: it is the
    // API's to give, so with no projection the route reports none rather than guessing.
    expect(context.missingRequired).toEqual([]);
    // And nothing was submitted on a guess about readiness.
    expect(api.submitSession).not.toHaveBeenCalled();
  });

  it("keeps the typed values when the read fails and nothing was refused", async () => {
    // The same protection one step further out: no refusals either, so the only thing
    // worth carrying is what the respondent typed, and it is carried.
    api.submitAnswer.mockResolvedValue(
      projection({ visibleQuestions: ["q_full_name"], readyToSubmit: false }),
    );
    api.getStep.mockRejectedValue(new FakeApiError(503, "UPSTREAM"));

    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    // `submitAnswer` returned a projection here, so this asserts the ordinary
    // not-ready path still carries values; the read is never even reached.
    expect(writtenContext().values).toEqual({ q_full_name: "Ada Lovelace" });
    expect(api.submitSession).not.toHaveBeenCalled();
  });

  it("submits the session untouched when the API reports no gap", async () => {
    // The behaviour that must not regress: a complete step still submits on the same
    // POST, with no extra round trip introduced by the gap read.
    api.submitAnswer.mockResolvedValue(
      projection({ readyToSubmit: true, visibleQuestions: ["q_dob"] }),
    );
    api.submitSession.mockResolvedValue({
      submittedAt: "2026-09-18T00:00:00.000Z",
      contentHash: "a",
    });

    const response = await postStep([
      ["__qk__q_dob", "string"],
      ["q_dob", "1990-05-17"],
    ]);

    expect(api.getStep).not.toHaveBeenCalled();
    expect(api.submitSession).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toContain("/done");
  });

  it("round-trips the set through the cookie the flow page reads", async () => {
    // The context is JSON in an unsigned httpOnly cookie, so the member has to survive
    // `readStepContext`'s own schema rather than only `JSON.stringify`.
    api.getStep.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_dob"] }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["q_dob", ""],
    ]);

    expect((await readStepContext())?.missingRequired).toEqual(["q_dob"]);
  });

  it("drops a forged non-string entry rather than failing the whole re-render", async () => {
    // The cookie is respondent-settable. A member that is the right kind of container
    // keeps the entries that read, exactly as `errors` and `constraints` do.
    cookieJar.set(
      STEP_CTX_COOKIE,
      JSON.stringify({ missingRequired: ["q_dob", 7, { q: 1 }], errors: {}, values: {} }),
    );

    expect((await readStepContext())?.missingRequired).toEqual(["q_dob"]);
  });
});
