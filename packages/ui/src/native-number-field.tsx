import { useId } from "react";

import { getNumberFieldStyles } from "./components/a2ui/number-field/number-field.styles.ts";

/**
 * The number question's control in native (no-JS) submit mode.
 *
 * The vendored NumberField cannot serve this path: the box the respondent sees carries
 * no `name`, and the value rides a hidden input that `useNumberField` writes from React
 * state, which never changes with scripting off. Typing an answer satisfied the
 * browser's `required` check and posted nothing.
 *
 * This renders one real `<input type="number">` under the question's own name, chosen
 * over text-with-`inputmode` by the contracts either side: it posts unformatted,
 * unlocalized digits, which is what the BFF's `Number(...)` coercion expects, whereas
 * the scripted control displays an `Intl.NumberFormat` rendering whose grouping
 * separator would be unparseable here. A number question's `minValue` / `maxValue` /
 * `step` map one-to-one onto `min` / `max` / `step`, so browser validation carries
 * every rule HTML can express and the API re-validates all of them anyway.
 *
 * `step` needs the explicit mapping below because HTML's default for a missing `step` is
 * `1`, so a fractional question left unstated would have its fractions refused:
 *
 * | compiled `step` | rendered `step` | meaning |
 * | --- | --- | --- |
 * | `1` (integer question) | `1` | the browser refuses `2.5` |
 * | any other number | that number | the author's own granularity |
 * | absent (fractions allowed) | `"any"` | no granularity constraint |
 *
 * The browser's refusal is a convenience, never the rule: `NOT_AN_INTEGER` is the
 * kernel's, so a crafted post is refused by the API like any other 422.
 *
 * ADR-22 keeps the vendored components byte-identical upstream, so a no-JS fallback
 * cannot live inside one. This consumes the vendored control's own style map instead, so
 * both renderings of a question share a label, slots and the ADR-30 token palette.
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
 * The input's own box, matching the vendored `inputGroup` classes. The stepper buttons
 * are a scripted affordance with no counterpart here, so box and editable area are one
 * element. `min-h-11` is kept as a floor so the control never collapses in a host that
 * has not imported the theme layer.
 */
const INPUT_CLASS = [
  "flex items-center min-h-11 w-full border border-(--color-border) rounded px-3 py-1",
  "bg-(--color-background) text-sm text-(--color-text) placeholder-(--color-text-muted)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/**
 * The `step` attribute for a compiled `step` prop. `"any"` for a question that admits
 * fractions, because HTML's default for a missing `step` is `1` and would refuse them.
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
      {/* A styling anchor: the table presentation clips a cell's label and hint, which
          the column header carries once for the whole column. */}
      {description === undefined ? null : (
        <span id={descriptionId} data-qcms-hint="" className={styles.description}>
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
