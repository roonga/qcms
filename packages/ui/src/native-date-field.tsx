import { useId } from "react";
import { useLocale } from "react-aria-components";

import { getDatePickerStyles } from "./components/a2ui/date-picker/date-picker.styles.ts";
import {
  dateSegmentOrder,
  NATIVE_DATE_PART_PREFIX,
  splitNativeDate,
  type DatePart,
} from "./native-submit.ts";

/**
 * Native dates need focusable named controls without JavaScript; vendored segments cannot provide them.
 * Use locale-ordered boxes rather than a browser-locale date input; the API enforces bounds.
 */
export interface NativeDateFieldProps {
  /** The questionId; each box posts under it with its part prefix. */
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  readonly isInvalid?: boolean;
  /** Enforced by the API, not here. */
  readonly minValue?: string;
  readonly maxValue?: string;
  /** Seeded once; uncontrolled from there on. */
  readonly defaultValue?: string;
}

// Omit interaction-state variants that cannot apply to native inputs.

const INPUT_CLASS = [
  "flex items-center min-h-11 border border-(--color-border) rounded px-2 py-1",
  "bg-(--color-surface) text-sm text-(--color-text)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

const PART_SHAPE: Readonly<
  Record<DatePart, { readonly width: string; readonly maxLength: number }>
> = {
  day: { width: "w-20", maxLength: 2 },
  month: { width: "w-20", maxLength: 2 },
  year: { width: "w-28", maxLength: 4 },
};

function partLabel(locale: string, part: DatePart): string {
  let name: string = part;
  try {
    name = new Intl.DisplayNames([locale], { type: "dateTimeField" }).of(part) ?? part;
  } catch {
    // Keep English field names when the runtime lacks date-time display names.
  }
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export function NativeDateField({
  name,
  label,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  isReadOnly,
  isInvalid,
  defaultValue,
}: NativeDateFieldProps) {
  const styles = getDatePickerStyles();
  const { locale } = useLocale();
  const fieldId = useId();
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  const seeded = splitNativeDate(defaultValue);
  // Keep both hint and refusal ids so assistive technology announces both.
  const describedBy =
    [
      description === undefined ? undefined : descriptionId,
      errorMessage === undefined ? undefined : errorId,
    ]
      .filter((id) => id !== undefined)
      .join(" ") || undefined;

  return (
    <fieldset
      className={`${styles.root} m-0 min-w-0 border-0 p-0`}
      aria-describedby={describedBy}
      data-qcms-native-date=""
    >
      {label === undefined ? null : (
        <legend className={`${styles.label} p-0`}>
          {label}
          {isRequired === true ? (
            <span aria-hidden="true" className={styles.requiredIndicator}>
              {" "}
              *
            </span>
          ) : null}
        </legend>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {dateSegmentOrder(locale).map((part) => {
          const inputId = `${fieldId}-${part}`;
          const shape = PART_SHAPE[part];
          return (
            <div key={part} className="flex flex-col gap-1">
              <label htmlFor={inputId} className={styles.description}>
                {partLabel(locale, part)}
              </label>
              <input
                id={inputId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                data-qcms-date-part={part}
                name={name === undefined ? undefined : `${NATIVE_DATE_PART_PREFIX[part]}${name}`}
                className={`${INPUT_CLASS} ${shape.width}`}
                maxLength={shape.maxLength}
                defaultValue={seeded[part]}
                required={isRequired}
                disabled={isDisabled}
                readOnly={isReadOnly}
                aria-invalid={isInvalid === true ? true : undefined}
                aria-describedby={describedBy}
              />
            </div>
          );
        })}
      </div>
      {/* A styling anchor: the table presentation clips a cell's label and hint, which
          the column header carries once for the whole column. */}
      {description === undefined ? null : (
        <span id={descriptionId} data-qcms-hint="" className={styles.description}>
          {description}
        </span>
      )}
      {errorMessage === undefined ? null : (
        <span id={errorId} className={styles.error}>
          {errorMessage}
        </span>
      )}
    </fieldset>
  );
}
