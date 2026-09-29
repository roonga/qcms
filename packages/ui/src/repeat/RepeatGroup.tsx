import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatGroupNode } from "./repeat.schema.ts";

/**
 * A repeating group, expanded (task 073, ADR-42, ADR-43).
 *
 * `children` are the group's own heading followed by one `RepeatInstance` per live
 * instance, both produced by {@link expandRepeatGroups}; this component adds the
 * chrome around them: the Add control, and on the scripted path the `role="status"`
 * region that announces a change.
 *
 * ## The stacked presentation is ONE INPUT PER ROW (Q12, ruled 2026-09-30)
 *
 * A single column inside an instance card, with no two fields side by side **at any
 * width** - not at a desktop width, not in the admin preview, not for two short
 * fields. That is a ruling and not a default, and the two reasons are worth keeping
 * beside the markup: a side-by-side pair inside a repeated card makes the reading
 * order and the tab order diverge from the visual order the moment a rule hides one
 * of the pair in one instance and not in another, which is exactly what per-instance
 * branching does; and one column everywhere is one layout to prove rather than two,
 * which is the same reasoning `playwright.config.ts` encodes by running every spec on
 * the phone project. The layout itself is `theme-components.css`'s
 * `.qcms-repeat__fields`, which is where a reviewer checks it.
 *
 * **Every question type is allowed here**, `longText` and `multiChoice` included: a
 * stacked card gives a control a full row, so nothing about a textarea or a checkbox
 * group is cramped in it. That is the deliberate asymmetry with the table
 * presentation (task 077), which admits five cell types and points an author refused a
 * column type at this one by name.
 *
 * ## Add
 *
 * `Add Vehicle`, from the compiled lexicon. Without scripting it is a **named submit
 * button** on the step's own form (`name="__qop"`) carrying `formnovalidate`, which
 * is safe only because that post writes no answer (ADR-43). It is absent on a group
 * whose size is not the respondent's (`fixed`, `fromAnswer`) and disabled at `max`,
 * which the API refuses independently (`REPEAT_MAX_REACHED`, SEC-16: the per-form
 * bound is the only bound there is).
 *
 * The Add button is also the **third focus destination** after a removal (Q11): the
 * instance that took the removed one's place, else the previous instance, else this
 * button, which is then the only candidate left on the page. It therefore carries a
 * stable id the host can reach.
 */

/** The DOM id of a group's Add control: the third focus destination after a removal. */
export function addButtonId(groupId: string): string {
  return `qcms-repeat-add-${groupId}`;
}

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
  const { onAdd, status, busyGroupId } = useQcmsRepeat();
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
        The announcement, on the scripted path only. 4.1.3 explicitly scopes out a
        message "delivered via a change in context", and a whole-page POST and
        re-render is a change of context that assistive technology already surfaces,
        so the no-JS path needs no live region - a citation rather than an omission.
        The region is rendered empty and filled later, because a region inserted
        already carrying its message is not reliably announced.
      */}
      {native ? null : (
        <p role="status" aria-live="polite" className="qcms-repeat__status">
          {status?.groupId === groupId ? status.message : ""}
        </p>
      )}
    </div>
  );
}
