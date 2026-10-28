import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { addButtonId, ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatGroupNode } from "./repeat.schema.ts";

/**
 * An expanded repeating group: its children plus the Add control and, when scripted, the `role="status"` region.
 * One input per row at any width is a ruling: a side-by-side pair splits reading and tab order from the visual
 * order when a rule hides one of them. Add is disabled at `max` (SEC-16); without scripting it carries
 * `formnovalidate`, safe because that post writes no answer (ADR-43), and needs a stable id as a focus target.
 */

export function RepeatGroup({
  groupId,
  presentation,
  countSource,
  instanceCount,
  canAdd,
  addLabel,
  opToken,
  children,
}: NonNullable<RepeatGroupNode["props"]> & { readonly children?: ReactNode }) {
  const native = useQcmsNativeSubmit();
  const { onAdd, status, busyGroupId, autofocusId } = useQcmsRepeat();
  const addable = countSource === "open" && addLabel !== undefined;
  const busy = busyGroupId === groupId;

  return (
    <div
      className="qcms-repeat"
      data-qcms-repeat-group={groupId}
      data-qcms-presentation={presentation}
      data-qcms-instances={instanceCount ?? 0}
    >
      {children}
      {addable ? (
        <div className="qcms-repeat__actions qcms-repeat__actions--add">
          {native ? (
            <button
              type="submit"
              id={addButtonId(groupId)}
              name={ROSTER_OP_FIELD}
              value={rosterOpValue({ op: "add", groupId, token: opToken ?? "" })}
              formNoValidate
              disabled={canAdd === false}
              autoFocus={autofocusId === addButtonId(groupId)}
              className="qcms-repeat__button"
              data-qcms-repeat-action="add"
            >
              {addLabel}
            </button>
          ) : (
            <button
              type="button"
              id={addButtonId(groupId)}
              className="qcms-repeat__button"
              data-qcms-repeat-action="add"
              disabled={canAdd === false || busy || onAdd === undefined}
              onClick={() => {
                onAdd?.(groupId);
              }}
            >
              {addLabel}
            </button>
          )}
        </div>
      ) : null}
      {/*
        Scripted only: 4.1.3 scopes out a message delivered via a change in context, and
        a whole-page re-render is one. Rendered empty and filled later, because a region
        inserted already carrying its message is not reliably announced.
      */}
      {native ? null : (
        <p role="status" aria-live="polite" className="qcms-repeat__status">
          {status?.groupId === groupId ? status.message : ""}
        </p>
      )}
    </div>
  );
}
