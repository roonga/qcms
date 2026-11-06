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
const { STEP_CTX_COOKIE } = await import("./route-helpers");

const SESSION_ID = "ses_921";

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
      readyToSubmit: options.readyToSubmit ?? true,
      visibleQuestions: options.visibleQuestions ?? [],
      missingRequired: options.missingRequired ?? [],
    },
    rosters: [],
    rejected: [],
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

function writtenContext(): {
  missingRequired?: unknown;
  errors?: unknown;
  constraints?: unknown;
  notice?: unknown;
} {
  return JSON.parse(cookieJar.get(STEP_CTX_COOKIE) ?? "{}") as Record<string, unknown>;
}

function refusal(errors: readonly unknown[]): FakeApiError {
  return new FakeApiError(422, "SUBMISSION_INVALID", { missingRequired: [], errors });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  api.batchAnswers.mockResolvedValue(
    projection({ readyToSubmit: true, visibleQuestions: ["q_full_name"] }),
  );
});

describe("a refused submit is reported question by question, not silently", () => {
  it("carries the refused value's message and constraint for the landing step", async () => {
    api.submitSession.mockRejectedValue(
      refusal([
        {
          code: "INVALID_ANSWER",
          message: "x",
          questionId: "q_full_name",
          errors: [{ code: "PATTERN_MISMATCH", constraint: "pattern", message: "Letters only" }],
        },
      ]),
    );
    api.getStep.mockResolvedValue(projection({ visibleQuestions: ["q_full_name"] }));

    const response = await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada1"],
    ]);

    expect(response.status).toBe(303);
    const context = writtenContext();
    expect(context.errors).toEqual({ q_full_name: "Letters only" });
    expect(context.constraints).toEqual({ q_full_name: "pattern" });
    expect(context.notice).toBeUndefined();
  });

  it("carries an unanswered required question as the missing-required set", async () => {
    api.submitSession.mockRejectedValue(
      refusal([{ code: "MISSING_REQUIRED", message: "x", questionId: "q_dob" }]),
    );
    api.getStep.mockResolvedValue(projection({ visibleQuestions: ["q_full_name", "q_dob"] }));

    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    const context = writtenContext();
    expect(context.missingRequired).toEqual(["q_dob"]);
    expect(context.errors).toEqual({});
  });

  it("drops a refusal the landing step does not render and says so once", async () => {
    api.submitSession.mockRejectedValue(
      refusal([
        {
          code: "INVALID_ANSWER",
          message: "x",
          questionId: "q_elsewhere",
          errors: [{ code: "PATTERN_MISMATCH", constraint: "pattern", message: "Letters only" }],
        },
      ]),
    );
    api.getStep.mockResolvedValue(projection({ visibleQuestions: ["q_full_name"] }));

    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    const context = writtenContext();
    expect(context.errors).toEqual({});
    expect(context.missingRequired).toEqual([]);
    expect(context.notice).toBe("step.submitRefused");
  });

  it("keeps the count refusal on its own page-level notice", async () => {
    api.submitSession.mockRejectedValue(
      refusal([{ code: "REPEAT_COUNT_OUT_OF_RANGE", message: "x", groupId: "grp_cars", count: 0 }]),
    );

    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", "Ada Lovelace"],
    ]);

    expect(writtenContext().notice).toBe("step.countOutOfRange");
    // The landing step is never read for a refusal with no field to report against.
    expect(api.getStep).not.toHaveBeenCalled();
  });
});
