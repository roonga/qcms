"use client";

import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Dialog, Table, TextField, type TableRow } from "@/components/kit";
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
 * ## What is listed, and what is refused
 *
 * Published versions can be pinned. Deprecated versions are **listed and disabled**, which
 * is 022's rule made visible: they are not gone (a form already pinned to one keeps
 * working, R6), they simply cannot be chosen for a *new* pin, and an author who cannot see
 * that a version exists at all will assume the library lost it. A question already in this
 * form is disabled for the same reason the kernel refuses it,
 * `DUPLICATE_QUESTION_IN_FORM`, so the picker greys it out rather than letting an author
 * add a row and then reading an error about the row they just created (004's refinement).
 *
 * Draft versions never appear: they can still change, and a pin to something that can
 * change is not a pin.
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
  const candidates = library.ok
    ? pinnableRows(library.data, draft, search)
    : { rows: [], disabled: [] };

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
          (candidates.rows.length === 0 ? (
            <EmptyState heading={t("forms.picker.empty")} testId="qcms-picker-empty" />
          ) : (
            <div className="qcms-table qcms-table--rowaction qcms-table--picker">
              <Table
                ariaLabel={t("forms.picker.tableLabel")}
                columns={[
                  {
                    id: "questionId",
                    label: t("forms.picker.column.questionId"),
                    isRowHeader: true,
                  },
                  { id: "label", label: t("forms.picker.column.label") },
                  { id: "type", label: t("forms.picker.column.type") },
                  { id: "version", label: t("forms.picker.column.version") },
                  { id: "state", label: t("forms.picker.column.state") },
                ]}
                rows={candidates.rows}
                disabledKeys={candidates.disabled}
                onRowAction={(id) => {
                  const chosen = parseRowId(id);
                  if (chosen === undefined) return;
                  onPin(chosen.questionId, chosen.version);
                  onClose();
                }}
              />
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

/** `questionId@version`, which is both the row key and the pin the row would create. */
function rowId(questionId: string, version: number): string {
  return `${questionId}@${String(version)}`;
}

function parseRowId(id: string): { questionId: string; version: number } | undefined {
  const at = id.lastIndexOf("@");
  if (at === -1) return undefined;
  const version = Number.parseInt(id.slice(at + 1), 10);
  return Number.isInteger(version) ? { questionId: id.slice(0, at), version } : undefined;
}

/** Whether a question matches the free-text box, over the id, slug and label. */
function matches(question: PinnableQuestion, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = `${question.questionId} ${question.slug} ${textOf(question.label ?? undefined)}`;
  return haystack.toLowerCase().includes(needle);
}

/** The version rows, with the ones that cannot be pinned marked as disabled. */
function pinnableRows(
  library: readonly PinnableQuestion[],
  draft: DraftForm,
  search: string,
): { rows: TableRow[]; disabled: string[] } {
  const rows: TableRow[] = [];
  const disabled: string[] = [];

  for (const question of library) {
    if (!matches(question, search)) continue;
    const already = isPinned(draft, question.questionId);
    for (const version of question.versions) {
      // A draft version is not pinnable and never will be as it stands, so it is not
      // listed at all: showing it would only invite the question of why it is disabled.
      if (version.status === "draft") continue;
      const id = rowId(question.questionId, version.version);
      if (already || version.status === "deprecated") disabled.push(id);
      rows.push({
        id,
        data: {
          questionId: question.questionId,
          label: textOf(question.label ?? undefined),
          type:
            question.type === null
              ? t("questions.column.typeUnknown")
              : t(`questions.type.${question.type}`),
          version: t("forms.version.value", { version: version.version }),
          state: stateLabel(already, version.status),
        },
      });
    }
  }
  return { rows, disabled };
}

function stateLabel(already: boolean, status: string): string {
  if (already) return t("forms.picker.statePinned");
  if (status === "deprecated") return t("forms.picker.stateDeprecated");
  return t("forms.picker.statePinnable");
}
