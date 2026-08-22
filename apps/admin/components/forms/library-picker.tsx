"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Dialog, TextField } from "@/components/kit";
import {
  choose,
  chosenDetail,
  pinnableRows,
  rowId,
  unchoose,
  withChoices,
  type ChoiceRow,
} from "@/lib/forms/picker-selection";
import type { DraftForm, DraftPin, PinnableQuestion } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

/**
 * The add-a-question dialog (task 033; wireframe "library picker `dialog`").
 *
 * ## One row per **version**, not per question
 *
 * A pin names a frozen version, so the thing an author is choosing is a version and the
 * list has to be a list of them. A question-level picker would have to guess which version
 * the author meant, and the only defensible guess is "the newest", which is precisely the
 * auto-upgrade behaviour R7 rules out. Picking the row picks the pin.
 *
 * ## A PICKER IS NOT A NAVIGATOR, so no row here is an anchor (issue 570)
 *
 * `plan/admin-design-contracts.md` §2 retires whole-row `onRowAction` in favour of "a real
 * anchor in the row's identifying cell", and the other three tables issue 570 converts take
 * that literally, because activating one of their rows means going to an address. This one
 * does not have an address to give. Choosing a row here **stages a pin for the draft the
 * author is already editing**. There is no URL that means "having chosen q_x at v2", and an
 * `href` invented to satisfy the pattern would be a link that lies - middle-clicking it
 * would open a tab that does not do what the row says.
 *
 * That reasoning is untouched by multi-select and is not restated here. What multi-select
 * changes is what the row control DOES, not whether it is a link: issue 570 asked "button
 * or anchor" of a control that committed on the spot, and the answer stands for the control
 * that commits, which is now the dialog's one primary button.
 *
 * ## THE ROW CONTROL IS A CHECKBOX, and the POC drew it that way (issue 660)
 *
 * `plan/admin-shell-poc/add-question-poc.html` holds two dialogs behind a variant toggle,
 * and its multi-select one draws a native checkbox per row - `accent-color`, an
 * `aria-label` naming the row, no visible label text beside it. `docs/admin-constraints.md`
 * makes that drawing the design.
 *
 * It is also the honest control. A checkbox announces its own state, which is the fact a
 * multi-select author needs on every row and which a button cannot carry: "checked" is
 * information a press has no way to report. Space toggles it, Tab reaches it, and the
 * `aria-label` carries `forms.picker.addNamed` - the same named string issue 570 put on the
 * per-row button, kept for the same reason, so a screen-reader author still hears which row
 * they are on rather than "checkbox" repeated thirty times.
 *
 * **Why a native `<input type="checkbox">` and not the kit's `Checkbox`.** The kit control
 * takes `label?: string` and renders it as visible text inside the control, with no
 * accessible-name-only path and no `aria-label` prop. It therefore cannot express the
 * control the POC drew: the choice it offers is a wall of "Add q_x version 3" text down
 * every row, or a checkbox that announces nothing. Widening the vendored component is a
 * `docs/COMPONENT_GUIDELINES.md` change to a published package and is not this issue's.
 * ADR-22's single-stack rule is about a second design language accumulating outside
 * `packages/ui`; a bare checkbox wearing `accent-color: var(--color-primary)` is not a
 * design language, it is the platform control the POC drew. The precedent is this same
 * table: it is hand-authored markup rather than the kit `Table`, for the same kind of
 * reason (issue 570).
 *
 * The checkbox column LEADS the row rather than trailing it, which is where the POC puts
 * it and is the ordinary place for a selection column. §2's trailing-actions clause governs
 * actions taken on a row; a selection checkbox does not act on its row, it states whether
 * the row is in a set the footer will act on.
 *
 * ## Choosing is not committing, and the count says what the commit will do
 *
 * Selection is client state in this dialog and nothing leaves it until the footer's primary
 * button is pressed. That button's label carries the count - "Add 3 questions to step" -
 * which is the POC's own label and the reason it matters: a dialog states what it is about
 * to do before it does it. The label goes through `tPlural` (ADR-27) rather than a number
 * concatenated onto a noun, and zero has its own message because "Add 0 questions to step"
 * is a sentence, not a plural form.
 *
 * **This is not the "bulk operation" the builder refuses.** `lib/forms/draft.ts` declines
 * to offer "move every pin of this question to v3" and cites R7, and the thing it is
 * refusing is one click that changes SEVERAL FORMS' meaning at once, over pins the author
 * never named. Adding three pins here is three ordinary adds, in one step of one form,
 * each ticked by hand and each listed by name in the pane before the button is pressed.
 * R7 itself is the launch cut-line - impact analysis, `/api/v1`, a second locale,
 * multi-tenancy, a visual rule builder - and names none of this.
 *
 * The chosen pane beside the table is what keeps the set visible while the author keeps
 * searching. It is not decoration: **a search that filters a chosen row out of the table
 * does not unchoose it**, so without the pane a choice could be invisible at the moment it
 * is committed. Each entry names the pin it will create (`q_x@3`) and carries its own
 * remove control, so the pane is also the way back out of a choice whose row is no longer
 * on screen.
 *
 * ## One pin per question, enforced while choosing rather than at the commit
 *
 * The kernel refuses a second pin of the same question (`DUPLICATE_QUESTION_IN_FORM`), and
 * one row per version means an author could otherwise tick `q_x@2` and `q_x@3` together and
 * learn at the commit that only one of them landed. So choosing a version **withdraws the
 * checkbox from its sibling versions** for as long as that choice stands, and their State
 * cell says which version is holding the place. That is the same shape as the refusals
 * below: no control, and the reason in words in the row.
 *
 * ## What is listed, and what is refused
 *
 * Published versions can be pinned. Deprecated versions are **listed with no control**,
 * which is 022's rule made visible: they are not gone (a form already pinned to one keeps
 * working, R6), they simply cannot be chosen for a *new* pin, and an author who cannot see
 * that a version exists at all will assume the library lost it. A question already in this
 * form is refused for the same reason the kernel refuses it, `DUPLICATE_QUESTION_IN_FORM`,
 * rather than letting an author add a row and then reading an error about the row they just
 * created (004's refinement).
 *
 * A row that cannot be pinned renders **no control at all**, rather than a disabled one.
 * That is a change from the `disabledKeys` the kit table took, and it is the better of the
 * two: a disabled control is not reachable by keyboard and announces no reason, so it offers
 * a keyboard author nothing but an obstacle, while the State cell beside it says "Deprecated"
 * or "Already in this form" in words that every reader of the row gets. Multi-select keeps
 * that rule exactly and adds one case to it (sibling versions of a chosen question, above);
 * note that the POC's own multi variant draws a DISABLED checkbox on its unchoosable row,
 * and this is the one place the shipped picker knowingly departs from the drawing, because
 * the rule it would be breaking is older than the drawing and was argued on this screen.
 *
 * Draft versions never appear: they can still change, and a pin to something that can
 * change is not a pin.
 *
 * ## Which columns drop at compact width (§2)
 *
 * Type only. Question ID and Label identify a row, Version never drops
 * (`plan/admin-mobile-stance.md`, item 5), State is the reason a row can or cannot be
 * chosen, and the checkbox column is the point of the screen. Type is the only column left
 * that merely describes. No `min-inline-size` is declared here, so there is none to reset
 * at the boundary.
 *
 * ## A library that did not load has no rows and no empty state (issues 572, 544)
 *
 * `library` is a `ReadState` (`lib/read-state.ts`). Handed `ok ? data : []` it used to
 * show §3's FILTERED panel - "No published question version matches this search." - for a
 * read that never happened, under a search box the author had not typed in. The sentence
 * blames the search for the library's absence, and the author's next move is to try a
 * different search, which cannot work.
 *
 * A failed read renders the failure and the way out of the dialog, and drops everything
 * that would describe a library nobody read: the search field (a filter over nothing), the
 * table, the empty panel, and the hint that tells the author to choose a row. The alert is
 * repeated INSIDE the dialog rather than left to the page, for the reason
 * `secure-links.tsx` gives its revoke dialog: a modal covers the page's alert region, so a
 * failure written only there is a failure the operator cannot see.
 *
 * The step editor still offers "Add question" while the library is unread, and that is
 * deliberate. It is a working control that opens a dialog which now says why it cannot
 * help yet, which is better than a control that has silently gone missing.
 */
