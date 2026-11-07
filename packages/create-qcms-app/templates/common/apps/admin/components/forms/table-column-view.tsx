"use client";

import { useId } from "react";

import { EntityId } from "@/components/entity-id";
import { HelpTip } from "@/components/help-tip";
import { Alert, Button } from "@/components/kit";
import { columnTypeNote, tableColumnRows } from "@/lib/forms/table-columns";
import type { DraftPin, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

export function TableColumnView({
  members,
  library,
  onAddColumn,
}: {
  readonly members: readonly DraftPin[];
  readonly library: readonly PinnableQuestion[];
  readonly onAddColumn?: () => void;
}) {
  const rows = tableColumnRows(members, library);
  const refused = rows.filter((row) => !row.allowed);
  // Use a generated id because multiple column views may share a page and each heading must label its own
  // section.
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-(--color-border) bg-(--color-surface) p-4"
      data-testid="table-column-view"
    >
      <div className="qcms-help-head">
        <h3 id={headingId} className="text-base font-semibold text-(--color-text)">
          {t("forms.columns.title")}
        </h3>
        <HelpTip>
          <span data-testid="column-type-note">{columnTypeNote()}</span>
        </HelpTip>
      </div>
      <div className="mt-3 flex flex-col gap-4">
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
