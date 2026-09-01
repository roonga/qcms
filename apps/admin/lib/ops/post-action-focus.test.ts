import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which post-action focus requests are claimable (issue #357).
 *
 * `ResponseDetail`'s effect cleanup re-arms the request on EVERY unmount, and it has to:
 * a cleanup runs before its successor exists, so it cannot observe the successor it is
 * arming for. The successor condition therefore lives in the request itself, as the
 * subject the action was performed on, and is checked when the request is claimed. That
 * decision is what this file drives; it is the whole of the defect.
 *
 * ## Why this is testable here at all, given #352
 *
 * The admin has no jsdom layer, and the focus MOVE genuinely needs one - it is
 * `apps/admin/e2e/ops-focus.pw.ts`. But the move is not what was wrong. What was wrong is
 * which request a mounting card is entitled to take, which is module state and a pair of
 * string comparisons, and `claimPostActionFocus` reaches the DOM only after it has
 * decided. So a `getElementById` that answers `null` is enough to observe every decision
 * without pretending to observe a focus change: `focusPostAction(null)` returns
 * `undefined` and touches nothing else.
 */

const HEADING = "qcms-tombstone-heading";

/** A `document` with no elements in it, which is all the decision path needs. */
const EMPTY_DOCUMENT = { getElementById: () => null };

let focus: typeof import("./post-action-focus.js");

beforeEach(async () => {
  vi.stubGlobal("document", EMPTY_DOCUMENT);
  // Fresh module state per test: the request is a module-level singleton, which is the
  // property that lets it survive the route swap and also the property that would let
  // one test's leftover request decide the next one's verdict.
  vi.resetModules();
  focus = await import("./post-action-focus.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("claiming a post-action focus request", () => {
  it("is claimed by the post-action state of the subject it names", () => {
    focus.requestPostActionFocus(HEADING, "ses_erased");
    // The claim resolves: the request was addressed here. It returns no cleanup only
    // because the stubbed document holds no such element.
    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
    // ...and it is spent, so nothing can take it twice.
    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
  });

  it("is NOT claimed by a different subject rendering the same element id", () => {
    // The reported sequence: erase response A, navigate away inside the TTL so the
    // cleanup re-arms, then open a DIFFERENT already-erased response's URL. Every
    // tombstone in the app renders the same heading id, so before the subject was
    // carried, that card took the request and stole focus on arrival - which is
    // precisely what the module says a direct URL visit must not do.
    focus.requestPostActionFocus(HEADING, "ses_erased");
    expect(focus.claimPostActionFocus(HEADING, "ses_other")).toBeUndefined();
  });

  it("leaves a request addressed elsewhere pending rather than consuming it", () => {
    // A near miss must not spend the request: the subject it names is still owed a
    // focus move, and swallowing it here would silently drop that.
    focus.requestPostActionFocus(HEADING, "ses_erased");
    focus.claimPostActionFocus(HEADING, "ses_other");
    focus.claimPostActionFocus("qcms-some-other-heading", "ses_erased");

    const spy = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById: spy });
    focus.claimPostActionFocus(HEADING, "ses_erased");
    expect(spy).toHaveBeenCalledWith(HEADING);
  });

  it("does nothing at all when no action left a request", () => {
    // An ordinary visit to an erased response's URL is an ordinary visit.
    const spy = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById: spy });
    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("expires rather than being honoured by a much later mount", () => {
    vi.useFakeTimers();
    focus.requestPostActionFocus(HEADING, "ses_erased");
    // Past the TTL: the request is dropped even for the subject it names, so a return
    // visit long after the erasure is an ordinary visit too.
    vi.advanceTimersByTime(30_000);
    const spy = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById: spy });
    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
