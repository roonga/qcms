"use client";

import { useEffect, useSyncExternalStore } from "react";

import { PANEL_PARAM, type QuestionPanel, type QuestionPanelId } from "./panels.ts";

/**
 * The seam between the question editor and the rail beside it (Code Owner, 2026-09-27).
 *
 * ## Why a store and not props
 *
 * `lib/settings-panel.ts` and `lib/forms/builder-bridge.ts` are this file's two models and
 * their docs are the long version of the reasoning; what follows is what is different here
 * rather than a third copy of it.
 *
 * The short version, because it is the same in all three: the rail is a parallel-route slot
 * (`app/(shell)/@rail/questions/[questionId]/`) so that it renders BESIDE the capped content
 * column rather than inside it, which makes it a different React tree from the editor. Nothing
 * renders both, so there is no component that could hold the selection and hand it down, and
 * the shell layout that renders both slots is shared by every screen in the app - putting a
 * question provider there would make every screen carry a context one of them uses. Two client
 * trees on one page import one instance of one module out of one bundle, so a module IS what
 * they genuinely share, and `useSyncExternalStore` is React's own answer for reading a value
 * that lives outside React.
 *
 * ## Two values cross this seam and they have different owners
 *
 * **The selection is this module's**, exactly as the Settings rail's is. It holds only what the
 * reader has CHOSEN, which is nothing until they press a row, and {@link useQuestionPanel}
 * falls back to the panel the ADDRESS names - which the server resolved and told both trees as
 * a prop (`panelFromParams`). If this module held a default too, the two would have to be kept
 * equal by hand, and a hydration mismatch is what "by hand" looks like when it slips.
 *
 * **The panels and the issue counts are the editor's**, exactly as the builder's steps are. The
 * rail's slot derives them on the server from the stored definition, which is what makes the
 * first paint correct, and the editor republishes them as the author types so a digest and a
 * badge follow the live document rather than the last save. Adding an option changes "8
 * options" to "9 options" in the rail without a round trip; setting a constraint makes the
 * Validation messages row appear.
 *
 * Nothing here mutates the document. The editor remains its single owner, which is R2's shape
 * applied inside the client.
 *
 * ## JavaScript is required here, because the admin requires it
 *
 * **The admin requires JavaScript (Code Owner, 2026-09-27)**, so a store that only a hydrated
 * client can read costs this screen nothing, and there is no scriptless fallback to write. The
 * no-script floor is the respondent portal's constraint and has never been this app's; on this
 * side `docs/admin-constraints.md` puts the POCs in charge of the design.
 *
 * ## `choose`, not `select`
 *
 * The same naming rule `lib/forms/builder-bridge.ts` records, and it is load-bearing rather
 * than a preference: `lib/server/r2-import-surface.test.ts` reads every source file in this app
 * and treats a call named `select`, `insert`, `update`, `delete` or `transaction` as evidence
 * of a database query, because the admin is a strict BFF and is forbidden one (R2, ADR-35).
 * Choosing a panel is not a query, but the tripwire cannot tell, and the right response to a
 * coarse security check is to stay clear of it rather than to carve an exemption into it.
 */

/**
 * The editor's `<form>` id, so a control outside that form can still submit it.
 *
 * Save sits in the screen's heading row now (Code Owner, 2026-09-28), which is outside the card
 * and therefore outside the form. The vendored `Button` takes `onPress` and forwards no `form`
 * attribute (ADR-22 keeps it byte-identical to upstream), so the button finds the form by this id
 * and calls `requestSubmit()` on it - which runs the browser's own validation and fires the
 * submit event React's form action is listening for, exactly as an in-form submit button would.
 */
export const QUESTION_FORM_ID = "qcms-question-editor";

/** What the editor publishes about its save, for the button that lives outside it. */
export interface QuestionSaveSnapshot {
  /** True while the action is in flight, so the button outside the form can disable itself. */
  readonly isPending: boolean;
}

/** What the editor publishes about its panels, or `undefined` while none is mounted. */
export interface QuestionPanelsSnapshot {
  /** The panels the live document has, already ordered, named and digested. */
  readonly panels: readonly QuestionPanel[];
  /** Issues per panel from the last refused save. An absent key carries none. */
  readonly issueCounts: ReadonlyMap<QuestionPanelId, number>;
}

/** The panel the reader has chosen, or `undefined` while the address's answer still stands. */
let chosen: QuestionPanelId | undefined;

/** The editor's live panels, or `undefined` when no editor is mounted. */
let published: QuestionPanelsSnapshot | undefined;

/** The editor's save state, or `undefined` when there is no editor or nothing to save. */
let save: QuestionSaveSnapshot | undefined;

