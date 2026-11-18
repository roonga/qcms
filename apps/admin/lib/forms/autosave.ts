"use client";

import { useEffect, useRef, useState } from "react";

import type { SaveDraftState, ValidateDraftState } from "./builder-state.ts";
import { unsaveableReason, type UnsaveableReason } from "./draft.ts";
import type { DraftForm, FormIssue } from "./types.ts";

// Both editing screens must share save ordering and teardown behavior; independent loops can diverge and lose drafts.

export const AUTOSAVE_DEBOUNCE_MS = 600;

export type BuilderStatus = "idle" | "validating" | "saved" | "saving" | "error";

export interface DraftAutosave {
  // Undefined means unchecked, never an empty successful verdict.
  readonly issues: readonly FormIssue[] | undefined;
  // Track advisories separately; they never increase the blocking issue count.
  readonly warnings: readonly FormIssue[];
  readonly status: BuilderStatus;

  readonly lastSavedAt: string | undefined;
  readonly saveError: string | undefined;

  readonly paused: UnsaveableReason | undefined;
  // Do not save until an edit is recorded: the first server-seeded document may not be stored at all.
  readonly markDirty: () => void;
  // Feed out-of-loop settings stores into the same strip so the screen retains one save statement.
  readonly markSavedAt: (instant: string) => void;
  /* Holds the loop in the turn the caller decides to hold it. The `hold` prop reaches the loop only
     through a render, by which time a timer armed before the decision has already fired. */
  readonly holdNow: () => void;
}

export function useDraftAutosave({
  draft,
  initialVerdict,
  hold,
  saveDraft,
  validateDraft,
  onSaved,
}: {
  readonly draft: DraftForm;
  /* Stops this screen saving at all, including the unmount flush, while the screen owes the user a
     decision about what is on it. */
  readonly hold?: boolean;
  // Seed only a real server verdict; an empty fallback would falsely claim publishability.
  readonly initialVerdict?: {
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
  };
  // Bind the action to the route form ID so client state cannot retarget saves.
  readonly saveDraft: (draft: DraftForm) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;

  readonly onSaved?: (saved: SaveDraftState) => void;
}): DraftAutosave {
  const [issues, setIssues] = useState<readonly FormIssue[] | undefined>(initialVerdict?.issues);
  const [warnings, setWarnings] = useState<readonly FormIssue[]>(initialVerdict?.warnings ?? []);
  const [status, setStatus] = useState<BuilderStatus>("idle");
  // Keep the raw instant for ordering saves; formatted minute precision cannot distinguish every save.
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const isDirty = useRef(false);

  // Retain the latest debounced edit so unmount cleanup can flush it before the timer runs.
  const pending = useRef<DraftForm | undefined>(undefined);

  // Keep action callbacks out of debounce dependencies: revalidation changes their identity and would trigger a perpetual save loop.
  const actions = useRef({ saveDraft, validateDraft, onSaved });
  actions.current = { saveDraft, validateDraft, onSaved };

  const paused = unsaveableReason(draft);

  const held = useRef(hold === true);
  held.current = hold === true;

  // The armed debounce timer, which a hold raised between arming and firing has to cancel.
  const armed = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isDirty.current || paused !== undefined || hold === true) return undefined;
    setStatus("saving");
    pending.current = draft;
    const timer = setTimeout(() => {
      armed.current = undefined;
      if (held.current) return;
      // Claim before sending so teardown cannot flush the same edit twice.
      pending.current = undefined;
      void (async () => {
        const saved = await actions.current.saveDraft(draft);
        if (saved.status === "error") {
          setSaveError(saved.message);
          setStatus("error");
          return;
        }
        actions.current.onSaved?.(saved);
        setIssues(saved.issues);
        setWarnings(saved.warnings);
        setSaveError(undefined);
        setLastSavedAt(new Date().toISOString());
        setStatus("validating");

        const validated = await actions.current.validateDraft(draft);
        if (validated.status === "error") {
          // Keep the store response verdict when refresh fails; replacing it with zero would fabricate an all-clear.
          setStatus("error");
          return;
        }
        setIssues(validated.issues);
        setWarnings(validated.warnings);
        setStatus("saved");
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    armed.current = timer;
    return () => {
      clearTimeout(timer);
      if (armed.current === timer) armed.current = undefined;
    };
  }, [draft, paused, hold]);

  // Flush the latest edit on unmount before clearing the debounce so route navigation cannot discard a pending save.
  useEffect(() => {
    return () => {
      const unsaved = pending.current;
      pending.current = undefined;
      if (unsaved === undefined || held.current) return;
      void actions.current.saveDraft(unsaved);
    };
  }, []);

  return {
    issues,
    warnings,
    status,
    lastSavedAt,
    saveError,
    paused,
    markDirty: () => {
      isDirty.current = true;
    },
    markSavedAt: setLastSavedAt,
    holdNow: () => {
      held.current = true;
      if (armed.current !== undefined) {
        clearTimeout(armed.current);
        armed.current = undefined;
      }
      // The edit this timer carried is what the caller is holding, so the unmount flush must not
      // find it either.
      pending.current = undefined;
    },
  };
}
