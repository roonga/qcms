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

/** The internal API client: the seam every "what did the server hear?" assertion reads. */
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

vi.mock("@/lib/server/config", async () => await import("./config"));
vi.mock("@/lib/server/environment", async () => await import("./environment"));
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
    rosters: [],
    rejected: [],
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

function posted(): [string, unknown][] {
  const calls = api.batchAnswers.mock.calls;
  if (calls.length === 0) return [];
  expect(calls).toHaveLength(1);
  const entries = calls[0]![2] as readonly {
    questionId: string;
    instanceId?: string;
    value: unknown;
  }[];
  return entries.map((entry) => [
    entry.instanceId === undefined ? entry.questionId : `${entry.instanceId}/${entry.questionId}`,
    entry.value,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  api.batchAnswers.mockResolvedValue(projection(false));
  api.getStep.mockResolvedValue(projection(false));
});

describe("the no-JS route retracts a marked field submitted empty (issue #127)", () => {
  it("posts a null retraction for an emptied text field that the form marked as answered", async () => {
    await postStep([
      ["__qk__q_full_name", "string"],
      ["__qa__q_full_name", "1"],
      ["q_full_name", ""],
    ]);

    expect(posted()).toEqual([["q_full_name", null]]);
    expect(api.batchAnswers).toHaveBeenCalledWith(SESSION_ID, "respondent-bearer", [
      { questionId: "q_full_name", value: null },
    ]);
  });

  it("posts NOTHING for the same empty field when the form did not mark it", async () => {
    await postStep([
      ["__qk__q_full_name", "string"],
      ["q_full_name", ""],
    ]);

    expect(api.batchAnswers).not.toHaveBeenCalled();
  });

  it("retracts an emptied multiChoice, which posts no field of its own at all", async () => {
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
    const response = await postStep(
      [
        ["__qk__q_full_name", "string"],
        ["__qa__q_full_name", "1"],
        ["q_full_name", ""],
      ],
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    );

    expect(api.batchAnswers).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });
});
