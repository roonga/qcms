import type { SubmitButtonNode } from "./submit.schema.ts";

type SubmitButtonProps = NonNullable<SubmitButtonNode["props"]>;

/**
 * The real submit control for the native (no-JS) submit mode (task 044). A plain
 * `<button type="submit">` - not a react-aria `Button` (whose default
 * `type="button"` needs JS to submit a form) - so a JavaScript-disabled browser
 * POSTs the enclosing `<form>` natively. Styling is the host app's via
 * `className` (ADR-26 adopter theming); the library adds none of its own.
 */
export function SubmitButton({ label, className }: Readonly<SubmitButtonProps>) {
  return (
    <button type="submit" className={className}>
      {label}
    </button>
  );
}
