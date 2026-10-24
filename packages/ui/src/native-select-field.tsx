import { useId } from "react";

import type { SelectItem } from "./components/a2ui/select/index.ts";
import { getSelectStyles } from "./components/a2ui/select/select.styles.ts";

/**
 * The single-choice question's control in native (no-JS) submit mode, for a question
 * whose option count compiles to a `Select` rather than a `RadioGroup`.
 *
 * The vendored Select cannot serve this path. What the respondent sees is a button
 * whose popover listbox only JavaScript can open, and the real `<select>` that carries
 * the value sits in a clipped, `aria-hidden`, `tabindex="-1"` container meant for
 * autofill. So the question is both invisible and inoperable, and a required one is
 * worse: the browser cannot report validity on an unfocusable control and abandons the
 * whole step's submission, which made every step behind it unreachable.
 *
 * This renders one real, visible, focusable `<select>` under the question's own name,
 * built from the compiled `items` in authored order. A native select rather than a
 * stack of radios, because the compiler already decided this question is a select and
 * the answer encoding is the OptionId either way.
 *
 * The field is tagged `string` and the BFF passes the posted value through verbatim, so
 * the chosen OptionId reaches the API as the same bytes the scripted path posts. HTML
 * can express "one option chosen" for a select, so browser validation stays here,
 * unlike the required multi-choice group where the rule has no HTML encoding.
 *
 * The first option is always `<option value="">`, selectable rather than `disabled`,
 * and it does two jobs:
 *
 * 1. It makes a required select refusable: HTML holds a `required` select invalid while
 *    its selected option's value is empty, so an untouched question never POSTs.
 * 2. It is the question's only clear gesture. A chosen radio or Select option cannot be
 *    deselected on the scripted path (docs/COMPONENT_GUIDELINES.md), but a native select
 *    can be returned to its placeholder, so the empty value posts beside the question's
 *    answered marker and the BFF reads the pair as the ADR-33 retraction.
 *
 * ADR-22 keeps the vendored components byte-identical upstream, so a no-JS fallback
 * cannot live inside one. This consumes the vendored control's own style map instead, so
 * both renderings of a question share a label, slots and the ADR-30 token palette.
 *
 * Nothing here sets `appearance: none`: the browser's own disclosure arrow is the
 * affordance that says this opens a list, and there is no script to draw a replacement.
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
  /** The compiled options, in authored order. */
  readonly items?: readonly SelectItem[];
  /** The unselected option's text; the vendored control's own default wording. */
  readonly placeholder?: string;
  /** OptionIds the compiled node marks unselectable. */
  readonly disabledKeys?: readonly string[];
  /** The stored answer this field is seeded with; uncontrolled from there on. */
  readonly defaultValue?: string;
}

/**
 * The select's own box, matching the vendored `trigger` classes minus their interaction
 * variants, which have no meaning here: invalid is `aria-invalid` and disabled is the
 * real attribute. `block` rather than the trigger's `flex`, because a `<select>` lays
 * its own content out and the browser draws the disclosure arrow inside the same box.
 */
const SELECT_CLASS = [
  "block w-full min-w-40 min-h-11 rounded border px-3 py-2 text-sm",
  "border-(--color-border) bg-(--color-background) text-(--color-text)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/**
 * The unselected option's wording when the compiled node names none.
 *
 * It restates the vendored control's own default, which ADR-22 forbids editing, so the
 * two renderings of one question say the same thing. That makes it a hardcoded English
 * user-facing string, which ADR-27 would otherwise send to the message catalogue:
 * localizing it needs either a compiler and golden-corpus change or an upstream one,
 * and until then matching the control beside it is the smaller wrong.
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
  // Both slots are named when both are drawn, so a screen reader announces the
  // hint and the refusal rather than one of them (WCAG 3.3.2, 3.3.1).
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
        // "" rather than `undefined`, so an unanswered question selects the
        // empty-valued placeholder and a required one is refused by the browser.
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
