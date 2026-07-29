import { describe, expect, it } from "vitest";

import { REQUEST_ID_HEADER, currentRequestId, normalizeRequestId } from "./request-id";

/**
 * The `x-request-id` bridge (task 054, ADR-34 P5). `normalizeRequestId` mirrors
 * the API's own acceptance rule (inbound honoured up to 200 characters,
 * `apps/api/src/middleware/request-logger.ts`), so the portal never forwards a
 * value the API would discard and then log a different id for.
 */
describe("normalizeRequestId", () => {
  it("keeps a sane inbound id, trimmed", () => {
    expect(normalizeRequestId("req-1")).toBe("req-1");
    expect(normalizeRequestId("  req-1  ")).toBe("req-1");
  });

  it("rejects nothing-to-forward and over-long values (the API's own limit)", () => {
    expect(normalizeRequestId(null)).toBeUndefined();
    expect(normalizeRequestId(undefined)).toBeUndefined();
    expect(normalizeRequestId("")).toBeUndefined();
    expect(normalizeRequestId("   ")).toBeUndefined();
    expect(normalizeRequestId("x".repeat(200))).toHaveLength(200);
    expect(normalizeRequestId("x".repeat(201))).toBeUndefined();
  });
});

describe("currentRequestId", () => {
  it("is undefined outside a request scope, and never invents an id", async () => {
    // `headers()` throws here (no Next request store). The BFF must then send no
    // header at all and let the API generate one, rather than mint a per-fetch id
    // that correlates nothing.
    await expect(currentRequestId()).resolves.toBeUndefined();
  });
});

describe("REQUEST_ID_HEADER", () => {
  it("is the wire name both sides agree on", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});
