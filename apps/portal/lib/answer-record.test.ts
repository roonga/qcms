import { describe, expect, it } from "vitest";

import {
  answerKey,
  commitsOnFocusExit,
  holdsAnswer,
  isRecorded,
  recordedAnswers,
  visibleErrors,
  withConfirmed,
  withIssued,
  withRejection,
  withRollback,
  withServerHeld,
  withoutRejection,
  type PostedRecord,
} from "./answer-record.js";

/**
 * Driven as sequences rather than single calls, because both rules are about order:
 * what the record held when a second commit arrived, and what it held after a post came
 * back refused. The browser layer covers that these functions are wired up.
 */

function afterAnswering(): PostedRecord {
  return withIssued({}, "q_name", "Ada");
}

describe("answerKey", () => {
  it("keeps absence distinct from every real value (issues #95, #98)", () => {
    expect(answerKey(undefined)).toBe("null");
    expect(answerKey("null")).not.toBe(answerKey(undefined));
    expect(answerKey("")).not.toBe(answerKey(undefined));
    expect(answerKey(0)).not.toBe(answerKey(undefined));
    expect(answerKey(false)).not.toBe(answerKey(undefined));
    expect(answerKey([])).not.toBe(answerKey(undefined));
  });

  it("separates values that only a shape comparison can tell apart", () => {
    expect(answerKey("10")).not.toBe(answerKey(10));
    expect(answerKey(["a"])).not.toBe(answerKey("a"));
    expect(answerKey(["a", "b"])).toBe(answerKey(["a", "b"]));
  });

  it("reads a multiChoice selection as a set, as the kernel does (issue #167, ADR-21)", () => {
    expect(answerKey(["opt_a", "opt_b"])).toBe(answerKey(["opt_b", "opt_a"]));
    expect(answerKey(["opt_a", "opt_b", "opt_c"])).toBe(answerKey(["opt_c", "opt_a", "opt_b"]));
    expect(answerKey(["opt_a", "opt_b"])).not.toBe(answerKey(["opt_a", "opt_c"]));
    expect(answerKey(["opt_a", "opt_b"])).not.toBe(answerKey(["opt_a"]));
  });

  it("sorts into a copy, leaving the rendered selection untouched (issue #167)", () => {
    const selection = ["opt_b", "opt_a"];
    answerKey(selection);
    expect(selection).toEqual(["opt_b", "opt_a"]);
  });

  it("keeps absence distinct from every reordered array too (issue #167)", () => {
    expect(answerKey([])).not.toBe(answerKey(undefined));
    expect(answerKey(["null"])).not.toBe(answerKey(undefined));
    expect(answerKey([])).not.toBe(answerKey(["opt_a"]));
  });
});

describe("the record of what the server holds", () => {
  it("is seeded from the answers a served step reports (issue #146)", () => {
    const record = recordedAnswers({ q_name: "Ada", q_age: 36, q_cover: ["opt_a"] });
    expect(isRecorded(record, "q_name", "Ada")).toBe(true);
    expect(isRecorded(record, "q_age", 36)).toBe(true);
    expect(isRecorded(record, "q_cover", ["opt_a"])).toBe(true);
    expect(isRecorded(record, "q_name", undefined)).toBe(false);
    expect(holdsAnswer(record, "q_name")).toBe(true);
  });

  it("treats a question the server holds nothing for as unrecorded", () => {
    const record = recordedAnswers({ q_name: "Ada" });
    expect(isRecorded(record, "q_dob", undefined)).toBe(false);
    expect(holdsAnswer(record, "q_dob")).toBe(false);
  });

  it("merges a served step's answers over the record without dropping the rest", () => {
    const merged = withServerHeld({ q_name: '"Ada"', q_dob: '"1990-05-17"' }, { q_name: "Grace" });
    expect(isRecorded(merged, "q_name", "Grace")).toBe(true);
    expect(isRecorded(merged, "q_dob", "1990-05-17")).toBe(true);
  });
});

describe("recording a post when it is issued (issue #122, symptom 1)", () => {
  it("makes the value recorded before the post resolves, so the blur behind it posts nothing", () => {
    const record = withIssued({}, "q_accident", false);
    expect(isRecorded(record, "q_accident", false)).toBe(true);
  });

  it("still recognises a genuine change made while a post is in flight", () => {
    const record = withIssued({}, "q_accident", false);
    expect(isRecorded(record, "q_accident", true)).toBe(false);
  });
});

