import { useId } from "react";

import type { SelectItem } from "./components/a2ui/select/index.ts";
import { getSelectStyles } from "./components/a2ui/select/select.styles.ts";

/**
 * The single-choice question's control in native (no-JS) submit mode when the
 * question has more than seven options (issue #988).
 *
 * ## Why the vendored Select cannot serve this path
 *
 * A `singleChoice` question compiles to a `Select` above
 * `SINGLE_CHOICE_SELECT_THRESHOLD` and to a `RadioGroup` at or below it
 * (`packages/a2ui-compiler/src/mapping.ts`), so the threshold is what decides
 * whether a form meets this control at all. react-aria's Select splits one question
 * across two elements, and the one the respondent can see is not the one the form
 * posts:
 *
 * - The control they see is a `<button type="button" aria-haspopup="listbox">` whose
 *   popover listbox only JavaScript can open. With scripting off it is a dead
 *   button.
 * - The form value rides a REAL `<select name="q_...">` carrying the real options,
 *   which is what makes this the subtlest of the three cases: nothing is missing
 *   from the wire. But react-aria renders it inside a clipped, visually hidden
 *   container that is `aria-hidden="true"` and `data-react-aria-prevent-focus`, with
 *   `tabindex="-1"` on the select itself, because it exists for autofill and for the
 *   browser's own validation rather than for a human.
 *
 * Observed in jsdom on a native-mode render before this change: one
 * `<select tabindex="-1" required name="q_...">` inside
 * `<div style="position: fixed; clip: rect(0px) ..." aria-hidden="true">`. So a
 * respondent without scripting can neither see nor operate the question, and a
 * REQUIRED one is worse than unanswerable: the browser tries to report validity on
 * an unfocusable control, cannot, and abandons the whole step's submission with
 * `An invalid form control with name='q_...' is not focusable` - the same dead end
 * issue #920 documented for the DatePicker, which made every step behind the
 * question unreachable.
 *
 * ## What this renders instead
 *
 * One real, visible, focusable `<select>` under the question's own name, labelled by
 * the question's label, built from the compiled `items` in their authored order. A
 * native select rather than a stack of radios, because the compiler has already
 * decided this question is a select: rendering radios here would give the same
 * question two shapes in two transports, and the answer encoding is the OptionId
 * either way.
 *
 * - **The wire.** The renderer tags the field `string` and the BFF decoder passes
 *   the posted string through verbatim (`apps/portal/lib/server/step-form.ts`), so
 *   the chosen OptionId reaches the API as the same bytes the scripted path posts.
 *   Nothing in the decoder changed for this control.
 * - **The constraint.** HTML CAN express "one option chosen" for a select - a
 *   `required` select whose selected option has an empty value is invalid - so
 *   browser validation stays, per the Code Owner's 2026-09-13 ruling on issue #920.
 *   That is what separates this from the required multi-choice group of issue #974,
 *   where the rule is "at least one of these" and HTML has no encoding for it.
 *
 * ## The empty-valued placeholder option, which does two jobs
 *
 * The first option is always `<option value="">`, carrying the compiled
 * `placeholder` text. It is deliberately selectable rather than `disabled`:
 *
 * 1. **It is what makes a required select refusable.** HTML's own rule is that a
 *    `select` with `required` is invalid while its selected option's value is the
 *    empty string, so an untouched required question is refused by the browser on
 *    the page, with no POST, exactly as an empty required text box is.
 * 2. **It is the question's only clear gesture.** `docs/COMPONENT_GUIDELINES.md`
 *    records that a chosen radio or Select option cannot be deselected, and on the
 *    SCRIPTED path that is still true - react-aria's trigger has no clear affordance
 *    and its listbox will not deselect a chosen key. A native select with a
 *    placeholder option can be returned to it, so on this path an OPTIONAL
 *    single-choice question gains a clear: the empty value posts beside the
 *    question's `__qa__` marker and the BFF reads the pair as the ADR-33 retraction
 *    (issue #127), the same one every other cleared field produces.
 *
 * A seeded answer selects its own option through `defaultValue`, so an answered
 * question re-posts unchanged if the respondent does not touch it.
 *
 * ## Why it is qcms-owned code
 *
 * ADR-22 keeps `src/components/a2ui/**` byte-identical to upstream, so a no-JS
 * fallback cannot live inside the vendored control. It lives here and consumes the
 * vendored control's own style map, so the two renderings of one question share a
 * label, a description slot, an error slot and a token palette (ADR-30) instead of
 * agreeing by hand. The box itself is the token contract's rather than this file's:
 * `theme-components.css`'s text-entry rule now names `select`, which gives it the
 * same `--radius-control`, `--space-control-h` and `--space-control-pad-x` the free
 * text input and the two native fallbacks already take.
 *
 * Nothing here sets `appearance: none`. The browser's own disclosure arrow is the
 * affordance that says "this opens a list", and on this path there is no script to
 * draw a replacement.
 *
 * Hydration is unaffected: the portal's SSR and its first client render both paint
 * native mode, and `ProgressiveStep` swaps the whole native form for the controlled
 * `StepFlow` only after hydration (task 044, issue #121).
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
 * The select's own box. The vendored `trigger` classes draw the equivalent box
 * around the popover button, minus its interaction variants, which have no meaning
 * here: invalid is `aria-invalid` and disabled is the real attribute. `block` rather
 * than the trigger's `flex`, because a `<select>` lays its own content out and the
 * browser draws the disclosure arrow inside the same box.
 */
const SELECT_CLASS = [
  "block w-full min-w-40 min-h-11 rounded border px-3 py-2 text-sm",
  "border-(--color-border) bg-(--color-background) text-(--color-text)",
  "focus-visible:outline-2 focus-visible:outline-(--color-primary)",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-(--color-danger)",
].join(" ");

/** The vendored control's own placeholder wording, so both renderings agree. */
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
