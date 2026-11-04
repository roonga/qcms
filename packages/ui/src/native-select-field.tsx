import { useId } from "react";

import type { SelectItem } from "./components/a2ui/select/index.ts";
import { getSelectStyles } from "./components/a2ui/select/select.styles.ts";

/**
 * The vendored select needs JavaScript to become operable; native mode needs a visible select.
 * Its empty option supports required validation and retraction. Preserve the browser arrow affordance.
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
 * Match the immutable vendored placeholder so both renders agree.
 * Localizing it requires a compiler/corpus change or an upstream change.
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
  // Keep both hint and refusal ids so assistive technology announces both.
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
