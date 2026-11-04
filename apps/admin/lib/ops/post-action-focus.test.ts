import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HEADING = "qcms-tombstone-heading";

const EMPTY_DOCUMENT = { getElementById: () => null };

let focus: typeof import("./post-action-focus.js");

beforeEach(async () => {
  vi.stubGlobal("document", EMPTY_DOCUMENT);

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

    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();

    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
  });

  it("is NOT claimed by a different subject rendering the same element id", () => {
    focus.requestPostActionFocus(HEADING, "ses_erased");
    expect(focus.claimPostActionFocus(HEADING, "ses_other")).toBeUndefined();
  });

  it("leaves a request addressed elsewhere pending rather than consuming it", () => {
    focus.requestPostActionFocus(HEADING, "ses_erased");
    focus.claimPostActionFocus(HEADING, "ses_other");
    focus.claimPostActionFocus("qcms-some-other-heading", "ses_erased");

    const spy = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById: spy });
    focus.claimPostActionFocus(HEADING, "ses_erased");
    expect(spy).toHaveBeenCalledWith(HEADING);
  });

  it("does nothing at all when no action left a request", () => {
    const spy = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById: spy });
    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("expires rather than being honoured by a much later mount", () => {
    vi.useFakeTimers();
    focus.requestPostActionFocus(HEADING, "ses_erased");

    vi.advanceTimersByTime(30_000);
    const spy = vi.fn(() => null);
    vi.stubGlobal("document", { getElementById: spy });
    expect(focus.claimPostActionFocus(HEADING, "ses_erased")).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
