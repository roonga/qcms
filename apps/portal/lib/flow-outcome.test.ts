import { describe, expect, it } from "vitest";

import {
  countRefusalAfterSuccess,
  failureAfterSuccess,
  refusalOutcome,
  type FlowFailure,
} from "./flow-outcome";

/**
 * Local UX list P2 and P9. The hydrated flow read an expired or already-submitted
 * session's 409 as a network failure and said "We could not reach the server" for ever,
 * and it never cleared that notice or the count refusal once either was set. The rules
 * that decide both are here so they can be driven without a browser; the browser half is
 * `e2e/flow-states.pw.ts`.
 */
describe("refusalOutcome (local UX list P2)", () => {
  it("reloads for the session states the page owns a screen for", () => {
    expect(refusalOutcome(409, "SESSION_EXPIRED")).toBe("reload");
    expect(refusalOutcome(409, "SESSION_SUBMITTED")).toBe("reload");
    expect(refusalOutcome(409, "UNSUPPORTED_SEMANTICS_VERSION")).toBe("reload");
    expect(refusalOutcome(404, "SESSION_NOT_FOUND")).toBe("reload");
  });

  it("reloads for a lost credential whatever the body says", () => {
    expect(refusalOutcome(401, undefined)).toBe("reload");
    expect(refusalOutcome(401, "unauthorized")).toBe("reload");
  });

  it("tells the not-visible 409 apart from the terminal ones by its code", () => {
    expect(refusalOutcome(409, "QUESTION_NOT_VISIBLE")).toBe("notVisible");
  });

  it("treats everything else as a failure the respondent may retry", () => {
    expect(refusalOutcome(409, undefined)).toBe("failed");
    expect(refusalOutcome(409, "NOTHING_TO_SUBMIT")).toBe("failed");
    expect(refusalOutcome(500, "SESSION_EXPIRED")).toBe("failed");
    expect(refusalOutcome(502, undefined)).toBe("failed");
    expect(refusalOutcome(403, "forbidden")).toBe("failed");
    expect(refusalOutcome(404, "QUESTION_NOT_VISIBLE")).toBe("failed");
  });
});

describe("failureAfterSuccess (local UX list P9)", () => {
  const answerA: FlowFailure = { kind: "answer", questionId: "q_a" };

  it("has nothing to clear when nothing is showing", () => {
    expect(failureAfterSuccess(undefined, { kind: "navigation" })).toBeUndefined();
  });

  it("clears every notice on a navigation the server answered", () => {
    for (const failure of [
      answerA,
      { kind: "advance" },
      { kind: "back" },
      { kind: "refresh" },
    ] satisfies FlowFailure[]) {
      expect(failureAfterSuccess(failure, { kind: "navigation" })).toBeUndefined();
    }
  });

  it("clears a navigation failure on any answered round trip", () => {
    expect(
      failureAfterSuccess({ kind: "advance" }, { kind: "answer", questionId: "q_b" }),
    ).toBeUndefined();
    expect(failureAfterSuccess({ kind: "back" }, { kind: "roster" })).toBeUndefined();
    expect(failureAfterSuccess({ kind: "advance" }, { kind: "submitRefused" })).toBeUndefined();
  });

  it("keeps a failed answer's notice until that answer, or a navigation, gets through", () => {
    expect(failureAfterSuccess(answerA, { kind: "answer", questionId: "q_b" })).toBe(answerA);
    expect(failureAfterSuccess(answerA, { kind: "roster" })).toBe(answerA);
    expect(failureAfterSuccess(answerA, { kind: "submitRefused" })).toBe(answerA);
    expect(failureAfterSuccess(answerA, { kind: "answer", questionId: "q_a" })).toBeUndefined();
  });
});

describe("countRefusalAfterSuccess (local UX list P9)", () => {
  it("is cleared by a roster change or a navigation", () => {
    expect(countRefusalAfterSuccess(true, { kind: "roster" })).toBe(false);
    expect(countRefusalAfterSuccess(true, { kind: "navigation" })).toBe(false);
  });

  it("survives an answer save, which cannot change a group's count", () => {
    expect(countRefusalAfterSuccess(true, { kind: "answer", questionId: "q_a" })).toBe(true);
  });

  it("stays off when it was off", () => {
    expect(countRefusalAfterSuccess(false, { kind: "answer", questionId: "q_a" })).toBe(false);
    expect(countRefusalAfterSuccess(false, { kind: "roster" })).toBe(false);
  });
});
