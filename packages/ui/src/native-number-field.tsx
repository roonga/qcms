import { useId } from "react";

import { getNumberFieldStyles } from "./components/a2ui/number-field/number-field.styles.ts";

/**
 * The number question's control in native (no-JS) submit mode. The vendored NumberField cannot serve it: its
 * visible box has no `name` and the value rides a hidden input, so a typed answer posted nothing.
 * `type="number"` posts unformatted digits, as the BFF's `Number(...)` coercion expects. Browser refusals
 * are a convenience; the kernel is the authority.
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
  readonly minValue?: number;
  readonly maxValue?: number;
  /** Absent means fractions are admitted. */
  readonly step?: number;
  /** Seeded once; uncontrolled from there on. */
  readonly defaultValue?: number;
}

// Matches the vendored `inputGroup` classes. `min-h-11` is a floor, so the control
// never collapses in a host that has not imported the theme layer.

const INPUT_CLASS = [
  "flex items-center min-h-11 w-full border border-(--color-border) rounded px-3 py-1",
  "bg-(--color-background) text-sm text-(--color-text) placeholder-(--color-text-muted)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/** `"any"` for a fractional question, because HTML's default for a missing `step` is 1. */
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
  // Both ids when both are drawn, or a screen reader hears the hint or the refusal
  // rather than both (WCAG 3.3.2, 3.3.1).
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
