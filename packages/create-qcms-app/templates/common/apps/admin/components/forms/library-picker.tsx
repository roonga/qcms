"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { EntityId } from "@/components/entity-id";
import { HelpTip } from "@/components/help-tip";
import { Alert, Button, Dialog, TextField } from "@/components/kit";
import { ALLOWED_COLUMN_TYPES, columnTypeNote } from "@/lib/forms/table-columns";
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

export function LibraryPicker({
  isOpen,
  stepTitle,
  draft,
  library,
  onAddPins,
  onClose,
  columnTypesOnly = false,
}: {
  readonly isOpen: boolean;
  readonly stepTitle: string;
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /* Add the chosen pins in one call; repeated callbacks would reuse the same closed-over draft and retain
     only the last insertion. */
  readonly onAddPins: (pins: readonly DraftPin[]) => void;
  readonly onClose: () => void;
  /* Use the API eligibility flag; a client type list would duplicate the kernel's publish rules. */
  readonly columnTypesOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  // Preserve selection insertion order because it determines the new pins' document order.
  const [chosen, setChosen] = useState<readonly DraftPin[]>([]);
  const [focusWant, setFocusWant] = useState<number | undefined>(undefined);

  const catalogue = library.ok ? library.data : [];
  const typeFilter = columnTypesOnly ? ALLOWED_COLUMN_TYPES : undefined;
  const candidates = library.ok
    ? withChoices(pinnableRows(catalogue, draft, search, typeFilter), chosen)
    : [];
  const chosenRows = chosenDetail(catalogue, chosen);

  function toggle(row: ChoiceRow, next: boolean): void {
    setChosen((current) =>
      next
        ? choose(current, { questionId: row.questionId, version: row.version })
        : unchoose(current, row.questionId),
    );
  }

  /* Removing an entry destroys its focused button; explicitly focus a surviving control so keyboard
     interaction stays in the dialog. */
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
    pane.closest('[role="dialog"]')?.querySelector("input")?.focus();
  }, [focusWant]);

  function dismiss(): void {
    setChosen([]);
    setSearch("");
    onClose();
  }

  function commit(): void {
    // Resolve the selected rows again before adding so no pin is inserted without having been shown to the
    // author.
    onAddPins(chosenRows.map((row) => ({ questionId: row.questionId, version: row.version })));
    dismiss();
  }

  return (
    <Dialog
      isOpen={isOpen}
      title={t("forms.picker.title", { title: stepTitle })}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <div className="qcms-picker__body">
        {!library.ok && <Alert variant="error">{t("forms.picker.loadFailed")}</Alert>}

        {columnTypesOnly && (
          <p className="qcms-picker__note" data-testid="qcms-picker-column-note">
            {columnTypeNote()}
          </p>
        )}

        {library.ok && (
          <TextField label={t("forms.picker.search")} value={search} onChange={setSearch} />
        )}

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
                        <EntityId kind="question" value={row.questionId} />
                      </th>
                      <td>
                        {row.label}
                        {row.shared && (
                          <span className="qcms-tag qcms-tag--draft" data-picker-shared="">
                            {t("forms.picker.shared")}
                          </span>
                        )}
                      </td>
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

        {library.ok && (
          <section
            className="qcms-picker__chosen"
            data-testid="qcms-picker-chosen"
            id={CHOSEN_PANE_ID}
          >
            <h3 aria-live="polite" className="text-sm font-semibold" id={CHOSEN_HEADING_ID}>
              {t("forms.picker.chosenHeading", { count: chosenRows.length })}
            </h3>
            <HelpTip>{t("forms.picker.hint")}</HelpTip>
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

        <div className="qcms-picker__footer">
          <Button variant="ghost" size="md" onPress={dismiss}>
            {t("forms.picker.cancel")}
          </Button>
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

const CHOSEN_HEADING_ID = "qcms-picker-chosen-heading";

const CHOSEN_PANE_ID = "qcms-picker-chosen-pane";