export function LibraryPicker({
  isOpen,
  stepTitle,
  draft,
  library,
  onAddPins,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly stepTitle: string;
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /**
   * One call carrying every chosen pin, in the order they were chosen, which is the order
   * they land in the step.
   *
   * A list rather than N calls to a single-pin handler, and that is a correctness
   * requirement rather than a tidiness one. The builder's handler folds the new pin into
   * the draft it closed over, so N calls in a row would each compute from the SAME stale
   * draft and only the last one would survive.
   */
  readonly onAddPins: (pins: readonly DraftPin[]) => void;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  // Insertion-ordered, because the order the author ticked the boxes is the order the pins
  // are inserted into the step. Nothing else here has a claim to that order: list order is
  // the library's, and the library's order is not a statement about this form.
  const [chosen, setChosen] = useState<readonly DraftPin[]>([]);
  /** The index whose entry has just been removed, or nothing. See `drop` below. */
  const [focusWant, setFocusWant] = useState<number | undefined>(undefined);

  const catalogue = library.ok ? library.data : [];
  const candidates = library.ok ? withChoices(pinnableRows(catalogue, draft, search), chosen) : [];
  const chosenRows = chosenDetail(catalogue, chosen);

  function toggle(row: ChoiceRow, next: boolean): void {
    setChosen((current) =>
      next
        ? choose(current, { questionId: row.questionId, version: row.version })
        : unchoose(current, row.questionId),
    );
  }

  /**
   * Remove the chosen entry at `at`, and say where focus should land afterwards.
   *
   * FOCUS IS THE WHOLE REASON THIS TAKES AN INDEX. The control that removes an entry is
   * inside the entry, so pressing it destroys the element holding focus, and a keyboard
   * author is left on `document.body` with the dialog no longer hearing Escape. That is
   * the same defect `step-editor.tsx` handles with `setFocusWant` after a pin is removed,
   * and this is the same answer: the next entry's remove control, or - when that was the
   * last entry - the search field, which is the control an author reaches for next and
   * the only one guaranteed to exist for as long as this pane does.
   */
  function drop(questionId: string, at: number): void {
    setChosen((current) => unchoose(current, questionId));
    setFocusWant(at);
  }

  useEffect(() => {
    if (focusWant === undefined) return;
    setFocusWant(undefined);
    const pane = document.getElementById(CHOSEN_PANE_ID);
    if (pane === null) return;
    const remaining = pane.querySelectorAll<HTMLElement>("button.qcms-picker__unchoose");
    const next = remaining[Math.min(focusWant, remaining.length - 1)];
    if (next !== undefined) {
      next.focus();
      return;
    }
    // The list is empty, so focus leaves the pane. Queried from the dialog rather than
    // held in a ref: the search box is a kit component and does not forward one.
    pane.closest('[role="dialog"]')?.querySelector("input")?.focus();
  }, [focusWant]);

  function dismiss(): void {
    setChosen([]);
    setSearch("");
    onClose();
  }

  function commit(): void {
    // `chosenRows`, not `chosen`: what the pane showed is what gets added. The two differ
    // only for a pin whose question has left the library since the read, and adding one of
    // those would put a pin in the draft that the author never saw named.
    onAddPins(chosenRows.map((row) => ({ questionId: row.questionId, version: row.version })));
    dismiss();
  }

  return (
    <Dialog
      isOpen={isOpen}
      title={t("forms.picker.title", { title: stepTitle })}
      description={t("forms.picker.description")}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <div className="flex flex-col gap-4">
        {!library.ok && <Alert variant="error">{t("forms.picker.loadFailed")}</Alert>}

        {library.ok && (
          <TextField label={t("forms.picker.search")} value={search} onChange={setSearch} />
        )}

        {/* A search that matched nothing, so this is `plan/admin-design-contracts.md`
            §3's FILTERED variant: the panel and its heading, no explanatory sentence,
            and no CTA - the action that clears this filter is the search field two
            elements up, already focused and already holding the text to delete. */}
        {library.ok &&
          (candidates.length === 0 ? (
            <EmptyState heading={t("forms.picker.empty")} testId="qcms-picker-empty" />
          ) : (
            <div className="qcms-table qcms-table--picker">
              <table data-testid="qcms-picker-table">
                <caption className="qcms-visually-hidden">{t("forms.picker.tableLabel")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="qcms-picker__choose">
                      <span className="qcms-visually-hidden">
                        {t("forms.picker.column.choose")}
                      </span>
                    </th>
                    <th scope="col">{t("forms.picker.column.questionId")}</th>
                    <th scope="col">{t("forms.picker.column.label")}</th>
                    <th scope="col" className="qcms-cell--drop">
                      {t("forms.picker.column.type")}
                    </th>
                    <th scope="col" className="qcms-cell--num">
                      {t("forms.picker.column.version")}
                    </th>
                    <th scope="col">{t("forms.picker.column.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((row) => (
                    <tr
                      key={rowId(row.questionId, row.version)}
                      data-picker-question={row.questionId}
                      data-picker-version={row.version}
                      data-picker-chosen={row.checked ? "" : undefined}
                    >
                      <td className="qcms-picker__choose">
                        {row.choosable && (
                          <input
                            type="checkbox"
                            className="qcms-picker__checkbox"
                            checked={row.checked}
                            aria-label={t("forms.picker.addNamed", {
                              questionId: row.questionId,
                              version: row.version,
                            })}
                            onChange={(event) => {
                              toggle(row, event.target.checked);
                            }}
                          />
                        )}
                      </td>
                      <th scope="row">
                        <code className="qcms-link-id">{row.questionId}</code>
                      </th>
                      <td>{row.label}</td>
                      <td className="qcms-cell--drop">{row.type}</td>
                      <td className="qcms-cell--num">
                        {t("forms.version.value", { version: row.version })}
                      </td>
                      <td>{row.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {/* The chosen set, kept on screen while the author keeps searching. It renders
            whenever the library read succeeded, empty set included: a pane that appears
            only once something is in it is a pane nobody knows to expect, and its empty
            sentence is what tells a first-time author that ticking is how this works. */}
        {library.ok && (
          <section
            className="qcms-picker__chosen"
            data-testid="qcms-picker-chosen"
            id={CHOSEN_PANE_ID}
          >
            {/* Polite, and on the heading alone rather than the whole pane: the running
                tally is the fact that changed, and a live region wrapped around the list
                would re-read every entry on every tick. */}
            <h3 aria-live="polite" className="text-sm font-semibold" id={CHOSEN_HEADING_ID}>
              {t("forms.picker.chosenHeading", { count: chosenRows.length })}
            </h3>
            {chosenRows.length === 0 ? (
              <p className="text-sm text-(--color-text-muted)">{t("forms.picker.chosenEmpty")}</p>
            ) : (
              <ul aria-labelledby={CHOSEN_HEADING_ID} className="qcms-picker__chosen-list">
                {chosenRows.map((row, at) => (
                  <li key={rowId(row.questionId, row.version)} data-chosen-pin={row.questionId}>
                    <span className="qcms-picker__chosen-main">
                      <code className="qcms-link-id">{rowId(row.questionId, row.version)}</code>
                      <span className="text-xs text-(--color-text-muted)">{row.label}</span>
                    </span>
                    <button
                      type="button"
                      className="qcms-picker__unchoose"
                      onClick={() => {
                        drop(row.questionId, at);
                      }}
                    >
                      <span className="qcms-visually-hidden">
                        {t("forms.picker.removeNamed", {
                          questionId: row.questionId,
                          version: row.version,
                        })}
                      </span>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {library.ok && (
          <p className="text-sm text-(--color-text-muted)">{t("forms.picker.hint")}</p>
        )}
        <div className="qcms-picker__footer">
          <Button variant="ghost" size="md" onPress={dismiss}>
            {t("forms.picker.cancel")}
          </Button>
          {/* Disabled at zero rather than hidden. A primary that comes and goes leaves the
              footer with nothing to say about what this dialog is for, and unlike the
              per-row case the reason is right beside it: the pane above reads "Chosen (0)".
              The label is not the "other" plural with a zero in it - see the catalogue. */}
          {library.ok && (
            <Button
              variant="primary"
              size="md"
              isDisabled={chosenRows.length === 0}
              onPress={commit}
            >
              {chosenRows.length === 0
                ? t("forms.picker.commitNone")
                : tPlural(
                    "forms.picker.commit.one",
                    "forms.picker.commit.other",
                    chosenRows.length,
                  )}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** The chosen pane's heading, which also names its list. */
const CHOSEN_HEADING_ID = "qcms-picker-chosen-heading";

/** The pane itself, so the focus effect can find what is left of its remove controls. */
const CHOSEN_PANE_ID = "qcms-picker-chosen-pane";
