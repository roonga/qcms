import type { ReactNode } from "react";

import type { RepeatCellNode } from "./repeat-table.schema.ts";

/**
 * One `<td>` of the table presentation (ADR-43).
 *
 * It holds one member question's whole control, or nothing when a per-instance rule
 * hid that question in this instance. An empty cell rather than no cell, because a
 * short row shears every later column off its header, so the cell count has to be the
 * column count for every row whatever a rule decided.
 *
 * The control inside carries a real `<label>`, clipped by CSS above the card reflow
 * and shown outright below it: `scope` and `headers` are not claimed to name the
 * input, and the reflow removes the header cells altogether, so a label per cell is
 * the only encoding that survives both layouts (H44).
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
