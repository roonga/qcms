import type { CSSProperties } from "react";

import type { SubmitButtonNode } from "./submit.schema.ts";

type SubmitButtonProps = NonNullable<SubmitButtonNode["props"]>;

/**
 * Clipped rather than `display:none`, the same shape as the honeypot's container: a
 * button that is not rendered at all is not reliably the target of implicit submission
 * in every engine, while a 1px clipped one is.
 */
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
 * The real submit control for the native (no-JS) submit mode (task 044). A plain
 * `<button type="submit">` - not a react-aria `Button` (whose default
 * `type="button"` needs JS to submit a form) - so a JavaScript-disabled browser
 * POSTs the enclosing `<form>` natively. Styling is the host app's via
 * `className` (ADR-26 adopter theming); the library adds none of its own.
 *
 * With `implicitDefault` it renders the hidden copy that makes Enter in a field mean
 * Continue on a step whose form also carries `__qop` roster buttons (local UX list P3).
 * HTML's implicit submission presses the form's default button, which is the first
 * submit button in tree order, so the copy has to come before the group's Remove and
 * Add. It carries the real control's label and `formaction` and no `name`, as the real
 * control does, so a post it submits is byte-identical to a press of Continue. It is
 * `aria-hidden` and `tabindex="-1"`: a respondent never meets it, only the browser does.
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
  // `formaction` is a plain URL string and is present only when the form's own action
  // is a Next Server Action (task 073): it keeps Continue pointed at the whole-step BFF
  // route and its 303 while an Add or Remove goes to the action and its 200 re-render.
  return (
    <button type="submit" className={className} formAction={formAction}>
      {label}
    </button>
  );
}
