import { describe, expect, it } from "vitest";

import { EraseErrorCode, EraseOutcome, EraseRequest } from "./erasure.js";

describe("EraseRequest", () => {
  it("accepts a well-formed request", () => {
    const parsed = EraseRequest.parse({ sessionId: "ses_abc", reason: "subject_request" });
    expect(parsed).toEqual({ sessionId: "ses_abc", reason: "subject_request" });
  });

  it("rejects an empty reason", () => {
    expect(EraseRequest.safeParse({ sessionId: "ses_abc", reason: "" }).success).toBe(false);
  });

  it("rejects a sessionId with the wrong prefix", () => {
    expect(EraseRequest.safeParse({ sessionId: "frm_abc", reason: "x" }).success).toBe(false);
  });
});

describe("EraseOutcome", () => {
  const base = {
    sessionId: "ses_abc",
    formId: "frm_x",
    formVersion: 3,
    erasedAt: new Date("2026-07-20T00:00:00.000Z"),
    reason: "subject_request",
    alreadyErased: false,
  };

  it("accepts a well-formed outcome", () => {
    expect(EraseOutcome.parse(base)).toEqual(base);
  });

  it("requires an integer formVersion", () => {
    expect(EraseOutcome.safeParse({ ...base, formVersion: 1.5 }).success).toBe(false);
  });

  it("requires erasedAt to be a Date", () => {
    expect(EraseOutcome.safeParse({ ...base, erasedAt: "2026-07-20" }).success).toBe(false);
  });
});

describe("EraseErrorCode", () => {
  it("is the closed set { SESSION_NOT_FOUND }", () => {
    expect(EraseErrorCode.options).toEqual(["SESSION_NOT_FOUND"]);
    expect(EraseErrorCode.safeParse("SESSION_NOT_FOUND").success).toBe(true);
    expect(EraseErrorCode.safeParse("nope").success).toBe(false);
  });
});
