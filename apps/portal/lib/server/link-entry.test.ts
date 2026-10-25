import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  writeCookie: vi.fn(),
  basePath: vi.fn(),
}));

vi.mock("@/lib/server/api", () => ({
  startLinkSession: mocks.start,
  ApiError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock("@/lib/server/session-cookie", () => ({ writeSessionToken: mocks.writeCookie }));
vi.mock("@/lib/server/environment", () => ({ currentBasePath: mocks.basePath }));
vi.mock("@/lib/server/config", async () => import("./config"));

import { GET } from "../../app/l/[token]/route";
import { ApiError } from "@/lib/server/api";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["", "/test"])("secure-link redirects with prefix '%s'", (basePath) => {
  // Next standalone's request URL uses the container's bind address and internal port.
  const request = (): Request => new Request("http://0.0.0.0:3000/l/opaque-link");
  const context = (): { params: Promise<{ token: string }> } => ({
    params: Promise.resolve({ token: "opaque-link" }),
  });

  it("redirects a new session to the public portal, preserving the environment", async () => {
    mocks.basePath.mockResolvedValue(basePath);
    mocks.start.mockResolvedValue({ sessionId: "ses_created", sessionToken: "session-bearer" });

    const response = await GET(request(), context());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`http://localhost:7000${basePath}/s/ses_created`);
    expect(mocks.start).toHaveBeenCalledWith({ token: "opaque-link" });
    expect(mocks.writeCookie).toHaveBeenCalledWith("session-bearer");
  });

  it.each([
    ["LINK_EXPIRED", "expired"],
    ["FORM_CLOSED", "closed"],
    ["LINK_WRONG_ENVIRONMENT", "invalid"],
  ])("redirects %s to a public error page", async (code, kind) => {
    mocks.basePath.mockResolvedValue(basePath);
    mocks.start.mockRejectedValue(new ApiError(code, 409));

    const response = await GET(request(), context());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:7000${basePath}/link-error?kind=${kind}`,
    );
    expect(mocks.writeCookie).not.toHaveBeenCalled();
  });
});
