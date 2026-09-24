import { useId } from "react";

import { getNumberFieldStyles } from "./components/a2ui/number-field/number-field.styles.ts";

/**
 * The number question's control in native (no-JS) submit mode (issue #18).
 *
 * ## Why the vendored NumberField cannot serve this path
 *
 * react-aria's NumberField splits one question across two elements, and neither
 * half works on its own without scripting:
 *
 * - The control the respondent sees is `<input type="text" inputmode="numeric">`
 *   with **no `name`**. It is not a form field at all: whatever is typed into it
 *   is never serialized.
 * - The form value rides a separate `<input type="hidden" name="q_...">` that
 *   `useNumberField` writes from its parsed React state. With scripting off that
 *   state never changes, so the hidden field posts whatever the server seeded it
 *   with, which for an unanswered question is `""`.
 *
 * Observed on the kitchen sink's numeric branch before this change: typing `3`
 * filled the visible box, left the named field empty, and satisfied the browser's
 * own `required` check (the visible box carries the attribute and is non-empty),
 * so the step submitted with the answer silently discarded. The API then reported
 * the question missing and, since issue #964, the step said so beside a field that
 * had re-rendered blank. A required number was therefore unanswerable and an
 * answered one unclearable without scripting.
 *
 * ## What this renders instead, and why `type="number"`
 *
 * A single real `<input type="number">` carrying the question's own name: one
 * element, focusable, serializable, and constraint-validatable by the browser. The
 * choice over text-with-`inputmode` is decided by the contracts either side rather
 * than by taste:
 *
 * - **The wire.** The renderer tags the field `number`, and the BFF decoder coerces
 *   the posted string with `Number(...)` before the API validates it
 *   (`apps/portal/lib/server/step-form.ts`). `type="number"` posts the digits the
 *   respondent typed, unformatted and unlocalized, which is exactly what that
 *   coercion expects - whereas the scripted control DISPLAYS an `Intl.NumberFormat`
 *   rendering that a grouping separator would make unparseable on this path.
 * - **The question.** A number question compiles `minValue` / `maxValue` / `step`,
 *   which map one-to-one onto `min` / `max` / `step`, so the constraints HTML can
 *   express are expressed (the Code Owner's 2026-09-13 ruling on issue #920 keeps
 *   browser validation wherever HTML can carry the rule) and the API re-validates
 *   every one of them for a client that ignores them.
 *
 * ## `step`, and the integer question (issues #151, #944)
 *
 * `step` is the compiled trace of an author's integer constraint: `a2ui-compiler`
 * emits `step: 1` for a question constrained to whole numbers and NOTHING for one
 * that admits fractions. On a native number input that absence cannot be passed
 * through, because HTML's own default for a missing `step` is `1` - a fractional
 * question left unstated would have its fractions refused by the browser. So the
 * mapping is explicit in both directions:
 *
 * | compiled `step` | rendered `step` | meaning |
 * | --- | --- | --- |
 * | `1` (integer question) | `1` | the browser refuses `2.5` |
 * | any other number | that number | the author's own granularity |
 * | absent (fractions allowed) | `"any"` | no granularity constraint |
 *
 * The browser's refusal is a convenience, never the rule: `NOT_AN_INTEGER` is the
 * kernel's (`packages/core/src/validate-answer.ts`), so a crafted post carrying
 * `2.5` for an integer question is refused by the API and reported on the step like
 * any other 422.
 *
 * This does not touch issue #945, which is about two attributes
 * (`inputMode`, `aria-roledescription`) that `useNumberField` derives from the
 * environment on the SCRIPTED control. That control is not rendered on this path,
 * and this one derives nothing from the environment: every attribute below comes
 * from the compiled props.
 *
 * ## Why it is qcms-owned code
 *
 * ADR-22 keeps `src/components/a2ui/**` byte-identical to upstream, so a no-JS
 * fallback cannot live inside the vendored control. It lives here and consumes the
 * vendored control's own style map, so the two renderings of one question share a
 * label, a description slot, an error slot and a token palette (ADR-30) instead of
 * agreeing by hand. `theme-components.css` already reaches this element twice
 * over - the text-entry rule gives it the control height and inline padding, and
 * the tabular-figures selector names `input[type="number"]` - so its box and its
 * digits are the token contract's, not this file's.
 *
 * Hydration is unaffected: the portal's SSR and its first client render both paint
 * native mode, and `ProgressiveStep` swaps the whole native form for the controlled
 * `StepFlow` only after hydration (task 044, issue #121).
 */
export interface NativeNumberFieldProps {
  /** The questionId, which is the posted field name. */
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  readonly isInvalid?: boolean;
  /** Numeric bounds from the question's constraints. */
  readonly minValue?: number;
  readonly maxValue?: number;
  /** The compiled granularity; absent means fractions are admitted. */
  readonly step?: number;
  /** The stored answer this field is seeded with; uncontrolled from there on. */
  readonly defaultValue?: number;
}

/**
 * The input's own box. The vendored `inputGroup` classes draw the equivalent box
 * around the stepper row; the stepper buttons themselves are a scripted affordance
 * and have no counterpart here, so the box and the editable area are one element.
 * `min-h-11` is a floor the token rule then restates from `--space-control-h`, kept
 * so the control never collapses in a host that has not imported the theme layer.
 */
const INPUT_CLASS = [
  "flex items-center min-h-11 w-full border border-(--color-border) rounded px-3 py-1",
  "bg-(--color-background) text-sm text-(--color-text) placeholder-(--color-text-muted)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/**
 * The `step` attribute for a compiled `step` prop. `"any"` for a question that
 * admits fractions, because HTML's default for a missing `step` is `1` and would
 * refuse them (see the table in this module's docblock).
 */
export function nativeNumberStep(step: number | undefined): string {
  return step === undefined ? "any" : String(step);
}

export function NativeNumberField({
  name,
  label,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  isReadOnly,
  isInvalid,
  minValue,
  maxValue,
  step,
  defaultValue,
}: NativeNumberFieldProps) {
  const styles = getNumberFieldStyles();
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  // Both slots are named when both are drawn, so a screen reader announces the
  // hint and the refusal rather than one of them (WCAG 3.3.2, 3.3.1).
  const describedBy =
    [
      description === undefined ? undefined : descriptionId,
      errorMessage === undefined ? undefined : errorId,
    ]
      .filter((id) => id !== undefined)
      .join(" ") || undefined;

  return (
    <div className={styles.container}>
      {label === undefined ? null : (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {isRequired === true ? (
            <span aria-hidden="true" className={styles.requiredIndicator}>
              {" "}
              *
            </span>
          ) : null}
        </label>
      )}
      <input
        id={inputId}
        type="number"
        name={name}
        className={INPUT_CLASS}
        defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
        required={isRequired}
        disabled={isDisabled}
        readOnly={isReadOnly}
        min={minValue}
        max={maxValue}
        step={nativeNumberStep(step)}
        aria-invalid={isInvalid === true ? true : undefined}
        aria-describedby={describedBy}
      />
      {description === undefined ? null : (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      )}
      {errorMessage === undefined ? null : (
        <span id={errorId} className={styles.errorMessage}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
