import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatRowNode } from "./repeat-table.schema.ts";

/**
 * One live instance as a table row. The `<th scope="row">` carries the focus handle,
 * landing by `autofocus` without scripting rather than a fragment, since a 200
 * answering a POST leaves the browser on the POST's own URL.
 *
 * A `<th>` rather than a `<td>` holding a span: `scope="row"` is what associates every
 * cell in the row with it for 1.3.1, and what the card reflow turns into the card's
 * heading.
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
