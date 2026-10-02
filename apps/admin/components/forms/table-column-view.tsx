"use client";

import { EntityId } from "@/components/entity-id";
import { Alert, Button } from "@/components/kit";
import { columnTypeNote, tableColumnRows } from "@/lib/forms/table-columns";
import type { DraftPin, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The **column view** of a table-presented group's member list (task 077, ADR-43, plan
 * section 6.3).
 *
 * Under ADR-42 there is no table question, so this is the whole of what the plan calls the
 * "column editor": a second view of one list. Each row is a column of the rendered table,
 * showing the column's label, the question underneath it and that question's **type, shown
 * rather than chosen** - it is the question's own, decided in the question editor and
 * frozen by the pin. Adding a column is adding a question to the group, which is what the
 * one control here does.
 *
 * ## It is a component of its own, and that is deliberate
 *
 * The group panel is task 074's and this view is task 077's, so it lives in its own file
 * with its own inputs: the member pins, the library, and a handler for the add. A panel
 * that wants it renders it; nothing here reaches into the panel's state, so the two tasks
 * share no file and may land in either order.
 *
 * ## A refused column is listed, not hidden
 *
 * A member added before the presentation was switched to `table` is still a member, and
 * publish will refuse the form by naming it (`TABLE_COLUMN_TYPE_NOT_ALLOWED`). A view that
 * dropped the row would leave the author reading a publish error about a column the panel
 * does not show. So the row stays, says it is not allowed, and points at the stacked
 * presentation - the same sentence the publish error carries.
 *
 * The markup is a hand-authored `<table>` inside the app's table family wrapper, like the
 * other nine (`plan/admin-design-contracts.md` §2, issue #570): `.qcms-table` is also the
 * positioning region every visually hidden cell label needs.
 */
export function TableColumnView({
  members,
  library,
  onAddColumn,
}: {
  /** The group's member pins, in document order: one column each. */
  readonly members: readonly DraftPin[];
  /** The question library, for each member's label and type. */
  readonly library: readonly PinnableQuestion[];
  /**
   * Open the filtered library picker. Absent while the panel has no library to offer,
   * which is the state the step editor leaves its own Add control operable in.
   */
  readonly onAddColumn?: () => void;
}) {
  const rows = tableColumnRows(members, library);
  const refused = rows.filter((row) => !row.allowed);

  return (
    <section
      aria-labelledby="qcms-columns-heading"
      className="rounded-md border border-(--color-border) bg-(--color-surface) p-4"
      data-testid="table-column-view"
    >
      <h3 id="qcms-columns-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.columns.title")}
      </h3>
      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.columns.description")}</p>
        {/* The one sentence the picker and the publish error also say, so an author meets
            the same five types and the same way out wherever they are refused. */}
        <p className="text-sm text-(--color-text-muted)" data-testid="column-type-note">
          {columnTypeNote()}
        </p>
        {refused.length === 0 ? null : (
          <div data-testid="column-types-refused">
            <Alert variant="warning">{t("forms.columns.refusedHint")}</Alert>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("forms.columns.empty")}</p>
        ) : (
          <div className="qcms-table">
            <table>
              <caption className="qcms-visually-hidden">{t("forms.columns.tableLabel")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("forms.columns.column.ordinal")}</th>
                  <th scope="col">{t("forms.columns.column.label")}</th>
                  <th scope="col">{t("forms.columns.column.question")}</th>
                  <th scope="col">{t("forms.columns.column.type")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.questionId}@${String(row.version)}`} data-column={row.questionId}>
                    <td className="qcms-cell--num">{row.ordinal}</td>
                    <th scope="row">{row.label}</th>
                    <td>
                      <EntityId kind="question" value={row.questionId} />
                    </td>
                    <td>
                      {row.type}
                      {row.allowed ? null : (
                        <span
                          className="ms-2 text-(--color-danger-fg)"
                          data-testid="column-refused"
                        >
                          {t("forms.columns.refused")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {onAddColumn === undefined ? null : (
          <div>
            <Button variant="secondary" onPress={onAddColumn}>
              {t("forms.columns.add")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
