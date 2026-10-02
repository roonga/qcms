import type { SubmitButtonNode } from "./submit.schema.ts";

type SubmitButtonProps = NonNullable<SubmitButtonNode["props"]>;

/**
 * The real submit control for the native (no-JS) submit mode (task 044). A plain
 * `<button type="submit">` - not a react-aria `Button` (whose default
 * `type="button"` needs JS to submit a form) - so a JavaScript-disabled browser
 * POSTs the enclosing `<form>` natively. Styling is the host app's via
 * `className` (ADR-26 adopter theming); the library adds none of its own.
 */
export function SubmitButton({ label, className, formAction }: Readonly<SubmitButtonProps>) {
  // `formaction` is a plain URL string and is present only when the form's own action
  // is a Next Server Action (task 073): it keeps Continue pointed at the whole-step BFF
  // route and its 303 while an Add or Remove goes to the action and its 200 re-render.
  return (
    <button type="submit" className={className} formAction={formAction}>
      {label}
    </button>
  );
}
