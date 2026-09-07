import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_DEBOUNCE_MS, useDraftAutosave } from "./autosave.ts";
import type { SaveDraftState, ValidateDraftState } from "./builder-state.ts";
import type { DraftForm } from "./types.ts";

/**
 * The save loop's UNMOUNT FLUSH: leaving a drafting screen stores what is on it (#669).
 *
 * ## Why this file exists at all, and why not in the browser
 *
 * The flush is a bug fix, and the bug is the absence of a request. An edit made inside the
 * 600ms debounce used to vanish when the screen went away: no call, no error, and nothing
 * on screen to say so. Nothing about that is visible, which is exactly why it survived.
 *
 * The browser walks cannot pin it. They were rewritten in the same change to WAIT for the
 * save before crossing a route boundary, because a walk that wants to see the edit on the
 * next screen has to; so the suite deliberately never enters the window this guards. A
 * walk that did enter it would be asserting on a race. The window is a timer and a
 * lifecycle, both of which a jsdom render owns exactly and a browser owns only
 * approximately, so this is the highest layer that can actually see the behaviour (ADR-23).
 *
 * ## The three properties, and why each is a separate case
 *
 * Each fails differently and a single test would hide two of them.
 *
 * 1. **Nothing is armed at mount**, so React's StrictMode double-mount sends no request.
 *    `apps/admin/next.config.ts` sets `reactStrictMode: true`, so every mount in
 *    development is a mount, an unmount and a mount again. A flush that fired on an
 *    unarmed cleanup would PUT the server's own draft straight back on every screen open.
 * 2. **An edit inside the window is submitted exactly once.** Once is both halves: at
 *    least once is the fix, and at most once is the trap beside it - the debounce timer
 *    and the cleanup both hold the same draft, so a flush that did not claim the pending
 *    edit would send it twice.
 * 3. **An untouched screen sends nothing**, timer or no timer. The loop only ever speaks
 *    for an edit somebody made, which is what keeps a `seeded` draft from being stored
 *    back as though an author had written it.
 *
 * ## Red first
 *
 * Delete the mount-scoped `useEffect` at the end of `useDraftAutosave` and case 2 fails on
 * `saveDraft` never being called; cases 1 and 3 pass unchanged, which is the point of
 * keeping them - the fix ADDS a call in one window rather than changing when the loop
 * talks in general.
 */

/** The smallest draft the loop will store: one step, one pin, no targetless rule. */
const DRAFT: DraftForm = {
  formId: "frm_autosave",
  defaultLocale: "en",
  title: { en: "Life insurance" },
  steps: [
    {
      stepId: "stp_health",
      title: { en: "Health" },
      items: [{ questionId: "q_smoker", version: 1 }],
    },
  ],
  rules: [],
};

/** The same document with one field moved, which is what an edit looks like to the loop. */
const EDITED: DraftForm = { ...DRAFT, title: { en: "Life insurance, renamed" } };

function saved(): SaveDraftState {
  return { status: "saved", issues: [], warnings: [] };
}

function validated(): ValidateDraftState {
  return { status: "ok", valid: true, issues: [], warnings: [] };
}

/**
 * Fake timers, because the debounce IS the subject.
 *
 * The window this file is about is the 600ms between an edit and its request, and a test
 * that waited it out in real time would be asserting on whichever of the two the machine
 * happened to reach first. With the clock held, "unmount before the timer fires" is a
 * statement rather than a hope, and the file runs in milliseconds.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function harness() {
  const saveDraft = vi.fn<(draft: DraftForm) => Promise<SaveDraftState>>(() =>
    Promise.resolve(saved()),
  );
  const validateDraft = vi.fn<(draft: DraftForm) => Promise<ValidateDraftState>>(() =>
    Promise.resolve(validated()),
  );
  return { saveDraft, validateDraft };
}

describe("the draft save loop's unmount flush", () => {
  it("arms nothing at mount, so a StrictMode double-mount sends no request", () => {
    const { saveDraft, validateDraft } = harness();

    // `StrictMode` really does mount, clean up and mount again here: that is the whole
    // reason the wrapper is on this case and not the others.
    const { unmount } = renderHook(
      () => useDraftAutosave({ draft: DRAFT, saveDraft, validateDraft }),
      { wrapper: StrictMode },
    );

    expect(saveDraft, "the simulated unmount has nothing to flush").not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(saveDraft, "and neither does the real one").not.toHaveBeenCalled();
  });

  it("submits an edit made inside the debounce window exactly once, on unmount", () => {
    const { saveDraft, validateDraft } = harness();

    const { rerender, result, unmount } = renderHook(
      ({ draft }: { draft: DraftForm }) => useDraftAutosave({ draft, saveDraft, validateDraft }),
      { initialProps: { draft: DRAFT } },
    );

    // What `mutate` does on both drafting screens: mark the visit dirty, then hand the
    // loop the next document. The loop arms its timer on the render that follows.
    act(() => {
      result.current.markDirty();
    });
    rerender({ draft: EDITED });

    // Strictly INSIDE the window. The request has not gone out, which is the state an
    // author is in when they press the rail one beat after typing.
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(saveDraft, "nothing has been sent yet").not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(saveDraft, "leaving the screen stores what was on it").toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0]?.[0], "and stores the edit, not the draft it replaced").toBe(
      EDITED,
    );

    // AT MOST ONCE, which is the other half. The timer and the cleanup hold the same
    // document, so a flush that did not claim the pending edit would send it twice - and
    // a duplicate PUT of a draft is not visible either, which is how it would survive.
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 4);
    });
    expect(saveDraft, "the cancelled timer does not send a second copy").toHaveBeenCalledTimes(1);
  });

  it("sends nothing at all for a screen nobody edited", () => {
    const { saveDraft, validateDraft } = harness();

    const { unmount } = renderHook(() =>
      useDraftAutosave({ draft: DRAFT, saveDraft, validateDraft }),
    );

    // Long past the debounce: an untouched screen has no timer to fire and nothing to
    // flush, so opening a form and closing it again stores nothing.
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 4);
    });
    act(() => {
      unmount();
    });

    expect(saveDraft, "an untouched draft is never stored back").not.toHaveBeenCalled();
    expect(validateDraft, "and never validated either").not.toHaveBeenCalled();
  });
});