/**
 * The subscribers, held as an immutable array that is replaced rather than mutated.
 *
 * A `Set` is the obvious shape and is deliberately not used, for the reason
 * `lib/settings-panel.ts` writes out at length: the R2 import tripwire named above reads a
 * call spelled `delete` as evidence of a database query, and a `Set` removal is spelled that
 * way. Replacing the array also removes the need to copy it before notifying, so a listener
 * that unsubscribes mid-notification cannot make the loop skip the next one.
 */
let listeners: readonly (() => void)[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

function getChosen(): QuestionPanelId | undefined {
  return chosen;
}

function getPublished(): QuestionPanelsSnapshot | undefined {
  return published;
}

function getSave(): QuestionSaveSnapshot | undefined {
  return save;
}

/** The server has neither a chosen panel nor a mounted editor, by construction. */
function getNothing(): undefined {
  return undefined;
}

/**
 * Show a panel: mark its rail row current, and put its fields in the column beside the rail.
 *
 * ## The address follows the choice
 *
 * So that a reload, a Back onto this URL, or a link an author pastes into a ticket lands on
 * the panel they were looking at. Written with `replaceState` rather than pushed, and rather
 * than routed:
 *
 * - **Not the router.** `router.replace` would re-render the screen from the server under a
 *   half-typed label, and the editor holds the document in state - the point of the parameter
 *   is that the SERVER can read it on a fresh load, not that changing it should cause one.
 * - **Replace rather than push**, so Back leaves this screen rather than walking a reader back
 *   through every panel they looked at. The panels are one screen's worth of one question, not
 *   five places they went.
 *
 * The rest of the address is carried through untouched, `?v=` included: a panel is a view of a
 * version, so losing the version while changing the panel would show another version's fields.
 */
export function chooseQuestionPanel(panel: QuestionPanelId): void {
  if (chosen !== panel) {
    chosen = panel;
    emit();
  }
  const url = new URL(window.location.href);
  url.searchParams.set(PANEL_PARAM, panel);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Forget the reader's choice, so the next question or version opens on the panel its own
 * address names.
 *
 * Module state outlives a route, which is the defect `resetSettingsPanel` exists for: without
 * this, opening a boolean question's Yes and no labels and then walking to a number question
 * would leave the rail marking a row that question does not have. The editor clears it as it
 * unmounts, and it is keyed by question and version, so switching either is a remount.
 */
export function resetQuestionPanel(): void {
  if (chosen === undefined) return;
  chosen = undefined;
  emit();
}

/**
 * The panel showing right now: the reader's choice, or the one the address opened with.
 *
 * Read by both trees, which is what keeps the rail's `aria-current` and the visible panel from
 * ever disagreeing - they are two renders of one value rather than two copies of it.
 */
export function useQuestionPanel(address: QuestionPanelId): QuestionPanelId {
  return useSyncExternalStore(subscribe, getChosen, getNothing) ?? address;
}

/**
 * Publish the editor's live panels and issue counts for the rail to render, or `undefined`
 * when it has none to offer.
 *
 * `undefined` is a real state rather than a placeholder, and the editor passes it on
 * `/questions/new`: that screen has no rail, shows every panel at once and switches nothing, so
 * there is nothing for a rail to be current on.
 *
 * Called through an effect, so the value the rail reads is the one the editor last committed
 * rather than one from a render React discarded. The cleanup clears it, which is what stops a
 * stale document being offered to the rail after the editor unmounts - the rail then falls back
 * to the panels its own slot resolved on the server, which is correct: there is no editor whose
 * unsaved digests it could be showing.
 */
export function usePublishQuestionPanels(next: QuestionPanelsSnapshot | undefined): void {
  useEffect(() => {
    published = next;
    emit();
    return () => {
      published = undefined;
      emit();
    };
  }, [next]);
}

/** The editor's live panels, or `undefined` when no editor is mounted. */
export function useQuestionPanels(): QuestionPanelsSnapshot | undefined {
  return useSyncExternalStore(subscribe, getPublished, getNothing);
}

/**
 * Publish the editor's save state for the button in the screen's heading row.
 *
 * `undefined` on a frozen version, which has nothing to save: the heading row then renders no
 * button and no model note, which is contract §6's read-only clause ("a screen with nothing to
 * save says nothing") rather than a disabled control.
 */
export function usePublishQuestionSave(next: QuestionSaveSnapshot | undefined): void {
  useEffect(() => {
    save = next;
    emit();
    return () => {
      save = undefined;
      emit();
    };
  }, [next]);
}

/** The editor's save state, or `undefined` when no editor is mounted or nothing can be saved. */
export function useQuestionSave(): QuestionSaveSnapshot | undefined {
  return useSyncExternalStore(subscribe, getSave, getNothing);
}
