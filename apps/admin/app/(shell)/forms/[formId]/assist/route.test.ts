import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The assist proxy's response headers.
 *
 * A turn is only visibly streamed if every hop passes its frames on as they arrive. The
 * API sets `x-accel-buffering: no` on its own hop; this route is the hop an operator's
 * ingress sits in front of, so it says the same thing, and `no-transform` keeps a
 * compressing proxy from batching the frames. A non-200 is a JSON envelope rather than
 * a stream and keeps only what it carried.
 */

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  token: "tok_test",
};

let upstream: () => Response = () => new Response("", { status: 200 });

vi.mock("@/lib/server/agent", () => ({ agentAuthoringEnabled: () => true }));
vi.mock("@/lib/server/route-helpers", () => ({ isSameOriginPost: () => true }));
vi.mock("@/lib/server/session", () => ({
  requireAdminSessionForRequest: () => Promise.resolve(SESSION),
}));
vi.mock("@/lib/server/forms", () => ({
  assist: () => Promise.resolve(upstream()),
}));

const { POST } = await import("./route.ts");

function post(): Promise<Response> {
  const request = {
    json: () => Promise.resolve({ conversation: [{ role: "user", content: "Add a step" }] }),
  } as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ formId: "frm_quote" }) });
}

describe("POST /forms/[formId]/assist headers", () => {
  it("tells every proxy in front of it not to buffer or transform the stream", async () => {
    upstream = () =>
      new Response("event: status\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-cache");
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("relays a 429 with its retry-after and no stream headers", async () => {
    upstream = () =>
      new Response(JSON.stringify({ error: { message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" },
      });
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-accel-buffering")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
