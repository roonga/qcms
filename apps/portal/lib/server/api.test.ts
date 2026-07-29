import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The BFF forwards `x-request-id` on its API calls (task 054, exit criterion 3).
 *
 * Before this, the browser -> portal -> API hop shared no id at all: the API
 * generated its own per request, so a respondent quoting the id from an error
 * envelope pointed at one log line in one service and nothing in the other.
 *
 * `next/headers` is mocked because the request store only exists inside a Next
 * request; the id itself is minted in `proxy.ts` (see `proxy.test.ts`).
 */

const REQUEST_ID = "req-from-the-proxy";

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-request-id": REQUEST_ID })),
}));

/** Captured requests, so each case can read the headers the BFF actually sent. */
let sent: { url: string; headers: Headers }[] = [];

beforeEach(() => {
  sent = [];
  vi.stubEnv("QCMS_API_BASE_URL", "http://api.internal:4000");
  vi.stubEnv("QCMS_INTERNAL_TOKEN", "internal-token-value-for-this-test-only");
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    sent.push({ url: input, headers: new Headers(init?.headers) });
    return Promise.resolve(
      new Response(JSON.stringify({ sessionId: "ses_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("internal API client headers", () => {
  it("forwards this request's x-request-id beside the SEC-4 internal token", async () => {
    const { startSession } = await import("./api");
    await startSession({ formSlug: "demo" });

    const call = sent[0];
    expect(call?.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(call?.headers.get("x-qcms-internal-token")).toBe(
      "internal-token-value-for-this-test-only",
    );
  });

  it("forwards it on every call shape (step, answers, submit), with the bearer", async () => {
    const { getStep, submitAnswer, submitSession } = await import("./api");
    await getStep("ses_1", "session-bearer", 0);
    await submitAnswer("ses_1", "session-bearer", "q_a", "value", 0);
    await submitSession("ses_1", "session-bearer");

    expect(sent).toHaveLength(3);
    for (const call of sent) {
      expect(call.headers.get("x-request-id")).toBe(REQUEST_ID);
      expect(call.headers.get("authorization")).toBe("Bearer session-bearer");
    }
  });
});
