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
 * A plain `<button type="submit">`: react-aria's `Button` defaults to `type="button"`, which needs JS to submit.
 * With `implicitDefault` it renders the hidden copy that makes Enter mean Continue when the form also carries
 * `__qop` buttons: implicit submission presses the first submit button in tree order, so the copy comes first,
 * carries Continue's label and `formaction`, and has no `name`.
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
