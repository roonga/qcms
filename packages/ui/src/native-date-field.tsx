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
 * The date question's control in native (no-JS) submit mode (issue #920; segment order
 * by the Code Owner ruling of 2026-10-19, ADR-27 amendment).
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
 * ## What this renders instead: three labelled boxes, in the configured order
 *
 * A `<fieldset>` whose legend is the question's label, holding a day, a month and a
 * year box in the order `QCMS_LOCALE` writes a date (`dateSegmentOrder`), which is the
 * order react-aria's DateField draws for the same tag once the page hydrates.
 *
 * This used to be one `<input type="date">`, and that is what the 2026-10-19 ruling
 * retired. A native date input draws its parts in the BROWSER's locale and nothing in
 * the markup moves it, so the server render and the hydrated render disagreed whenever
 * the browser and the deployment did: the respondent watched day/month/year turn into
 * month/day/year as the page came alive. Three boxes are the only native markup whose
 * order the server decides. It is also the long-standing accessible pattern for a
 * memorable date (one box per part, each with its own visible label).
 *
 * ## The wire
 *
 * Each box posts under its own prefixed name (`NATIVE_DATE_PART_PREFIX`) and the field
 * is tagged with the `date` kind, so the BFF joins the three into the same
 * `YYYY-MM-DD` string the scripted path posts (`assembleNativeDate`), without knowing
 * the question (R2). An all-blank field posts nothing, which keeps the answered-marker
 * clear rule (issue #127) working unchanged.
 *
 * The question's ISO `minValue` / `maxValue` are not carried as attributes: three boxes
 * have no native way to say "on or after 1900-01-01". That is the 2026-09-19 no-JS
 * principle (functional, without rapid feedback): the API refuses an out-of-range day
 * and the step reports it after the round trip. `required` IS carried, on every box,
 * because HTML can say that.
 *
 * Granularity finer than a day is not a QCMS question - the compiler emits `"day"`
 * and nothing else - so this stays a day control.
 *
 * ## The part labels
 *
 * `Intl.DisplayNames` names each part in the configured locale, which is also the
 * language react-aria announces its own segments in under the same `I18nProvider`, so
 * the two renders of one question name their parts the same way.
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
 * `StepFlow` only after hydration (task 044, issue #121), so no attribute on these
 * elements is ever compared against a scripted render of the same question.
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
  /** ISO day bounds from the question's constraints. Enforced by the API; see above. */
  readonly minValue?: string;
  readonly maxValue?: string;
  /** The stored answer this field is seeded with; uncontrolled from there on. */
  readonly defaultValue?: string;
}

/**
 * One box. The vendored `group` classes draw the equivalent box around the segmented
 * control, minus its `data-*` state variants, which have no meaning on a native input:
 * invalid is `aria-invalid` and disabled is the real attribute.
 */
const INPUT_CLASS = [
  "flex items-center min-h-11 border border-(--color-border) rounded px-2 py-1",
  "bg-(--color-surface) text-sm text-(--color-text)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/** Width and length per part: two digits for a day or month, four for a year. */
const PART_SHAPE: Readonly<
  Record<DatePart, { readonly width: string; readonly maxLength: number }>
> = {
  day: { width: "w-20", maxLength: 2 },
  month: { width: "w-20", maxLength: 2 },
  year: { width: "w-28", maxLength: 4 },
};

/** The part's name in the given locale, first letter raised ("Day", "Month", "Year"). */
function partLabel(locale: string, part: DatePart): string {
  let name: string = part;
  try {
    name = new Intl.DisplayNames([locale], { type: "dateTimeField" }).of(part) ?? part;
  } catch {
    // A runtime without dateTimeField display names keeps the English part name.
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
      {/*
        `data-qcms-hint` is a styling anchor and nothing else (task 077). The table
        presentation clips a cell's label and hint, because both are identical in every
        cell of a column and the column header carries them once; the vendored controls
        are reachable through react-aria's own `slot="description"`, and this component
        is qcms-owned, so it says the same thing in an attribute the sheet may anchor on.
      */}
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
