import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatRowNode } from "./repeat-table.schema.ts";

/**
 * One live instance as a table row (task 077, ADR-43, plan sections 4.3 and 4.5).
 *
 * ## The row header is the focus handle
 *
 * `<th scope="row">` carries the resolved instance label, and it carries the two focus
 * mechanisms Q11 needs: `id={instanceId}` and `tabindex="-1"`, so the scripted path
 * can move focus to it after an add or a removal and the no-JS path can land on it by
 * `autofocus` on the 200 that answers the `__qop` POST. It is the table presentation's
 * counterpart of the instance card's heading, and it is the same destination expressed
 * once rather than a second rule for a second layout.
 *
 * **The landing is `autofocus` and never a fragment** (Q28, ruled 2026-10-01): a 200
 * answering a POST leaves the browser on the POST's own URL, which carries no
 * fragment, and the flush algorithm skips `autofocus` outright when the document has
 * a fragment target, so the two may never both appear.
 *
 * It is a `<th>` and not a `<td>` holding a span, because the row's identifying cell
 * **is** its header: `scope="row"` is what associates every cell in the row with it
 * for 1.3.1, and it is what the card reflow turns into the card's own heading.
 *
 * ## Remove
 *
 * A per-row `<button>` named "Remove Asset 3" - APG's naming practice puts the
 * distinguishing words first. It rides task 073's mechanism unchanged: without
 * scripting it is a `__qop` submit button on the step's own form carrying
 * `formnovalidate`, which is safe only because that post writes no answer, and with
 * scripting it asks the host to post the roster operation.
 *
 * **It is the control most likely to fall below the portal's 44px
 * `--space-control-h` floor** (2.5.8 Target Size), because it is one control in one
 * cell of a table that wants to be narrow. It does not: it shares
 * `.qcms-repeat__button` with the stacked presentation's Remove, so the floor is one
 * declaration for both and a browser spec measures it.
 */
export function RepeatRow({
  groupId,
  instanceId,
  label,
  ordinal,
  removeLabel,
  opToken,
  children,
}: NonNullable<RepeatRowNode["props"]> & { readonly children?: ReactNode }) {
  const native = useQcmsNativeSubmit();
  const { onRemove, busyGroupId, autofocusId } = useQcmsRepeat();
  const canRemove = removeLabel !== undefined;
  const busy = busyGroupId === groupId;

  return (
    <tr
      className="qcms-repeat-table__row"
      data-qcms-instance={instanceId}
      data-qcms-repeat-group={groupId}
      data-qcms-ordinal={ordinal}
    >
      <th
        scope="row"
        className="qcms-repeat-table__rowhead"
        id={instanceId}
        tabIndex={-1}
        autoFocus={autofocusId === instanceId}
      >
        {label}
      </th>
      {children}
      {canRemove ? (
        <td className="qcms-repeat-table__actions">
          {native ? (
            <button
              type="submit"
              name={ROSTER_OP_FIELD}
              value={rosterOpValue({
                op: "remove",
                groupId,
                instanceId,
                token: opToken ?? "",
              })}
              formNoValidate
              className="qcms-repeat__button"
              data-qcms-repeat-action="remove"
            >
              {removeLabel}
            </button>
          ) : (
            <button
              type="button"
              className="qcms-repeat__button"
              data-qcms-repeat-action="remove"
              disabled={busy || onRemove === undefined}
              onClick={() => {
                onRemove?.(groupId, instanceId);
              }}
            >
              {removeLabel}
            </button>
          )}
        </td>
      ) : null}
    </tr>
  );
}