describe("a multiChoice selection through the record (issue #167)", () => {
  it("dedupes a reorder, posts a changed set, and posts both halves of retract-then-re-answer", () => {
    let record = recordedAnswers({ q_cover: ["opt_a", "opt_b"] });

    expect(isRecorded(record, "q_cover", ["opt_b", "opt_a"])).toBe(true);

    expect(isRecorded(record, "q_cover", ["opt_a", "opt_c"])).toBe(false);
    record = withIssued(record, "q_cover", ["opt_a", "opt_c"]);
    expect(isRecorded(record, "q_cover", ["opt_c", "opt_a"])).toBe(true);

    expect(isRecorded(record, "q_cover", undefined)).toBe(false);
    expect(holdsAnswer(record, "q_cover")).toBe(true);
    record = withIssued(record, "q_cover", undefined);
    expect(holdsAnswer(record, "q_cover")).toBe(false);

    expect(isRecorded(record, "q_cover", ["opt_c", "opt_a"])).toBe(false);
    record = withIssued(record, "q_cover", ["opt_c", "opt_a"]);
    expect(isRecorded(record, "q_cover", ["opt_a", "opt_c"])).toBe(true);
  });

  it("adopts a served step's selection whatever order the response lists it in", () => {
    const merged = withServerHeld(withIssued({}, "q_cover", ["opt_a", "opt_b"]), {
      q_cover: ["opt_b", "opt_a"],
    });
    expect(isRecorded(merged, "q_cover", ["opt_a", "opt_b"])).toBe(true);
  });
});

describe("rolling the record back when a post is refused (issue #122, symptom 2)", () => {
  it("leaves the refused value postable again", () => {
    const held = afterAnswering();
    const issued = withIssued(held, "q_name", "123");
    const rolledBack = withRollback(issued, held, "q_name", answerKey("123"));
    expect(isRecorded(rolledBack, "q_name", "Ada")).toBe(true);
    expect(isRecorded(rolledBack, "q_name", "123")).toBe(false);
  });

  it("restores ABSENCE when the question had no recorded answer", () => {
    const issued = withIssued({}, "q_dob", "1990-05-17");
    const rolledBack = withRollback(issued, {}, "q_dob", answerKey("1990-05-17"));
    expect(holdsAnswer(rolledBack, "q_dob")).toBe(false);
    expect(isRecorded(rolledBack, "q_dob", undefined)).toBe(false);
  });

  it("does not clobber a newer post issued for the same question", () => {
    const held = afterAnswering();
    const first = withIssued(held, "q_name", "123");
    const second = withIssued(first, "q_name", "Grace");
    const rolledBack = withRollback(second, held, "q_name", answerKey("123"));
    expect(rolledBack).toBe(second);
    expect(isRecorded(rolledBack, "q_name", "Grace")).toBe(true);
  });

  it("restores absence rather than a refused predecessor when two refusals overlap", () => {
    const confirmed: PostedRecord = {};
    const afterA = withIssued(confirmed, "q_name", "123");
    const afterB = withIssued(afterA, "q_name", "456");

    const afterARollback = withRollback(afterB, confirmed, "q_name", answerKey("123"));
    expect(afterARollback).toBe(afterB);

    const afterBRollback = withRollback(afterARollback, confirmed, "q_name", answerKey("456"));
    expect(holdsAnswer(afterBRollback, "q_name")).toBe(false);
    expect(isRecorded(afterBRollback, "q_name", "123")).toBe(false);
    expect(isRecorded(afterBRollback, "q_name", "456")).toBe(false);
  });

  it("restores the last ACCEPTED value when two later refusals overlap", () => {
    const confirmed = withConfirmed({}, "q_name", "Ada");
    const afterA = withIssued(confirmed, "q_name", "123");
    const afterB = withIssued(afterA, "q_name", "456");

    const afterARollback = withRollback(afterB, confirmed, "q_name", answerKey("123"));
    const afterBRollback = withRollback(afterARollback, confirmed, "q_name", answerKey("456"));

    expect(isRecorded(afterBRollback, "q_name", "Ada")).toBe(true);
    expect(isRecorded(afterBRollback, "q_name", "123")).toBe(false);
    expect(isRecorded(afterBRollback, "q_name", "456")).toBe(false);
  });

  it("keeps a retraction and a re-answer of the retracted value both postable", () => {
    const answered = afterAnswering();
    expect(isRecorded(answered, "q_name", undefined)).toBe(false);
    const retracted = withIssued(answered, "q_name", undefined);
    expect(holdsAnswer(retracted, "q_name")).toBe(false);
    expect(isRecorded(retracted, "q_name", "Ada")).toBe(false);
    const reAnswered = withIssued(retracted, "q_name", "Ada");
    expect(isRecorded(reAnswered, "q_name", "Ada")).toBe(true);
  });
});

