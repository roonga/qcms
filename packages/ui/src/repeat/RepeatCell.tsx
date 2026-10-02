import type { ReactNode } from "react";

import type { RepeatCellNode } from "./repeat-table.schema.ts";

/**
 * One `<td>` of the table presentation (task 077, ADR-43).
 *
 * It holds one member question's whole control - the vendored input with its own
 * `<label>`, its description and its error slot - or **nothing**, when a per-instance
 * rule hid that question in this instance.
 *
 * ## Why an empty cell rather than no cell
 *
 * A rule whose target is inside a group is evaluated once per live instance, so a
 * member question can be visible in instance 1 and hidden in instance 2. The stacked
 * presentation simply drops the control. A table cannot: a short row shears every
 * later column off its header, so the cell count has to be the column count for every
 * row whatever any rule decided. The cell is therefore a node of its own, the
 * expansion emits one per column per row, and a hidden member leaves it childless.
 *
 * ## The cell's label is the input's own
 *
 * The control inside carries a real `<label>` reading "Asset 3, Value AUD", clipped by
 * CSS above the card reflow and shown outright below it. `scope` and `headers`
 * associate a **cell** with its header cells; no source found claims they contribute
 * to the **input's** accessible name, and the reflow removes the header cells
 * altogether, so a real label per cell is the only encoding that survives both
 * layouts (H44, APG's naming practice, the WAI tables tutorial).
 */
export function RepeatCell({
  questionId,
  numeric,
  children,
}: NonNullable<RepeatCellNode["props"]> & { readonly children?: ReactNode }) {
  return (
    <td
      data-qcms-column={questionId}
      className={
        numeric === true
          ? "qcms-repeat-table__cell qcms-repeat-table__cell--num"
          : "qcms-repeat-table__cell"
      }
    >
      {children}
    </td>
  );
}
