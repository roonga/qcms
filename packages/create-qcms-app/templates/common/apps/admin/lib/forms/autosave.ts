"use client";

import { useEffect, useRef, useState } from "react";

import type { SaveDraftState, ValidateDraftState } from "./builder-state.ts";
import { unsaveableReason, type UnsaveableReason } from "./draft.ts";
import type { DraftForm, FormIssue } from "./types.ts";

/**
 * The draft's save loop, owned once and used by both screens that edit a draft.
 *
 * ## Why this is a module rather than a paragraph inside the builder
 *
 * Issue #669 gave rule editing a route of its own, so `apps/admin` has TWO screens holding
 * an accumulated working draft: `/forms/{formId}` and `/forms/{formId}/rules`. Both store
 * the same document through the same two server actions, and a second copy of this effect
 * beside the first would be two save models wearing one name - the same failure
 * `plan/admin-design-contracts.md` §6 spent two amendments closing inside the builder,
 * reopened one route along. `lib/save-model.test.ts` is what holds that shut: the debounce
 * is declared here and nowhere else, and both screens are required to reach it through
 * this hook.
 *
 * ## Autosave is advisory (task 022)
 *
 * A draft with issues saves perfectly well and comes back with the list of what would block
 * a publish, so a panel showing twelve issues beside "Saved 12:03" is the normal case rather
 * than a contradiction. Two states cannot be saved at all, because `FormDefinition` requires
 * at least one step and at least one pin per step: those PAUSE the loop and say why, instead
 * of throwing a red error every few seconds while the first step is being built.
 *
 * ## Why the round trip is two calls
 *
 * `PUT .../draft` stores and returns issues; `POST .../draft/validate` re-runs the same
 * compile without storing. Both run on one debounce because they answer different questions
 * and the second is the one that matters for rules: the kernel's `analyzeRuleGraph` runs
 * inside that compile, so `RULE_BACKWARD_TARGET` and `RULE_CYCLE` arrive from the engine
 * rather than from a second implementation of the analysis in this app (there could not be
 * one - the admin takes no `@roonga/qcms-core` value import, R2).
 *
 * ## Two failure paths, and neither of them fabricates an all-clear
 *
 * A failed store leaves the verdict exactly as it was, which on a first save means still
 * ABSENT. A failed validate keeps whatever the store leg just returned. In both cases the
 * empty issue list a failed read supplies is discarded rather than written, because writing
 * it would turn a transport failure into "No issues. Everything here would pass a publish."
 * one layer below the panel that says it (issue 625).
 */

/** How long a screen waits after the last keystroke before it talks to the API. */
export const AUTOSAVE_DEBOUNCE_MS = 600;

/** What a screen editing a draft is doing right now, as far as issues are concerned. */
export type BuilderStatus = "idle" | "validating" | "saved" | "saving" | "error";

/** Everything the loop knows, which is everything a save statement or an issue list reads. */
export interface DraftAutosave {
  /** The verdict, or `undefined` while nothing has checked this draft. Never a stand-in for zero. */
  readonly issues: readonly FormIssue[] | undefined;
  /** Non-blocking advisories (issue #123). Tracked with the issues, never counted into them. */
  readonly warnings: readonly FormIssue[];
  readonly status: BuilderStatus;
  /** An ISO instant, or `undefined` before anything has been stored this visit. */
  readonly lastSavedAt: string | undefined;
  readonly saveError: string | undefined;
  /** Why the loop is paused, or `undefined` when it is not. */
  readonly paused: UnsaveableReason | undefined;
  /**
   * Record an edit. Nothing is sent until a screen calls this at least once, which is what
   * stops a first render posting a `seeded` draft back that nobody edited.
   */
  readonly markDirty: () => void;
  /**
   * Record a store this screen made OUTSIDE the draft loop, so the one save statement on
   * the screen covers it (§6). The builder's settings are the only caller: they are not
   * part of the draft and go to a route of their own, and they still feed the same strip.
   */
  readonly markSavedAt: (instant: string) => void;
}

