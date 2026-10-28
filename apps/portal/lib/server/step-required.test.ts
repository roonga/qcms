import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  batchAnswers: vi.fn(),
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
  batchAnswers: api.batchAnswers,
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

vi.mock("@/lib/server/config", async () => await import("./config"));
vi.mock("@/lib/server/environment", async () => await import("./environment"));
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
  readonly rejected?: readonly {
    readonly questionId: string;
    readonly instanceId?: string;
    readonly code: string;
    readonly details?: unknown;
  }[];
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
    rosters: [],
    rejected: options.rejected ?? [],
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
function writtenContext(): {
  missingRequired?: unknown;
  errors?: unknown;
  values?: unknown;
  notice?: unknown;
} {
  return JSON.parse(cookieJar.get(STEP_CTX_COOKIE) ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
});

describe("a required question left blank is reported, not silently reloaded (issue #920)", () => {
  it("carries the API's missing-required set for the fields the posted form asked", async () => {
    api.batchAnswers.mockResolvedValue(
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
    expect(writtenContext().values).toEqual({ q_full_name: "Ada Lovelace" });
  });

  it("reads the projection from a fresh step read when the whole form arrived empty", async () => {
    api.getStep.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_dob"] }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["q_dob", ""],
    ]);

    expect(api.batchAnswers).not.toHaveBeenCalled();
    expect(api.getStep).toHaveBeenCalledTimes(1);
    expect(writtenContext().missingRequired).toEqual(["q_dob"]);
  });

  it("reports a required question the respondent RETRACTED past the browser (issue #127)", async () => {
    api.batchAnswers.mockResolvedValue(
      projection({ missingRequired: ["q_dob"], visibleQuestions: ["q_dob"] }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["__qa__q_dob", "1"],
      ["q_dob", ""],
    ]);

    expect(api.batchAnswers).toHaveBeenCalledWith(SESSION_ID, "respondent-bearer", [
      { questionId: "q_dob", value: null },
    ]);
    expect(writtenContext().missingRequired).toEqual(["q_dob"]);
  });

  it("does not report a required question that was not on the posted form", async () => {
    api.batchAnswers.mockResolvedValue(
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
    api.batchAnswers.mockResolvedValue(
      projection({
        missingRequired: ["q_dob"],
        visibleQuestions: ["q_dob"],
        rejected: [
          {
            questionId: "q_dob",
            code: "INVALID_ANSWER",
            details: {
              questionId: "q_dob",
              errors: [{ code: "VALUE_ABOVE_MAX", constraint: "max", message: "Too late" }],
            },
          },
        ],
      }),
    );

    await postStep([
      ["__qk__q_dob", "string"],
      ["q_dob", "2999-01-01"],
    ]);

    const context = writtenContext();
    expect(context.missingRequired).toEqual([]);
    expect(context.errors).toEqual({ q_dob: "Too late" });
  });

  it("keeps a refusal and the typed value in the same round (reviewer finding)", async () => {
    api.batchAnswers.mockResolvedValue(
      projection({
        visibleQuestions: ["q_full_name"],
        rejected: [
          {
            questionId: "q_full_name",
            code: "INVALID_ANSWER",
            details: {
              questionId: "q_full_name",
              errors: [
                { code: "PATTERN_MISMATCH", constraint: "pattern", message: "Letters only" },
              ],
            },
          },
        ],
      }),
    );

    const response = await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada1"],
    ]);

    expect(response.status).toBe(303);
    const context = writtenContext();
    expect(context.errors).toEqual({ q_full_name: "Letters only" });
    expect(context.values).toEqual({ q_full_name: "Ada1" });
    expect(api.submitSession).not.toHaveBeenCalled();
  });

  it("keeps the typed values when the whole BATCH is refused", async () => {
    api.batchAnswers.mockRejectedValue(new FakeApiError(429, "rate_limited"));

    const response = await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    expect(response.status).toBe(303);
    expect(writtenContext().values).toEqual({ q_full_name: "Ada Lovelace" });
    expect(api.submitSession).not.toHaveBeenCalled();
    expect(writtenContext().notice).toBe("step.notSaved");
    expect(writtenContext().errors).toEqual({});
  });

  it("writes NO notice when the round trip succeeded", async () => {
    api.batchAnswers.mockResolvedValue(
      projection({ visibleQuestions: ["q_full_name"], readyToSubmit: false }),
    );

    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    expect(writtenContext().notice).toBeUndefined();
  });

  it("carries the typed values on the ordinary not-ready path", async () => {
    api.batchAnswers.mockResolvedValue(
      projection({ visibleQuestions: ["q_full_name"], readyToSubmit: false }),
    );
    api.getStep.mockRejectedValue(new FakeApiError(503, "UPSTREAM"));

    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    expect(writtenContext().values).toEqual({ q_full_name: "Ada Lovelace" });
    expect(api.getStep).not.toHaveBeenCalled();
    expect(api.submitSession).not.toHaveBeenCalled();
  });

  it("submits the session untouched when the API reports no gap", async () => {
    api.batchAnswers.mockResolvedValue(
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
    cookieJar.set(
      STEP_CTX_COOKIE,
      JSON.stringify({ missingRequired: ["q_dob", 7, { q: 1 }], errors: {}, values: {} }),
    );

    expect((await readStepContext())?.missingRequired).toEqual(["q_dob"]);
  });
});
