import type { CSSProperties } from "react";

import type { SubmitButtonNode } from "./submit.schema.ts";

type SubmitButtonProps = NonNullable<SubmitButtonNode["props"]>;

// Clipped rather than `display: none`: a button that is not rendered at all is not
// reliably the target of implicit submission in every engine.

const IMPLICIT_DEFAULT_STYLE: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/**
 * A plain `<button type="submit">` rather than a react-aria `Button`, whose default
 * `type="button"` needs JS to submit a form.
 *
 * With `implicitDefault` it renders the hidden copy that makes Enter mean Continue on a
 * step whose form also carries `__qop` buttons: implicit submission presses the first
 * submit button in tree order, so the copy comes before Remove and Add. It carries the
 * real control's label and `formaction` and no `name`, so a post it submits is
 * byte-identical to a press of Continue, and only the browser ever meets it.
 */
export function SubmitButton({
  label,
  className,
  formAction,
  implicitDefault,
}: Readonly<SubmitButtonProps>) {
  if (implicitDefault === true) {
    return (
      <button
        type="submit"
        formAction={formAction}
        tabIndex={-1}
        aria-hidden="true"
        style={IMPLICIT_DEFAULT_STYLE}
        data-qcms-implicit-submit=""
      >
        {label}
      </button>
    );
  }
  // Present only when the form's own action is a Server Action, to keep Continue
  // pointed at the whole-step BFF route and its 303.
  return (
    <button type="submit" className={className} formAction={formAction}>
      {label}
    </button>
  );
}
