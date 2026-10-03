import type { ReactNode } from "react";

import { useQcmsLocale, useQcmsValues } from "../field-context.tsx";
import { totalLabelFor } from "./repeat-table-node.ts";
import type { RepeatColumn, RepeatTableNode } from "./repeat-table.schema.ts";

/**
 * The table presentation's `<table>` (task 077, ADR-43, Q10, plan section 4.5).
 *
 * ## A native `<table>`, never `role="grid"`
 *
 * APG states as a defining property of the grid pattern that it "Requires the author
 * to provide code that manages focus movement inside it", so with scripting off a
 * `role="grid"` renders as a tab-trap-shaped nothing and this surface's no-JS claim
 * is unqualified. APG also prefers the native element outright, its two optimal cell
 * designs exclude a text input, and the table reflows to cards on a phone where no
 * grid keyboard model exists at all. **One tab stop per cell is the documented cost
 * of that choice** and not a defect to mitigate with script: the mitigation is the
 * group's own `max`. Nothing in this file may grow a roving tabindex or an edit mode;
 * ADR-43 refuses both by name.
 *
 * ## The structure, and what each part is for
 *
 * - A `<caption>` carrying the group's authored label, which is the table's
 *   accessible name. It is the only place that label appears, which is why the
 *   expansion emits no heading node for a table-presented group.
 * - A corner `<th scope="col">` naming the row-header column ("Asset"), then one
 *   `<th scope="col">` per member question carrying the question's own label, then
 *   the actions column's visually hidden header where the rows carry a Remove.
 * - `<tbody>`: one `RepeatRow` per live instance.
 * - `<tfoot>`: a column total for every `number` column, which is **presentation
 *   only** - computed, drawn, and never an input, never posted, never stored, never
 *   submitted and never exported. An author who needs it stored asks for it as a
 *   question (ADR-43's out-of-scope list).
 *
 * ## The scroll box, and the 136 pixels it cost somebody
 *
 * Above the card reflow the table lives in its own `overflow-x: auto` box, which is
 * the only element on a portal page permitted to scroll horizontally (1.4.10
 * Reflow). That box is `position: relative`, and so is every cell: this design puts
 * a visually hidden `<label>` in **every** cell, and a visually hidden label
 * positioned with `position: absolute` inside an `overflow-x: auto` box with no
 * positioned ancestor resolves against the initial containing block, lands past the
 * viewport edge and widens the **document** - which is exactly the horizontal page
 * scroll the portal forbids. It cost 136 unexplained pixels on a concept page and 863
 * on an admin table. The declarations live in `theme-components.css`; this comment is
 * here because the markup is what makes them load-bearing.
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
  // No numeric column means no total to draw, and an empty `<tfoot>` row of blank
  // cells would be a row a respondent has to read past for nothing.
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
                  // The question's help text, once per column instead of once per cell.
                  // Each input still carries its own `aria-describedby`, so this is a
                  // visible home for a hint rather than its only encoding.
                  <span className="qcms-repeat-table__colhint">{column.description}</span>
                )}
              </th>
            ))}
            {actionsLabel === undefined ? null : (
              <th scope="col" className="qcms-repeat-table__actionshead">
                {/* Named, not empty: an empty header cell tells a respondent reading
                    the row nothing, and the wording is the compiler's own Remove
                    lexicon with its `{label}` placeholder taken out, so there is no
                    second source for it to drift from. */}
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
                        {/* The column's name, hidden above the reflow and shown in the
                            card layout, where `scope` no longer associates anything
                            because the header cells are gone. It is NOT `aria-hidden`:
                            below the reflow it is the only thing naming this number,
                            and above it the small redundancy with the column header is
                            the cheaper of the two mistakes. */}
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
