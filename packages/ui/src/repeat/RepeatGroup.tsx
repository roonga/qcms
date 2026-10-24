import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { addButtonId, ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatGroupNode } from "./repeat.schema.ts";

/**
 * A repeating group, expanded (ADR-42, ADR-43).
 *
 * `children` are the group's own heading followed by one `RepeatInstance` per live
 * instance; this component adds the chrome around them: the Add control, and on the
 * scripted path the `role="status"` region that announces a change.
 *
 * The stacked presentation is one input per row at any width, which is a ruling rather
 * than a default: a side-by-side pair inside a repeated card makes the reading order
 * and the tab order diverge from the visual order the moment a rule hides one of the
 * pair in one instance and not another, and one column everywhere is one layout to
 * prove rather than two. The layout itself is `.qcms-repeat__fields` in
 * `theme-components.css`, which is where a reviewer checks it.
 *
 * Every question type is allowed here, because a stacked card gives a control a full
 * row. That is the deliberate asymmetry with the table presentation, which admits
 * fewer cell types.
 *
 * Add is absent on a group whose size is not the respondent's and disabled at `max`,
 * which the API refuses independently (SEC-16: the per-form bound is the only bound).
 * Without scripting it is a named `__qop` submit button carrying `formnovalidate`,
 * which is safe only because that post writes no answer (ADR-43).
 *
 * It is also the last focus destination after a removal, when it is the only candidate
 * left on the page, so it carries a stable id the host can reach.
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
        The announcement, on the scripted path only: 4.1.3 scopes out a message
        delivered via a change in context, and a whole-page POST and re-render is one,
        so the no-JS path needs no live region. The region is rendered empty and filled
        later, because one inserted already carrying its message is not reliably
        announced.
      */}
      {native ? null : (
        <p role="status" aria-live="polite" className="qcms-repeat__status">
          {status?.groupId === groupId ? status.message : ""}
        </p>
      )}
    </div>
  );
}
