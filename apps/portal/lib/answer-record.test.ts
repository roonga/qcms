import { describe, expect, it } from "vitest";

import {
  answerKey,
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
 * The flow's record of what the server holds and what it refused (issue #122).
 *
 * These are the two rules whose failures are invisible on screen: a redundant
 * append nobody sees, and a rejection message under a field that is now fine. They
 * are driven here as sequences rather than as single calls, because both defects
 * issue #122 reports are about ORDER - what the record held at the moment a second
 * commit arrived, and what it held after a post came back refused.
 *
 * The browser layer covers that these functions are actually wired up:
 * `apps/portal/e2e/answer-dedupe.pw.ts` pins the exact post counts for the
 * in-flight double post, the ordinary dedupe and the retract-then-re-answer
 * sequence; `resume.pw.ts` pins the issue #146 seeding these rules must not
 * regress; and `answer-rejection.pw.ts` drives the 422 halves - the rollback and
 * the message's lifetime - over a real API refusal. That last one was impossible
 * until issue #166: a browser logs any 4xx as a `console.error` and the shared e2e
 * gate failed every test on it, so these two rules had no layer above this one.
 * They stay pinned here as well, because a whole sequence is cheap to drive over
 * pure functions and expensive to drive through a browser.
 */

/** The record after answering `q_name` with "Ada", as the flow would have it. */
function afterAnswering(): PostedRecord {
  return withIssued({}, "q_name", "Ada");
}

describe("answerKey", () => {
  it("keeps absence distinct from every real value (issues #95, #98)", () => {
    // An emptied control means absence, and absence posts as `null`, so the key
    // for "no answer" has to be the one key no answer can produce.
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
});

describe("the record of what the server holds", () => {
  it("is seeded from the answers a served step reports (issue #146)", () => {
    const record = recordedAnswers({ q_name: "Ada", q_age: 36, q_cover: ["opt_a"] });
    // The gesture that destroyed data before the seed existed: focus enters and
    // leaves an untouched resumed control, so the blur commit sees the same value
    // the server already has and must post nothing.
    expect(isRecorded(record, "q_name", "Ada")).toBe(true);
    expect(isRecorded(record, "q_age", 36)).toBe(true);
    expect(isRecorded(record, "q_cover", ["opt_a"])).toBe(true);
    // ...while a genuine clear of a seeded answer is still a new thing to say.
    expect(isRecorded(record, "q_name", undefined)).toBe(false);
    expect(holdsAnswer(record, "q_name")).toBe(true);
  });

  it("treats a question the server holds nothing for as unrecorded", () => {
    const record = recordedAnswers({ q_name: "Ada" });
    expect(isRecorded(record, "q_dob", undefined)).toBe(false);
    expect(holdsAnswer(record, "q_dob")).toBe(false);
  });

  it("merges a served step's answers over the record without dropping the rest", () => {
    // Navigation adopts the answers the response carries; a question it does not
    // mention leaves this client's own record alone (it may hold a value posted on
    // another step).
    const merged = withServerHeld({ q_name: '"Ada"', q_dob: '"1990-05-17"' }, { q_name: "Grace" });
    expect(isRecorded(merged, "q_name", "Grace")).toBe(true);
    expect(isRecorded(merged, "q_dob", "1990-05-17")).toBe(true);
  });
});

describe("recording a post when it is issued (issue #122, symptom 1)", () => {
  it("makes the value recorded before the post resolves, so the blur behind it posts nothing", () => {
    // A `change` control (boolean, singleChoice under ADR-31) posts on selection;
    // focus leaves it while that post is still in flight. Recording on RESOLUTION
    // left this false, and the blur commit re-posted the identical value.
    const record = withIssued({}, "q_accident", false);
    expect(isRecorded(record, "q_accident", false)).toBe(true);
  });

  it("still recognises a genuine change made while a post is in flight", () => {
    const record = withIssued({}, "q_accident", false);
    expect(isRecorded(record, "q_accident", true)).toBe(false);
  });
});

describe("rolling the record back when a post is refused (issue #122, symptom 2)", () => {
  it("leaves the refused value postable again", () => {
    const held = afterAnswering();
    // The respondent replaces "Ada" with something the API refuses.
    const issued = withIssued(held, "q_name", "123");
    const rolledBack = withRollback(issued, held, "q_name", answerKey("123"));
    // What the server actually has is what it had before the refusal...
    expect(isRecorded(rolledBack, "q_name", "Ada")).toBe(true);
    // ...and re-entering the refused value posts rather than being deduped into
    // silence, which is what a retry needs the moment the same body could be
    // accepted later (a transient failure, a changed constraint).
    expect(isRecorded(rolledBack, "q_name", "123")).toBe(false);
  });

  it("restores ABSENCE when the question had no recorded answer", () => {
    // Not "the key `null`": a `completion` clear reads the difference between "the
    // server holds nothing" and "the server holds a retraction" to decide whether
    // a clear is a retraction at all (ADR-31 amended x ADR-33).
    const issued = withIssued({}, "q_dob", "1990-05-17");
    const rolledBack = withRollback(issued, {}, "q_dob", answerKey("1990-05-17"));
    expect(holdsAnswer(rolledBack, "q_dob")).toBe(false);
    expect(isRecorded(rolledBack, "q_dob", undefined)).toBe(false);
  });

  it("does not clobber a newer post issued for the same question", () => {
    // Two commits, then the FIRST comes back refused. Its rollback is stale: the
    // second post is the current truth about what the server is being told.
    const held = afterAnswering();
    const first = withIssued(held, "q_name", "123");
    const second = withIssued(first, "q_name", "Grace");
    const rolledBack = withRollback(second, held, "q_name", answerKey("123"));
    expect(rolledBack).toBe(second);
    expect(isRecorded(rolledBack, "q_name", "Grace")).toBe(true);
  });

  it("restores absence rather than a refused predecessor when two refusals overlap", () => {
    // Issue #169, the interleaving #122's compare-and-swap did not cover. Two posts
    // for one question are in flight at once and BOTH come back refused.
    //
    // The question starts unanswered, so nothing has ever been confirmed for it.
    const confirmed: PostedRecord = {};
    // Post A is issued for "123"...
    const afterA = withIssued(confirmed, "q_name", "123");
    // ...and post B for "456" is issued before A resolves.
    const afterB = withIssued(afterA, "q_name", "456");

    // A resolves first and is refused. Its rollback is stale: B's entry is the
    // current truth about what the server is being told, so the CAS declines.
    const afterARollback = withRollback(afterB, confirmed, "q_name", answerKey("123"));
    expect(afterARollback).toBe(afterB);

    // Then B is refused. Reading its predecessor out of the record it was issued
    // against would reinstate "123" - a value the server refused and never held -
    // and re-entering "123" would then be deduped into silence. The predecessor
    // comes from the confirmed record instead, which holds nothing for this
    // question, so the rollback restores ABSENCE.
    const afterBRollback = withRollback(afterARollback, confirmed, "q_name", answerKey("456"));
    expect(holdsAnswer(afterBRollback, "q_name")).toBe(false);
    // Both refused values are postable again, which is the symptom stated directly.
    expect(isRecorded(afterBRollback, "q_name", "123")).toBe(false);
    expect(isRecorded(afterBRollback, "q_name", "456")).toBe(false);
  });

  it("restores the last ACCEPTED value when two later refusals overlap", () => {
    // The same interleaving over a question the server does hold an answer for. The
    // rollback must land on "Ada", the accepted value, and not on either refusal.
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
    // Issue #98's absence semantics through the whole sequence: answered, cleared,
    // then the same value again. Every step has something new to say.
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
    // The rule: the message describes ONE value, so the edit that replaces the
    // value clears it. Tying it to the next accepted post instead leaves it up
    // while the respondent types the correction.
    expect(visibleErrors(rejected, { q_name: "12" })).toEqual({});
    expect(visibleErrors(rejected, { q_name: undefined })).toEqual({});
  });

  it("clears when the correction restores the value the server already holds", () => {
    // The case that made the message permanent: the correction is deduped (the
    // stored answer was never overwritten by the refused one), so no accepted post
    // for this field can ever arrive to clear it.
    expect(visibleErrors(rejected, { q_name: "Ada" })).toEqual({});
  });

  it("keeps other questions' messages independent", () => {
    const two = withRejection(rejected, "q_age", 200, "That answer is not valid.");
    expect(visibleErrors(two, { q_name: "Ada", q_age: 200 })).toEqual({
      q_age: "That answer is not valid.",
    });
  });

  it("drops a refusal once a post for that question is accepted", () => {
    // So a value the API refused before and accepts now (a changed constraint)
    // cannot resurrect the old message by being typed again.
    const cleared = withoutRejection(rejected, "q_name");
    expect(visibleErrors(cleared, { q_name: "123" })).toEqual({});
    expect(withoutRejection(cleared, "q_name")).toBe(cleared);
  });

  it("is one stable object when nothing is refused", () => {
    // The renderer memoises on the errors object's identity, so an error-free
    // render must not allocate a new one per keystroke.
    expect(visibleErrors({}, { q_name: "Ada" })).toBe(visibleErrors({}, { q_name: "Grace" }));
  });
});
