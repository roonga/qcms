import { describe, expect, it } from "vitest";

import { REQUEST_ID_HEADER, currentRequestId, normalizeRequestId } from "./request-id";

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
    await expect(currentRequestId()).resolves.toBeUndefined();
  });
});

describe("REQUEST_ID_HEADER", () => {
  it("is the wire name both sides agree on", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});
