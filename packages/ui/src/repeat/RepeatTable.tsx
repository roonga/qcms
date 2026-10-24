import type { ReactNode } from "react";

import { useQcmsLocale, useQcmsValues } from "../field-context.tsx";
import { totalLabelFor } from "./repeat-table-node.ts";
import type { RepeatColumn, RepeatTableNode } from "./repeat-table.schema.ts";

/**
 * The table presentation's `<table>` (ADR-43).
 *
 * A native `<table>` and never `role="grid"`: APG gives as a defining property of the
 * grid pattern that it requires author code to manage focus movement inside it, so
 * with scripting off a grid is a tab trap and this surface's no-JS claim would be
 * qualified. One tab stop per cell is the documented cost of that choice rather than a
 * defect to mitigate with script, and the group's own `max` is what bounds it. Nothing
 * here may grow a roving tabindex or an edit mode; ADR-43 refuses both by name.
 *
 * The `<caption>` carries the group's authored label and is the table's accessible
 * name, which is why the expansion emits no heading node for a table-presented group.
 * The `<tfoot>` total is presentation only: computed, drawn, and never an input, never
 * posted, never stored, never submitted and never exported. An author who needs it
 * stored asks for it as a question.
 *
 * Above the card reflow the table lives in its own `overflow-x: auto` box, the only
 * element on a portal page permitted to scroll horizontally (1.4.10 Reflow). That box
 * is `position: relative`, and so is every cell, because this design puts a visually
 * hidden `<label>` in every cell and one with no positioned ancestor resolves against
 * the initial containing block, lands past the viewport edge and widens the document.
 * The declarations are in `theme-components.css`; this note is here because the markup
 * is what makes them load-bearing.
 */

/** The sum of a numeric column's drawn cells, or `undefined` when none holds one. */
function columnTotal(
  column: RepeatColumn,
  values: Readonly<Record<string, unknown>>,
): number | undefined {
  let total = 0;
  let seen = false;
  for (const field of column.totalFields ?? []) {
    const value = values[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value;
    seen = true;
  }
  return seen ? total : undefined;
}

function cellClass(numeric: boolean | undefined, base: string): string {
  return numeric === true ? `${base} qcms-repeat-table__cell--num` : base;
}

export function RepeatTable({
  groupId,
  caption,
  rowHeader,
  columns,
  actionsLabel,
  children,
}: NonNullable<RepeatTableNode["props"]> & { readonly children?: ReactNode }) {
  const values = useQcmsValues();
  const locale = useQcmsLocale();
  const totals = columns.map((column) => columnTotal(column, values));
  // An empty `<tfoot>` row of blank cells would be a row a respondent reads past for
  // nothing.
  const hasTotals = totals.some((total) => total !== undefined);
  const format = new Intl.NumberFormat(locale);

  return (
    <div className="qcms-repeat-table" data-qcms-repeat-table={groupId}>
      <table className="qcms-repeat-table__table">
        <caption className="qcms-repeat-table__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="qcms-repeat-table__corner">
              {rowHeader}
            </th>
            {columns.map((column) => (
              <th
                key={column.questionId}
                scope="col"
                data-qcms-column={column.questionId}
                className={cellClass(column.numeric, "qcms-repeat-table__colhead")}
              >
                {column.label}
                {column.description === undefined ? null : (
                  // Once per column instead of once per cell. Each input still
                  // carries its own `aria-describedby`, so this is a visible home for
                  // the hint rather than its only encoding.
                  <span className="qcms-repeat-table__colhint">{column.description}</span>
                )}
              </th>
            ))}
            {actionsLabel === undefined ? null : (
              <th scope="col" className="qcms-repeat-table__actionshead">
                {/* Named, not empty: an empty header cell tells a respondent
                    reading the row nothing. */}
                <span className="qcms-repeat-table__hidden">{actionsLabel}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {hasTotals ? (
          <tfoot>
            <tr className="qcms-repeat-table__total">
              <th scope="row" className="qcms-repeat-table__rowhead">
                {totalLabelFor(locale)}
              </th>
              {columns.map((column, index) => {
                const total = totals[index];
                return (
                  <td
                    key={column.questionId}
                    data-qcms-column={column.questionId}
                    data-qcms-total={total === undefined ? undefined : "yes"}
                    className={cellClass(column.numeric, "qcms-repeat-table__cell")}
                  >
                    {total === undefined ? null : (
                      <>
                        {/* Hidden above the reflow and shown in the card layout,
                            where the header cells are gone. Never `aria-hidden`:
                            below the reflow it is the only thing naming this number. */}
                        <span className="qcms-repeat-table__cell-name">{column.label}</span>
                        <span className="qcms-repeat-table__total-value">
                          {format.format(total)}
                        </span>
                      </>
                    )}
                  </td>
                );
              })}
              {actionsLabel === undefined ? null : <td className="qcms-repeat-table__actions" />}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