export function useDraftAutosave({
  draft,
  initialVerdict,
  saveDraft,
  validateDraft,
  onSaved,
}: {
  readonly draft: DraftForm;
  /**
   * A verdict the SERVER already computed for the stored draft, or `undefined` when the
   * screen opens knowing nothing.
   *
   * Seeded rather than defaulted, and the difference is issue 625's. An empty issue list is
   * an assertion that a draft would publish; this is only ever a real verdict a caller was
   * handed, and a caller with no verdict passes nothing rather than `[]`. A screen that is
   * the destination of an issue link needs one (`lib/server/form-verdict.ts` says why the
   * rules route is and the builder is not); the client's own loop refreshes it on the first
   * save either way.
   */
  readonly initialVerdict?: {
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
  };
  /**
   * Store the draft. The screen binds the server action to its own route's form id, so a
   * client cannot aim a save at a form other than the one it is standing on.
   *
   * A screen with extra facts to send (task 041's agent-assisted marker, and the new
   * question definitions riding with an accepted proposal) reads them off its own refs
   * inside this callback. It is held in a ref below, so a fresh identity per render costs
   * nothing and the effect's inputs stay what they actually are.
   */
  readonly saveDraft: (draft: DraftForm) => Promise<SaveDraftState>;
  readonly validateDraft: (draft: DraftForm) => Promise<ValidateDraftState>;
  /** Called once per SUCCESSFUL store, with what the API said. */
  readonly onSaved?: (saved: SaveDraftState) => void;
}): DraftAutosave {
  const [issues, setIssues] = useState<readonly FormIssue[] | undefined>(initialVerdict?.issues);
  const [warnings, setWarnings] = useState<readonly FormIssue[]>(initialVerdict?.warnings ?? []);
  const [status, setStatus] = useState<BuilderStatus>("idle");
  // An ISO instant, not a formatted clock time. The strip renders it through the app's one
  // timestamp formatter (`plan/admin-design-contracts.md` §2: date, HH:MM, zone, no
  // seconds) and exposes the raw instant as `data-saved-at`, so the sentence a person hears
  // can be low-churn while a test can still tell two saves apart. Issue 518.
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const isDirty = useRef(false);

  // THE EDIT THE DEBOUNCE IS STILL HOLDING, or `undefined` when nothing is waiting.
  //
  // Armed when the effect below sets its timer and cleared the moment that timer fires, so
  // it names exactly the window in which an edit exists on screen and nowhere else. What
  // reads it is the unmount flush further down; see there for why the window matters more
  // than it used to.
  const pending = useRef<DraftForm | undefined>(undefined);

  // The actions live in a ref, and that is not a style choice. They arrive already bound to
  // a route's form id, so the page hands down a NEW function identity on every server
  // render - and a successful save calls `revalidatePath`, which causes one. An effect that
  // depended on them would therefore re-arm its debounce because it had just saved, save
  // again, revalidate again, and never stop.
  const actions = useRef({ saveDraft, validateDraft, onSaved });
  actions.current = { saveDraft, validateDraft, onSaved };

  const paused = unsaveableReason(draft);

  useEffect(() => {
    if (!isDirty.current || paused !== undefined) return undefined;
    setStatus("saving");
    pending.current = draft;
    const timer = setTimeout(() => {
      // Claimed before the request goes out, so the flush below cannot send a second copy
      // of an edit this leg is already sending.
      pending.current = undefined;
      void (async () => {
        const saved = await actions.current.saveDraft(draft);
        if (saved.status === "error") {
          // The verdict is left exactly as it was, which on a first save means still
          // absent. `saved.issues` is the empty list a failed read supplies, and writing
          // it here would turn a store failure into a fabricated all-clear one layer
          // below the panel - the same trap the validate leg avoids below (issue 625).
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
        // The second round trip is the one the screen contract calls live validation. It
        // does not store, and it is where `RULE_BACKWARD_TARGET` and `RULE_CYCLE` come
        // from: the kernel's `analyzeRuleGraph` runs inside the same compile.
        const validated = await actions.current.validateDraft(draft);
        if (validated.status === "error") {
          // Keep whatever the store leg just returned rather than overwriting it with the
          // empty list a failed read supplies. `PUT .../draft` returns issues too, so the
          // number on screen is a real one computed moments ago; replacing it with zero
          // would turn a refresh failure into a fabricated all-clear. The panel says the
          // count could not be refreshed, which is only honest if there is still a count.
          setStatus("error");
          return;
        }
        setIssues(validated.issues);
        setWarnings(validated.warnings);
        setStatus("saved");
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, paused]);

  // LEAVING THE SCREEN STORES WHAT IS ON IT (issue #669).
  //
  // An unmount clears the debounce above, which used to mean an edit made inside the last
  // 600ms was simply gone - no request, no error, nothing on screen to say so. That was
  // always true of this app and was rarely reached, because leaving the builder meant going
  // to Preview or Links: screens an author visits deliberately, having stopped typing.
  //
  // Splitting rule editing onto its own route made it ordinary. Pin a question and press
  // Rules, save a rule and press the form's row, and the crossing happens exactly when a
  // hand is still moving. The ruling behind that split says no behaviour may disappear
  // silently in the move, and an edit that vanishes because the reader navigated is the
  // plainest reading of that.
  //
  // Fire-and-forget, and mount-scoped rather than hung off the debounce effect: that one
  // re-runs on every draft change, so its cleanup fires on every keystroke and would send
  // one request per character. This cleanup runs once, when the screen actually goes away.
  // React's StrictMode double-mount is harmless here - nothing is armed at mount, so the
  // simulated unmount finds `pending.current` empty and sends nothing.
  //
  // WHAT IT DOES NOT PROMISE: the destination's own read may still overtake this request,
  // so a reader can land on a screen that has not seen the edit yet. It is a guarantee that
  // the work is STORED, not that the next screen shows it - which is why the browser walks
  // still wait for the save before they cross a route boundary.
  useEffect(() => {
    return () => {
      const unsaved = pending.current;
      pending.current = undefined;
      if (unsaved === undefined) return;
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
  };
}
