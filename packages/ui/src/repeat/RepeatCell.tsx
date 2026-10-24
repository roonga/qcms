import type { ReactNode } from "react";

import type { RepeatCellNode } from "./repeat-table.schema.ts";

/**
 * One `<td>`, empty when a per-instance rule hid its question: a short row would shear
 * every later column off its header. The control inside keeps a real `<label>`, clipped
 * above the card reflow, because the reflow removes the header cells altogether and a
 * per-cell label is the only naming that survives both layouts (H44).
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
