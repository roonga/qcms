import { useId } from "react";

import type { SelectItem } from "./components/a2ui/select/index.ts";
import { getSelectStyles } from "./components/a2ui/select/select.styles.ts";

/**
 * The single-choice control in native (no-JS) submit mode. The vendored Select cannot serve it: its `<select>`
 * sits in an `aria-hidden` container behind a trigger only JavaScript opens.
 * The empty-valued first option keeps an untouched `required` select invalid and, posted beside the answered
 * marker, is the ADR-33 retraction. No `appearance: none`: the browser's arrow is the only affordance.
 */
export interface NativeSelectFieldProps {
  /** The questionId, which is the posted field name. */
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly isInvalid?: boolean;
  /** In authored order. */
  readonly items?: readonly SelectItem[];
  readonly placeholder?: string;
  readonly disabledKeys?: readonly string[];
  /** Seeded once; uncontrolled from there on. */
  readonly defaultValue?: string;
}

// Matches the vendored `trigger` classes, minus interaction variants with no meaning
// here. `block` rather than its `flex`, because a `<select>` lays its own content out.

const SELECT_CLASS = [
  "block w-full min-w-40 min-h-11 rounded border px-3 py-2 text-sm",
  "border-(--color-border) bg-(--color-background) text-(--color-text)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/**
 * Restates the vendored control's own default, which ADR-22 forbids editing, so both
 * renderings of a question say the same thing. That makes it a hardcoded user-facing
 * string which ADR-27 would otherwise localize, and localizing it needs a compiler and
 * golden-corpus change or an upstream one.
 */
export const NATIVE_SELECT_PLACEHOLDER = "Select an option";

export function NativeSelectField({
  name,
  label,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  isInvalid,
  items,
  placeholder,
  disabledKeys,
  defaultValue,
}: NativeSelectFieldProps) {
  const styles = getSelectStyles();
  const selectId = useId();
  const descriptionId = `${selectId}-description`;
  const errorId = `${selectId}-error`;
  // Both ids when both are drawn, or a screen reader hears the hint or the refusal
  // rather than both (WCAG 3.3.2, 3.3.1).
  const describedBy =
    [
      description === undefined ? undefined : descriptionId,
      errorMessage === undefined ? undefined : errorId,
    ]
      .filter((id) => id !== undefined)
      .join(" ") || undefined;
  const disabled = new Set(disabledKeys ?? []);

  return (
    <div className={styles.field}>
      {label === undefined ? null : (
        <label htmlFor={selectId} className={styles.label}>
          {label}
          {isRequired === true ? (
            <span aria-hidden="true" className={styles.requiredIndicator}>
              {" "}
              *
            </span>
          ) : null}
        </label>
      )}
      <select
        id={selectId}
        name={name}
        className={SELECT_CLASS}
        // Not `undefined`, or an unanswered question would not select the
        // empty-valued placeholder and a required one would not be refused.
        defaultValue={defaultValue ?? ""}
        required={isRequired}
        disabled={isDisabled}
        aria-invalid={isInvalid === true ? true : undefined}
        aria-describedby={describedBy}
      >
        <option value="">{placeholder ?? NATIVE_SELECT_PLACEHOLDER}</option>
        {(items ?? []).map((item) => (
          <option
            key={item.value}
            value={item.value}
            disabled={item.isDisabled === true || disabled.has(item.value)}
          >
            {item.label}
          </option>
        ))}
      </select>
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
