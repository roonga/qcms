import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatInstanceNode } from "./repeat.schema.ts";

/**
 * One live instance of a repeating group (task 073, ADR-43, plan section 4.3).
 *
 * ## The markup, and why each part of it is there
 *
 * A `<fieldset>` whose `<legend>` holds a heading carrying the resolved instance
 * label. That is the WAI forms tutorial's own worked example (two same-shaped address
 * blocks distinguished by their legends) and technique H71's rule of thumb: a group
 * inside a larger form that needs a heading of its own.
 *
 * **The heading is INSIDE the legend, and that is one element doing two jobs rather
 * than two elements saying the same thing.** The plan asks for "a `<legend>` carrying
 * the resolved instance label, with the same text as a heading inside it so the
 * instance is reachable by heading navigation as well as by group". HTML's content
 * model for `<legend>` is "phrasing content, optionally intermixed with **heading
 * content**", so a heading inside the legend is legal, gives the fieldset its
 * accessible name, and is reachable by heading navigation - with the label spoken
 * once rather than twice. The tutorial's warning that some screen readers read the
 * legend with **every** control in the group is exactly why the text is not repeated.
 *
 * The heading carries `tabindex="-1"` and `id={instanceId}`, which are the two focus
 * mechanisms Q11 needs: the scripted path moves focus to it after an add or a remove,
 * and the no-JS path lands on it by the fragment on the 200 re-render. The **id is
 * the bare instance id**, so the fragment is `#ins_7k2`; the field ids beneath it are
 * `ins_7k2/q_plate`, which is the qualified name and the same string the error
 * summary anchors at.
 *
 * ## Remove
 *
 * A `<button>` named "Remove Vehicle 3" - APG's naming practice puts the
 * distinguishing words first, so never "Vehicle 3 remove". Without scripting it is a
 * **named submit button** on the step's own form, `name="__qop"`, carrying
 * `formnovalidate`: a button contributes its name and value only when it is the
 * submitter, so one form carries several operations with no script at all, and
 * `formnovalidate` is what stops the browser refusing the press because some other
 * instance has a blank required field. `formnovalidate` is safe here **only because
 * the post writes no answer** (ADR-43, the ruling of 2026-09-30): validation is
 * deferred to Continue, not skipped.
 */
export function RepeatInstance({
  groupId,
  instanceId,
  label,
  ordinal,
  headingAs,
  removeLabel,
  opToken,
  children,
}: NonNullable<RepeatInstanceNode["props"]> & { readonly children?: ReactNode }) {
  const native = useQcmsNativeSubmit();
  const { onRemove, busyGroupId, autofocusId } = useQcmsRepeat();
  const Heading = headingAs;
  const canRemove = removeLabel !== undefined;
  const busy = busyGroupId === groupId;

  return (
    <fieldset
      className="qcms-repeat__instance"
      data-qcms-instance={instanceId}
      data-qcms-repeat-group={groupId}
      data-qcms-ordinal={ordinal}
    >
      <legend className="qcms-repeat__legend">
        <Heading
          className="qcms-repeat__heading"
          id={instanceId}
          tabIndex={-1}
          autoFocus={autofocusId === instanceId}
        >
          {label}
        </Heading>
      </legend>
      <div className="qcms-repeat__fields">{children}</div>
      {canRemove ? (
        <div className="qcms-repeat__actions">
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
        </div>
      ) : null}
    </fieldset>
  );
}
