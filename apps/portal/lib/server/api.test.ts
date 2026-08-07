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

/**
 * The browser request as this app received it. Mutable so a case can vary the
 * inbound `x-forwarded-for` the ingress wrote (issue #341); reset per test.
 */
let inbound = new Headers({ "x-request-id": REQUEST_ID });

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(inbound),
}));

/** Captured requests, so each case can read the headers the BFF actually sent. */
let sent: { url: string; headers: Headers }[] = [];

beforeEach(() => {
  sent = [];
  inbound = new Headers({ "x-request-id": REQUEST_ID });
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

/**
 * The client address the API's rate limiters key on (issue #341).
 *
 * Before this, `baseHeaders()` carried no address at all, so the API bucketed
 * every respondent in a deployment together. The first two cases are the fix; the
 * third is the half that stops the fix from being worse than the bug, since the
 * naive version of it lets a caller pick its own bucket.
 */
describe("vouched client address", () => {
  const startFrom = async (forwardedFor?: string): Promise<Headers | undefined> => {
    if (forwardedFor !== undefined) inbound.set("x-forwarded-for", forwardedFor);
    const { startSession } = await import("./api");
    await startSession({ formSlug: "demo" });
    return sent.at(-1)?.headers;
  };

  it("vouches for the address the ingress wrote, and never forwards the raw chain", async () => {
    const headers = await startFrom("203.0.113.7");
    expect(headers?.get("x-qcms-client-address")).toBe("203.0.113.7");
    // The API must not be able to re-derive an address from a client-written list.
    expect(headers?.get("x-forwarded-for")).toBeNull();
    expect(headers?.get("x-real-ip")).toBeNull();
  });

  it("puts two respondents in two buckets", async () => {
    const first = await startFrom("203.0.113.7");
    inbound = new Headers({ "x-request-id": REQUEST_ID });
    const second = await startFrom("198.51.100.22");
    expect(first?.get("x-qcms-client-address")).toBe("203.0.113.7");
    expect(second?.get("x-qcms-client-address")).toBe("198.51.100.22");
  });

  it("does NOT let a forged inbound header move the bucket", async () => {
    // The attacker sends its own X-Forwarded-For; an appending proxy adds its peer.
    const forged = await startFrom("10.0.0.1, 203.0.113.7");
    expect(forged?.get("x-qcms-client-address")).toBe("203.0.113.7");
    expect(forged?.get("x-qcms-client-address")).not.toBe("10.0.0.1");
  });

  it("omits the header when nothing trustworthy arrived (shared bucket, not a free one)", async () => {
    const headers = await startFrom();
    expect(headers?.has("x-qcms-client-address")).toBe(false);
  });

  it("omits the header when the operator trusts no proxy", async () => {
    vi.stubEnv("QCMS_PORTAL_TRUSTED_PROXY_HOPS", "0");
    const headers = await startFrom("203.0.113.7");
    expect(headers?.has("x-qcms-client-address")).toBe(false);
  });
});
