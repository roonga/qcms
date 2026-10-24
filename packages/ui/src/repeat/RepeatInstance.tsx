import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatInstanceNode } from "./repeat.schema.ts";

/**
 * One live instance of a repeating group (ADR-43).
 *
 * A `<fieldset>` whose `<legend>` holds a heading carrying the resolved instance
 * label, which is the WAI forms tutorial's own worked example and technique H71's
 * rule of thumb for a group inside a larger form.
 *
 * The heading is inside the legend so one element does two jobs: `<legend>`'s content
 * model admits heading content, so the heading gives the fieldset its accessible name
 * and is reachable by heading navigation with the label spoken once. Repeating the
 * text would have it read with every control in the group on some screen readers.
 *
 * The heading carries `tabindex="-1"` and `id={instanceId}`, the two focus mechanisms
 * a roster operation needs: the scripted path moves focus to it, and the no-JS path
 * lands on it by `autofocus` on the same 200 re-render, never a fragment, since a 200
 * answering a POST leaves the browser on the POST's own URL. The id is the bare
 * instance id; the field ids beneath it are the qualified names.
 *
 * Remove is named "Remove Vehicle 3" rather than the reverse, because APG's naming
 * practice puts the distinguishing words first. Without scripting it is a named
 * `__qop` submit button on the step's own form carrying `formnovalidate`, which stops
 * the browser refusing the press because another instance has a blank required field.
 * That is safe only because the post writes no answer (ADR-43): validation is deferred
 * to Continue, not skipped.
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
