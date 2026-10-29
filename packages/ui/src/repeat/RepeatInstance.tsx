import type { ReactNode } from "react";

import { useQcmsNativeSubmit } from "../field-context.tsx";
import { useQcmsRepeat } from "./repeat-context.tsx";
import { ROSTER_OP_FIELD, rosterOpValue } from "./repeat-node.ts";
import type { RepeatInstanceNode } from "./repeat.schema.ts";

/**
 * One live instance, as a `<fieldset>` whose `<legend>` holds the instance heading, so one element names the
 * fieldset and is reachable by heading navigation. `tabindex="-1"` and `id` are the focus mechanisms a roster
 * operation needs (no-JS uses `autofocus`, as a 200 answering a POST leaves the URL unchanged). Remove carries
 * `formnovalidate`, safe only because the post writes no answer (ADR-43): validation is deferred, not skipped.
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
