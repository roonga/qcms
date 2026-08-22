"use client";

import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Dialog, TextField } from "@/components/kit";
import { isPinned } from "@/lib/forms/draft";
import type { DraftForm, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
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
 * ## A PICKER IS NOT A NAVIGATOR, so this row gets a button and not an anchor (issue 570)
 *
 * `plan/admin-design-contracts.md` §2 retires whole-row `onRowAction` in favour of "a real
 * anchor in the row's identifying cell", and the other three tables issue 570 converts take
 * that literally, because activating one of their rows means going to an address. This one
 * does not have an address to give. Choosing a row here **adds a pin to the draft the
 * author is already editing**: it changes the page they are on and closes the dialog they
 * are in. There is no URL that means "having added q_x at v2", and an `href` invented to
 * satisfy the pattern would be a link that lies - middle-clicking it would open a tab that
 * does not do what the row says, which is worse than the whole-row click it replaced.
 *
 * So the decision is a **`<button>` per choosable row**, in a trailing action column, and it
 * is made against §2's own reasons for wanting anchors rather than against its wording:
 *
 *  - **A real, announced control.** A button announces as a button, which is the truth: a
 *    thing that acts here. The row is no longer a control that only a mouse understands.
 *  - **Keyboard operability.** Tab reaches it and both Enter and Space activate it, where
 *    an anchor takes Enter only.
 *  - **The name carries the row.** `forms.picker.addNamed` names the question and the
 *    version, so the control does not announce as "Add" thirty times down a column - the
 *    same requirement §2's amendment puts on a copy control's accessible name.
 *  - **No-JS is not on the table for this surface and never was.** This is a modal dialog
 *    inside the builder, opened by a scripted control, over a draft held in client state.
 *    Nothing here survives scripting being switched off, which is exactly why the anchor
 *    clause's other reason does not reach it.
 *
 * §2's trailing-actions clause is what governs the placement: "Rows with an author-controlled
 * order get the grip menu; rows without one get a plain trailing menu or inline actions,
 * never a grip." A picker's rows have no author-controlled order, so this is an inline
 * action. Keeping the control out of the identifying cell also leaves that cell free for the
 * prefix-plus-copy treatment §2's amendment asks of identifying columns, which is issue 582.
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
 * A row that cannot be pinned renders **no button at all**, rather than a disabled one.
 * That is a change from the `disabledKeys` the kit table took, and it is the better of the
 * two: a disabled button is not reachable by keyboard and announces no reason, so it offers
 * a keyboard author nothing but an obstacle, while the State cell beside it says "Deprecated"
 * or "Already in this form" in words that every reader of the row gets.
 *
 * Draft versions never appear: they can still change, and a pin to something that can
 * change is not a pin.
 *
 * ## Which columns drop at compact width (§2)
 *
 * Type only. Question ID and Label identify a row, Version never drops
 * (`plan/admin-mobile-stance.md`, item 5), State is the reason a row can or cannot be
 * chosen, and the action column is the point of the screen. Type is the only column left
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
  onPin,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly stepTitle: string;
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly onPin: (questionId: string, version: number) => void;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const candidates = library.ok ? pinnableRows(library.data, draft, search) : [];

  return (
    <Dialog
      isOpen={isOpen}
      title={t("forms.picker.title", { title: stepTitle })}
      description={t("forms.picker.description")}
      onOpenChange={(open) => {
        if (!open) onClose();
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
                <caption className="qcms-visually-hidden">
                  {t("forms.picker.tableLabel")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("forms.picker.column.questionId")}</th>
                    <th scope="col">{t("forms.picker.column.label")}</th>
                    <th scope="col" className="qcms-cell--drop">
                      {t("forms.picker.column.type")}
                    </th>
                    <th scope="col" className="qcms-cell--num">
                      {t("forms.picker.column.version")}
                    </th>
                    <th scope="col">{t("forms.picker.column.state")}</th>
                    <th scope="col">
                      <span className="qcms-visually-hidden">
                        {t("forms.picker.column.action")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((row) => (
                    <tr
                      key={rowId(row.questionId, row.version)}
                      data-picker-question={row.questionId}
                      data-picker-version={row.version}
                    >
                      <th scope="row">
                        <code className="qcms-link-id">{row.questionId}</code>
                      </th>
                      <td>{row.label}</td>
                      <td className="qcms-cell--drop">{row.type}</td>
                      <td className="qcms-cell--num">
                        {t("forms.version.value", { version: row.version })}
                      </td>
                      <td>{row.state}</td>
                      <td>
                        {row.pinnable && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onPress={() => {
                              onPin(row.questionId, row.version);
                              onClose();
                            }}
                          >
                            <span className="qcms-visually-hidden">
                              {t("forms.picker.addNamed", {
                                questionId: row.questionId,
                                version: row.version,
                              })}
                            </span>
                            <span aria-hidden="true">{t("forms.picker.add")}</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {library.ok && (
          <p className="text-sm text-(--color-text-muted)">{t("forms.picker.hint")}</p>
        )}
        <div>
          <Button variant="ghost" size="md" onPress={onClose}>
            {t("forms.picker.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** `questionId@version`: the pin a row would create, and so its identity in the list. */
function rowId(questionId: string, version: number): string {
  return `${questionId}@${String(version)}`;
}

/** Whether a question matches the free-text box, over the id, slug and label. */
function matches(question: PinnableQuestion, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = `${question.questionId} ${question.slug} ${textOf(question.label ?? undefined)}`;
  return haystack.toLowerCase().includes(needle);
}

/** One listed version, with whether this form may pin it. */
interface PickerRow {
  readonly questionId: string;
  readonly label: string;
  readonly type: string;
  readonly version: number;
  readonly state: string;
  readonly pinnable: boolean;
}

/** The version rows, with the ones this form cannot pin marked as such. */
function pinnableRows(
  library: readonly PinnableQuestion[],
  draft: DraftForm,
  search: string,
): PickerRow[] {
  const rows: PickerRow[] = [];

  for (const question of library) {
    if (!matches(question, search)) continue;
    const already = isPinned(draft, question.questionId);
    for (const version of question.versions) {
      // A draft version is not pinnable and never will be as it stands, so it is not
      // listed at all: showing it would only invite the question of why it is refused.
      if (version.status === "draft") continue;
      rows.push({
        questionId: question.questionId,
        label: textOf(question.label ?? undefined),
        type:
          question.type === null
            ? t("questions.column.typeUnknown")
            : t(`questions.type.${question.type}`),
        version: version.version,
        state: stateLabel(already, version.status),
        pinnable: !already && version.status !== "deprecated",
      });
    }
  }
  return rows;
}

function stateLabel(already: boolean, status: string): string {
  if (already) return t("forms.picker.statePinned");
  if (status === "deprecated") return t("forms.picker.stateDeprecated");
  return t("forms.picker.statePinnable");
}
