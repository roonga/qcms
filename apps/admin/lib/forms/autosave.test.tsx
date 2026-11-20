import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_DEBOUNCE_MS, useDraftAutosave } from "./autosave.ts";
import type { SaveDraftState, ValidateDraftState } from "./builder-state.ts";
import type { DraftForm } from "./types.ts";

// Browser journeys wait for each save before navigation, so they cannot exercise an edit abandoned inside debounce.
// Unmount this harness while a save is pending to observe the otherwise invisible missing request.

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

const EDITED: DraftForm = { ...DRAFT, title: { en: "Life insurance, renamed" } };

function saved(): SaveDraftState {
  return { status: "saved", issues: [], warnings: [] };
}

function validated(): ValidateDraftState {
  return { status: "ok", valid: true, issues: [], warnings: [] };
}

// Hold the debounce clock so unmount provably occurs before its timer rather than racing real time.
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

    act(() => {
      result.current.markDirty();
    });
    rerender({ draft: EDITED });

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

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 4);
    });
    expect(saveDraft, "the cancelled timer does not send a second copy").toHaveBeenCalledTimes(1);
  });

  it("flushes nothing while the screen holds its saves", () => {
    const { saveDraft, validateDraft } = harness();

    const { rerender, result, unmount } = renderHook(
      ({ draft, hold }: { draft: DraftForm; hold: boolean }) =>
        useDraftAutosave({ draft, hold, saveDraft, validateDraft }),
      { initialProps: { draft: DRAFT, hold: false } },
    );

    act(() => {
      result.current.markDirty();
    });
    rerender({ draft: EDITED, hold: false });
    rerender({ draft: EDITED, hold: true });

    act(() => {
      unmount();
    });

    expect(saveDraft, "the held screen stores nothing on the way out").not.toHaveBeenCalled();
  });

  it("cancels an armed timer and the flush with it when the hold is raised in the same turn", () => {
    const { saveDraft, validateDraft } = harness();

    const { rerender, result, unmount } = renderHook(
      ({ draft }: { draft: DraftForm }) => useDraftAutosave({ draft, saveDraft, validateDraft }),
      { initialProps: { draft: DRAFT } },
    );

    act(() => {
      result.current.markDirty();
    });
    rerender({ draft: EDITED });

    // No render between the hold and the timer: this is the order a refusal arrives in.
    result.current.holdNow();

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 4);
    });
    expect(saveDraft, "the armed timer sends nothing").not.toHaveBeenCalled();

    act(() => {
      unmount();
    });
    expect(saveDraft, "and the flush finds nothing to send").not.toHaveBeenCalled();
  });

  it("sends nothing at all for a screen nobody edited", () => {
    const { saveDraft, validateDraft } = harness();

    const { unmount } = renderHook(() =>
      useDraftAutosave({ draft: DRAFT, saveDraft, validateDraft }),
    );

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