describe("the field errors a refusal displays (issue #122, symptom 2)", () => {
  const rejected = withRejection({}, "q_name", "123", "That answer is not valid.");

  it("shows the message while the field still holds the refused value", () => {
    expect(visibleErrors(rejected, { q_name: "123" })).toEqual({
      q_name: "That answer is not valid.",
    });
  });

  it("clears on the edit that replaces the refused value, with no post involved", () => {
    expect(visibleErrors(rejected, { q_name: "12" })).toEqual({});
    expect(visibleErrors(rejected, { q_name: undefined })).toEqual({});
  });

  it("clears when the correction restores the value the server already holds", () => {
    expect(visibleErrors(rejected, { q_name: "Ada" })).toEqual({});
  });

  it("keeps other questions' messages independent", () => {
    const two = withRejection(rejected, "q_age", 200, "That answer is not valid.");
    expect(visibleErrors(two, { q_name: "Ada", q_age: 200 })).toEqual({
      q_age: "That answer is not valid.",
    });
  });

  it("drops a refusal once a post for that question is accepted", () => {
    const cleared = withoutRejection(rejected, "q_name");
    expect(visibleErrors(cleared, { q_name: "123" })).toEqual({});
    expect(withoutRejection(cleared, "q_name")).toBe(cleared);
  });

  it("is one stable object when nothing is refused", () => {
    expect(visibleErrors({}, { q_name: "Ada" })).toBe(visibleErrors({}, { q_name: "Grace" }));
  });
});

/**
 * Whether focus leaving a control commits anything (issue #168).
 *
 * The rule this pins is a **posting policy**, not a repair: a retraction of a
 * never-held answer conveys nothing the server does not already know, and the API's
 * `before.has(questionId)` guard already made such a post a no-op, so nothing was
 * ever stored or lost. What it cost was a round trip per control a respondent tabs
 * through, a 422 whenever the question was required, and the `console.error` that
 * followed - which had bent test design, since `e2e/a11y-focus-target.pw.ts`
 * answered every question first to keep a keyboard-traversal spec off the console
 * gate. That workaround is gone with this rule.
 *
 * Driven here rather than only in the browser because this decides whether a
 * network call happens at all, and both directions have to hold: a real retraction
 * must still post (issue #95's whole point), and #146's data-loss scenario - a
 * RESUMED step, where the record comes from the server's answers rather than from
 * this client's writes - is the regression to guard against. `answer-dedupe.pw.ts`
 * and `resume.pw.ts` pin the exact post counts over a real API.
 */
describe("what focus leaving a control commits (issue #168)", () => {
  const MOMENTS = ["blur", "groupExit"] as const;

  it.each(MOMENTS)("posts nothing when an empty %s control was never answered", (moment) => {
    expect(commitsOnFocusExit({}, "q_name", undefined, moment)).toBe(false);
  });

  it.each(MOMENTS)("posts the retraction of a held answer at the %s moment", (moment) => {
    expect(commitsOnFocusExit(afterAnswering(), "q_name", undefined, moment)).toBe(true);
  });

  it.each(MOMENTS)("posts nothing at the %s moment once the retraction landed", (moment) => {
    const retracted = withIssued(afterAnswering(), "q_name", undefined);
    expect(holdsAnswer(retracted, "q_name")).toBe(false);
    expect(commitsOnFocusExit(retracted, "q_name", undefined, moment)).toBe(false);
  });

  it("is correct on a RESUMED step, where the record came from the server (issue #146)", () => {
    const resumed = recordedAnswers({ q_name: "Ada", q_cover: ["opt_a"] });
    expect(commitsOnFocusExit(resumed, "q_name", undefined, "blur")).toBe(true);
    expect(commitsOnFocusExit(resumed, "q_cover", undefined, "groupExit")).toBe(true);
    expect(commitsOnFocusExit(resumed, "q_dob", undefined, "blur")).toBe(false);
  });

  it("counts an in-flight post as held, and a refused one as not", () => {
    const inFlight = withIssued({}, "q_name", "Ada");
    expect(commitsOnFocusExit(inFlight, "q_name", undefined, "blur")).toBe(true);
    const rolledBack = withRollback(inFlight, {}, "q_name", answerKey("Ada"));
    expect(commitsOnFocusExit(rolledBack, "q_name", undefined, "blur")).toBe(false);
  });

  it("commits a real value whatever the record says", () => {
    expect(commitsOnFocusExit({}, "q_name", "Ada", "blur")).toBe(true);
    expect(commitsOnFocusExit(afterAnswering(), "q_name", "Ada", "blur")).toBe(true);
    expect(commitsOnFocusExit({}, "q_cover", ["opt_a"], "groupExit")).toBe(true);
  });

  it("keeps the completion moment's stricter rule: an empty date never commits here", () => {
    expect(commitsOnFocusExit({}, "q_dob", undefined, "completion")).toBe(false);
    expect(
      commitsOnFocusExit(
        recordedAnswers({ q_dob: "1990-05-17" }),
        "q_dob",
        undefined,
        "completion",
      ),
    ).toBe(false);
    expect(commitsOnFocusExit({}, "q_dob", "1990-05-17", "completion")).toBe(true);
  });
});
