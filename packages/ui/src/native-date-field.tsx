import { useId } from "react";

import { getDatePickerStyles } from "./components/a2ui/date-picker/date-picker.styles.ts";

/**
 * The date question's control in native (no-JS) submit mode (issue #920).
 *
 * ## Why the vendored DatePicker cannot serve this path
 *
 * react-aria's DatePicker is a row of `role="spinbutton"` segments driven entirely
 * by JavaScript key handlers, plus a popover calendar. With scripting off a
 * respondent can neither type into it nor open it, so the control displays a date
 * and accepts none. Its form value rides on two companions, and the shapes matter:
 *
 * - `<input type="text" hidden required>` - react-aria's validation mirror. It is
 *   `hidden` rather than `type="hidden"`, so `willValidate` is true and the browser
 *   DOES try to report its validity; being unfocusable it cannot, and Chrome
 *   abandons the submission with `An invalid form control with name='q_dob' is not
 *   focusable`. A required date therefore made the whole step unsubmittable without
 *   scripting, which is the defect issue #920 opens with.
 * - `<input type="date" form="" tabindex="-1">` - an autofill target owned by no
 *   form (an empty `form` attribute names no element), so it never serializes.
 *
 * ## What this renders instead, and why `type="date"`
 *
 * A single real `<input type="date">`: focusable, constraint-validatable, and
 * operable with no scripting at all. The choice over text-with-`pattern` is decided
 * by the two contracts either side of it rather than by taste:
 *
 * - **The wire.** A date question's answer is an ISO day (`DateAnswerValue`), the
 *   renderer tags the field `string`, and the BFF decoder passes the posted string
 *   through verbatim. `type="date"` submits exactly `YYYY-MM-DD`, so the fallback
 *   posts the same bytes the scripted path posts, with no decoder change.
 * - **The question.** A date question compiles with `granularity: "day"` and
 *   optional ISO `minValue` / `maxValue`, which map one-to-one onto `min` and `max`
 *   here. `pattern` could restate the shape but not the bounds, and would leave the
 *   respondent typing ISO by hand with no affordance.
 *
 * A browser too old for `type="date"` falls back to a text box by the HTML spec's
 * own rule, which still posts a string the API validates (R2), so the degradation
 * is a plainer control rather than a dead end.
 *
 * Granularity finer than a day is not a QCMS question - the compiler emits `"day"`
 * and nothing else - and the answer encoding is a day either way, so this stays a
 * day input rather than growing a `datetime-local` branch that could only post a
 * value the API refuses.
 *
 * ## Why it is qcms-owned code
 *
 * ADR-22 keeps `src/components/a2ui/**` byte-identical to upstream, so a no-JS
 * fallback cannot live inside the vendored control. It lives here and consumes the
 * vendored control's own style map, so the two renderings of one question share a
 * label, a description slot, an error slot and a token palette (ADR-30) instead of
 * agreeing by hand.
 *
 * Hydration is unaffected: the portal's SSR and its first client render both paint
 * native mode, and `ProgressiveStep` swaps the whole native form for the controlled
 * `StepFlow` only after hydration (task 044, issue #121), so no attribute on this
 * element is ever compared against a scripted render of the same question.
 */
export interface NativeDateFieldProps {
  /** The questionId, which is the posted field name. */
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  readonly isInvalid?: boolean;
  /** ISO day bounds from the question's constraints. */
  readonly minValue?: string;
  readonly maxValue?: string;
  /** The stored answer this field is seeded with; uncontrolled from there on. */
  readonly defaultValue?: string;
}

/**
 * The input's own box. The vendored `group` classes draw the equivalent box around
 * the segmented control, minus its `data-*` state variants, which have no meaning
 * on a native input: invalid is `aria-invalid` and disabled is the real attribute.
 */
const INPUT_CLASS = [
  "flex items-center min-h-11 w-full border border-(--color-border) rounded px-2 py-1 gap-1",
  "bg-(--color-surface) text-sm text-(--color-text)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

export function NativeDateField({
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
  defaultValue,
}: NativeDateFieldProps) {
  const styles = getDatePickerStyles();
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
    <div className={styles.root}>
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
        type="date"
        name={name}
        className={INPUT_CLASS}
        defaultValue={defaultValue}
        required={isRequired}
        disabled={isDisabled}
        readOnly={isReadOnly}
        min={minValue}
        max={maxValue}
        aria-invalid={isInvalid === true ? true : undefined}
        aria-describedby={describedBy}
      />
      {description === undefined ? null : (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      )}
      {errorMessage === undefined ? null : (
        <span id={errorId} className={styles.error}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
