import { createRegistry } from "@a2ra/core";
import type { ComponentRegistry } from "@a2ra/core";
import { useState } from "react";
import type { ComponentProps, FocusEvent, ReactNode } from "react";
import { FormContext } from "react-aria-components";

import { withAuthorMessages } from "./author-messages.ts";
import {
  Checkbox,
  CheckboxGroup,
  CheckboxGroupSchema,
  CheckboxSchema,
} from "./components/a2ui/checkbox/index.ts";
import type { CheckboxGroupNode } from "./components/a2ui/checkbox/index.ts";
import { DatePicker, DatePickerSchema } from "./components/a2ui/date-picker/index.ts";
import type { DatePickerNode } from "./components/a2ui/date-picker/index.ts";
import { Form, FormSchema } from "./components/a2ui/form/index.ts";
import { Flex, FlexSchema } from "./components/a2ui/layout/index.ts";
import { NumberField, NumberFieldSchema } from "./components/a2ui/number-field/index.ts";
import type { NumberFieldNode } from "./components/a2ui/number-field/index.ts";
import { Radio, RadioGroup, RadioGroupSchema, RadioSchema } from "./components/a2ui/radio/index.ts";
import type { RadioGroupNode } from "./components/a2ui/radio/index.ts";
import { Select, SelectSchema } from "./components/a2ui/select/index.ts";
import type { SelectNode } from "./components/a2ui/select/index.ts";
import { Text, TextSchema } from "./components/a2ui/text/index.ts";
import { TextArea, TextAreaSchema } from "./components/a2ui/text-area/index.ts";
import type { TextAreaNode } from "./components/a2ui/text-area/index.ts";
import { TextField, TextFieldSchema } from "./components/a2ui/text-field/index.ts";
import type { TextFieldNode } from "./components/a2ui/text-field/index.ts";
import { SubmitButton, SubmitButtonSchema } from "./components/submit/index.ts";
import type { A2UIAnswerValue } from "./field-context.tsx";
import { useQcmsField, useQcmsNativeSubmit } from "./field-context.tsx";
import { Honeypot } from "./honeypot/Honeypot.tsx";
import { HoneypotSchema } from "./honeypot/honeypot.schema.ts";
import { NativeDateField } from "./native-date-field.tsx";
import { NativeNumberField } from "./native-number-field.tsx";
import {
  NATIVE_FIELD_ANSWERED_PREFIX,
  NATIVE_FIELD_ANSWERED_VALUE,
  NATIVE_FIELD_KIND_PREFIX,
  type NativeFieldKind,
} from "./native-submit.ts";
import { toVSafePattern } from "./v-safe-pattern.ts";

/**
 * Controlled qcms adapters over the vendored a2-react-aria controls. The a2ra
 * `A2Renderer` only passes a node's compiled JSON props to its component; it has
 * no channel for the parent-owned value/error. Each adapter reaches the
 * controlled state through `useQcmsField(name)` and injects `value` (flowing
 * down), `onChange`/`isInvalid`/`errorMessage`, translating the control's raw
 * value to/from the canonical `AnswerValue` encoding for its question type. The
 * vendored components are used byte-for-byte upstream (clean `a2ra diff`,
 * ADR-22); all qcms wiring lives here.
 *
 * Clearing (issue #98): every adapter reports an emptied control as `undefined`,
 * so one gesture has one meaning at this seam and the host can post the single
 * ADR-33 retraction at that control's ADR-31 commit moment. See
 * `absentIfEmptyText` below for why an empty value is never an answer, and the
 * RadioGroup / Select adapters for the two controls that have no clear gesture.
 *
 * Native (no-JS) submit mode (task 044): when `useQcmsNativeSubmit()` is true the
 * adapters render the SAME vendored control *uncontrolled* - a `defaultValue`
 * seeded from `values` and no `onChange` - so the browser's own form
 * serialization carries the answer without any JavaScript, plus the hidden
 * marker inputs (`FieldMarkers`) that let the strict BFF decode the wire string
 * back to the canonical shape and tell a cleared field from an unanswered one
 * (see `native-submit.ts`). The default (controlled) branch is byte-identical to
 * 028/029, so the conformance snapshots are undisturbed.
 *
 * TWO adapters render a DIFFERENT control in native mode, for the same reason in
 * two shapes: the vendored control's form value does not live in the element the
 * respondent operates, so nothing they do without scripting reaches the wire.
 *
 * - **DatePicker** (issue #920): a row of JS-driven spinbutton segments nobody can
 *   type into, whose value rides an unfocusable `hidden` mirror the browser refuses
 *   to submit a required step around. Native mode renders `NativeDateField`, a real
 *   `<input type="date">` posting the same ISO day on the same field name.
 * - **NumberField** (issue #18): an unnamed visible text box beside a
 *   JavaScript-synced `<input type="hidden">`, so keystrokes are discarded and the
 *   seeded answer is what posts. Native mode renders `NativeNumberField`, a real
 *   `<input type="number">` carrying the question's own name and its compiled
 *   `min` / `max` / `step`.
 *
 * A third, the **CheckboxGroup**, keeps the vendored control and changes one thing
 * about it (issue #974): its boxes render with react-aria's ARIA encoding of
 * "required" rather than the native one, because HTML's native encoding of a
 * required group demands EVERY box. See `CheckboxGroupField` below.
 */

/** Narrows a canonical answer to the multiChoice (OptionId[]) shape. */
function isStringArray(value: A2UIAnswerValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * An emptied control reports **absence**, never an "answer of nothing" (issue
 * #98, ADR-33). One respondent gesture ("I emptied this field") must reach the
 * server with one meaning, whichever control they emptied: `undefined` here, which
 * the host posts as the ADR-33 null retraction at that control's ADR-31 commit
 * moment. Without this, the same gesture reached the API three different ways -
 * an empty-string answer from the text controls, an empty-array answer from the
 * checkbox group, a retraction from number and date - and the two "answer of
 * nothing" spellings are wrong on the merits, not merely inconsistent:
 *
 * - Nothing in the UI distinguishes "emptied" from "never answered": an empty text
 *   box and an all-unchecked group ARE the pristine rendering, so the respondent
 *   cannot mean the empty value as a value. Only an authored option ("None of the
 *   above") can say that, and that is a real OptionId, not an empty selection.
 * - An empty post is not a way to say "cleared". Where a constraint rejects the
 *   empty value (a `minLength`/`pattern` shortText, a `minSelected: 1`
 *   multiChoice - the common shapes for a required question) the post 422s, so
 *   the respondent saw "not valid" while the server quietly kept the OLD answer
 *   and Continue advanced on it: the issue-#95 defect class, reproduced for text
 *   and multiChoice.
 * - The no-JS submit path (task 044) already decodes a blank text field and an
 *   empty checkbox set to *absent* (`lib/server/step-form.ts`), so absence is
 *   already this seam's answer on the other side of it.
 *
 * The kernel now backs this seam rather than depending on it: `validateAnswer`
 * refuses `""` and `[]` outright (`EMPTY_ANSWER_NOT_ALLOWED`, ADR-33 closed in
 * issue #128's batch), so an adapter that forgot to convert would fail loudly at
 * the API instead of storing an "answer of nothing" that *satisfied* `required`.
 * Converting here is still the adapters' job - it is what makes the gesture a
 * retraction rather than an error - and this is now belt and braces, not the
 * only belt.
 *
 * `undefined` for a question with no stored answer is a server-side no-op (ADR-33),
 * so this never manufactures a tombstone for a field nobody answered.
 */
function absentIfEmptyText(value: string): string | undefined {
  return value === "" ? undefined : value.normalize("NFC");
}

/** The multiChoice counterpart: an empty selection is absence, not an empty set. */
function absentIfNoSelection(values: readonly string[]): readonly string[] | undefined {
  // Canonical multiChoice is deduplicated (task 002); RAC never emits duplicates,
  // but dedupe defensively to keep the encoding canonical.
  const selected = [...new Set(values)];
  return selected.length > 0 ? selected : undefined;
}

/**
 * The controlled "nothing is selected" value for the three single-value controls
 * (RadioGroup, Select and, since issues #148 and #549 landed upstream, DatePicker),
 * and why it is `null` rather than `undefined` or `""` (issue #144).
 *
 * react-stately's `useControlledState` decides controlled-vs-uncontrolled by
 * `value !== undefined` alone, so `value={undefined}` IS uncontrolled. Passing it
 * for "no selection" made the FIRST selection flip the same mounted control from
 * uncontrolled to controlled, and a projection that re-targeted the control at an
 * unanswered question flip it back. The reverse direction is the defect, not the
 * warning: while uncontrolled, react-stately serves its OWN last internal value in
 * place of the parent's absence, which is the issue-#95 divergence class.
 *
 * `null` is react-aria's own spelling of "no selection" for these controls
 * (`useRadioGroupState` defaults to `props.defaultValue ?? null`,
 * `useSingleSelectListState` to `props.defaultSelectedKey ?? null`), so it is
 * controlled while keeping both properties a bare `""` would break:
 *
 * - **Roving tabindex.** `useRadio` narrows the group's single tab stop to the
 *   selected radio only when `state.selectedValue != null`; with `null` no radio
 *   is selected, so the first one stays in the tab order. With `""` nothing
 *   matches and the whole group becomes keyboard-unreachable.
 * - **Option-key validity.** The select's key lookup is guarded by
 *   `selectedKey != null`, so `null` is never looked up as a key, whereas `""` is
 *   an invalid one.
 *
 * The vendored prop types used to narrow `value` to `string` while passing it
 * straight through to the react-aria-components control, whose own contract is
 * `string | null`, so the null travelled through a `null as unknown as string`
 * cast here rather than a vendored edit ADR-22 forbids. Upstream now accepts
 * `string | null` on all three controls (issue #148), and the DatePicker no longer
 * collapses every empty spelling to `undefined` internally (issue #549), so the
 * cast is gone and all three take this constant directly.
 */
const NO_SELECTION = null;

/**
 * The hidden companions that travel with one answer field in native mode, so the
 * strict BFF can decode the form-encoded post without knowing the question (R2).
 * Only emitted in native mode, and only for a control that has a questionId `name`.
 *
 * Two markers, because the wire loses two different things:
 *
 * - **`__qk__<id>`, the transport kind.** A form posts strings; the API expects a
 *   JSON boolean, a number, a string or an array. The renderer knows each control's
 *   semantics, so it says which, and the BFF coerces without judging.
 * - **`__qa__<id>`, answered-now.** Emitted only when this question currently holds
 *   an answer (issue #127). A native form posts an emptied text box exactly as it
 *   posts a never-touched one, and posts an all-unchecked checkbox group as nothing
 *   at all, so without this the BFF - which holds no answer state - had to read both
 *   as "never answered" and drop them, leaving a cleared answer standing. With it, a
 *   marked field that arrives empty is the respondent clearing it, and the BFF posts
 *   the same ADR-33 retraction the scripted path posts at that control's ADR-31
 *   commit moment.
 *
 * Presence is read from the same `values` the control is seeded from, which is what
 * keeps this a restatement of an already visible signal rather than new state: an
 * answered field is pre-filled in the HTML either way. `undefined` is the one
 * spelling of absence at this seam (`useQcmsField`), so the test is a plain
 * comparison rather than a per-kind emptiness rule.
 *
 * Both are `type="hidden"`: no box, no tab stop, no accessible name, nothing for a
 * screen reader to announce.
 */
function FieldMarkers({ name, kind }: { readonly name?: string; readonly kind: NativeFieldKind }) {
  // Called before the early return, because a conditional hook is not allowed.
  // `useQcmsField` already tolerates an undefined name.
  const field = useQcmsField(name);
  if (name === undefined) return null;
  return (
    <>
      <input type="hidden" name={`${NATIVE_FIELD_KIND_PREFIX}${name}`} value={kind} />
      {field.value === undefined ? null : (
        <input
          type="hidden"
          name={`${NATIVE_FIELD_ANSWERED_PREFIX}${name}`}
          value={NATIVE_FIELD_ANSWERED_VALUE}
        />
      )}
    </>
  );
}

/**
 * Wraps one control so consumers get (a) a touched-semantics `onBlur(name)` when
 * focus leaves the whole control, and (b) a stable focus-target handle for that
 * question. The vendored controls neither forward `onBlur` nor expose a
 * questionId-keyed DOM node, so this qcms-owned adapter supplies both: it is a
 * `display:contents` wrapper (invisible to layout, adds no box and no role, so
 * the accessibility tree is unchanged) carrying `id={name}` and
 * `data-qcms-field={name}`. The `id` lets a host app (the portal, 030) target the
 * question for focus - error-summary "jump to field" links and focus recovery
 * when a branch change removes the focused question - without guessing at each
 * control type's internal DOM. Blur ignores focus moves that stay inside the
 * control (e.g. between a NumberField's steppers).
 *
 * `name` is optional: a control compiled without a questionId (never happens for
 * a real question, but the props type allows it) simply gets no id.
 *
 * The wrapper element is handed to `onBlur` so an adapter can inspect what its
 * control currently DISPLAYS at the commit moment; the DatePicker adapter needs
 * that to see a clear react-aria never reports (see below).
 */
function FieldBlur({
  name,
  onBlur,
  children,
}: {
  readonly name?: string;
  readonly onBlur: (container: HTMLElement) => void;
  readonly children: ReactNode;
}) {
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onBlur(event.currentTarget);
    }
  };
  return (
    <div style={{ display: "contents" }} id={name} data-qcms-field={name} onBlur={handleBlur}>
      {children}
    </div>
  );
}

/**
 * Every adapter below keys its vendored control by the question's `name`, so **one
 * mounted control serves exactly one question** (issue #144).
 *
 * `A2Renderer` keys a node's children by ARRAY INDEX, so when the host swaps in
 * another step's document, or a branch change prunes a question out of the current
 * one, React reconciles the control at index i onto whatever control sat at index i
 * before: a mounted control silently starts serving a DIFFERENT question. The
 * parent-owned value follows the new question, but the vendored control's own
 * internal state does not, and that state is not always invisible. Observed on the
 * kitchen-sink fixture: Continue from an answered boolean RadioGroup to the step
 * whose singleChoice RadioGroup sat at the same index carried the previous
 * question's `lastFocusedValue` across, which left EVERY radio of the new question
 * at `tabIndex=-1` - a required question no keyboard or screen-reader respondent
 * could reach. The DatePicker carries its previous question's last complete date
 * the same way.
 *
 * Keying by questionId makes that re-target a remount, so no control's internal
 * state outlives the question it belongs to. The key is stable for the life of a
 * question, so nothing remounts while the respondent is answering. Where a remount
 * does cost focus (a question removed above the focused one), the host already
 * restores it - see `recoverFocus` in the portal's step flow (030).
 *
 * A control compiled without a questionId (never a real question, but the props
 * type allows it) keys as `undefined` for the plain `key={props.name}` adapters,
 * exactly as it reconciled before. The DatePicker's key is composite, so the same
 * control keys as the string `"undefined:0"` there; both are stable, which is all
 * the key has to be (review nit on #149, carried through #148).
 */

type TextFieldProps = NonNullable<TextFieldNode["props"]>;
function TextFieldField(props: Readonly<TextFieldProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof TextField>> = native
    ? { defaultValue: typeof field.value === "string" ? field.value : undefined }
    : {
        // "" when the parent holds no answer, so the control stays CONTROLLED
        // through a clear (`undefined` would hand react-aria its
        // controlled-to-uncontrolled path and redisplay the cleared text).
        value: typeof field.value === "string" ? field.value : "",
        onChange: (v: string) => field.setValue(absentIfEmptyText(v)),
      };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <TextField
        key={props.name}
        {...props}
        // Browsers compile the HTML `pattern` attribute with the `v` flag, which
        // rejects class-literal spellings that `u` (what the pattern was authored
        // and validated against) accepts. Normalize where that is provably
        // semantics-preserving, otherwise drop the hint - the API is the
        // validation authority (R2). See `v-safe-pattern.ts` (issue #29).
        pattern={toVSafePattern(props.pattern)}
        {...modeProps}
        isInvalid={field.error != null}
        errorMessage={field.error}
      />
      {native ? <FieldMarkers name={props.name} kind="string" /> : null}
    </FieldBlur>
  );
}

type TextAreaProps = NonNullable<TextAreaNode["props"]>;
function TextAreaField(props: Readonly<TextAreaProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof TextArea>> = native
    ? { defaultValue: typeof field.value === "string" ? field.value : undefined }
    : {
        value: typeof field.value === "string" ? field.value : "",
        onChange: (v: string) => field.setValue(absentIfEmptyText(v)),
      };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <TextArea
        key={props.name}
        {...props}
        {...modeProps}
        isInvalid={field.error != null}
        errorMessage={field.error}
      />
      {native ? <FieldMarkers name={props.name} kind="string" /> : null}
    </FieldBlur>
  );
}

type NumberFieldProps = NonNullable<NumberFieldNode["props"]>;

/**
 * The `Intl.NumberFormat` options an INTEGER number question renders with, and the
 * reason the adapter states them instead of leaving react-aria's default (issue
 * #151).
 *
 * A number question compiles to `step: 1` exactly when its author constrained it to
 * integers (`a2ui-compiler`'s `questionToNode`), and `step` is the only trace of that
 * constraint in the compiled props. react-aria reads the *format*, not the step, when
 * it decides what the field accepts and what software keyboard to ask for, and the
 * default format admits three fraction digits. So an integer-only question shipped a
 * field that accepted "2.5" while typing and snapped it to the step at commit, with a
 * decimal keypad offered on touch throughout. Declaring `maximumFractionDigits: 0`
 * makes the rendered field say what the question already meant: no fraction digits
 * are parsed, displayed, or offered.
 *
 * The hydration consequence is why this is a fix rather than a tidy-up.
 * `@react-aria/numberfield` derives the input's `inputMode` from the resolved format
 * AND from platform detection that reads `navigator`: with fraction digits allowed
 * and a non-negative minimum it asks for `decimal` on a touch device and `numeric`
 * everywhere else. A server render has no `navigator`, so it always emits `numeric`,
 * and reloading a step holding such a field raised a React hydration attribute
 * mismatch on every touch client (`inputMode="decimal"` against `inputMode="numeric"`,
 * the differing attribute in the logged diff). With no fraction digits in the format,
 * every platform branch leaves `inputMode` at `numeric`, so both renders agree by
 * construction and that mismatch is gone at its cause rather than silenced.
 *
 * WHAT THIS DOES NOT REACH, which is more than one thing (issue #945). Two attributes
 * on this same input are still decided by the environment, and neither is reachable
 * from here:
 *
 * - `inputMode` for a question that ADMITS fractions: `decimal` on touch against the
 *   server's `numeric`, and `text` on an iPhone for a question whose minimum allows
 *   negatives. No fixture form has such a question today.
 * - `aria-roledescription` for ANY number question, this integer one included:
 *   `useNumberField` sets it to "Number field" unless `isIOS()`, so the server emits it
 *   and an iOS client emits nothing. Android and desktop agree with the server, which
 *   is why the browser gate cannot see it: no project in `playwright.config.ts` is
 *   WebKit or iOS. Every iOS reload of a step holding a NumberField therefore still
 *   logs the mismatch this repository's gates do not reach.
 *
 * One reason covers both. The vendored control takes a fixed prop list and forwards
 * only `placeholder` and `className` to its `<Input>`; react-aria's `useNumberField`
 * spreads the caller's props and THEN sets `inputMode` and `aria-roledescription` from
 * its own computation; and `packages/ui/src/components/a2ui/**` must stay
 * byte-identical to upstream (ADR-22). Only a prop ON the `<Input>` wins, because that
 * is where react-aria-components merges the caller's props over the field's context. So
 * both need the same upstream passthrough in the sibling a2-react-aria checkout plus a
 * pin move, which is what #945 asks for; `number-input-mode.test.tsx` holds a
 * self-arming marker for each until it lands.
 */
const INTEGER_NUMBER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };

/**
 * Whether a compiled NumberField admits fractional input, read from `step` alone.
 *
 * A missing step is the fractional case: the compiler emits `step: 1` for an
 * integer-constrained question and nothing at all otherwise. A non-integral step
 * (nothing compiles one today, an author-authored document could) is fractional too.
 */
export function numberFieldAdmitsFractions(step: number | undefined): boolean {
  return step === undefined || !Number.isInteger(step);
}

/**
 * The second adapter whose native-submit rendering is a DIFFERENT control rather
 * than the same vendored one left uncontrolled (issue #18, Code Owner ruling
 * 2026-09-19).
 *
 * The vendored NumberField splits one question across an unnamed visible
 * `<input type="text">` and a JavaScript-synced `<input type="hidden">` that
 * carries the form value, so with scripting off the respondent's keystrokes are
 * never serialized and the field posts what the server seeded it with.
 * `NativeNumberField` carries the reasoning and the wire contract; the scripted
 * branch below is untouched, and neither branch edits a vendored byte (ADR-22).
 */
function NumberFieldField(props: Readonly<NumberFieldProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();

  if (native) {
    return (
      <FieldBlur name={props.name} onBlur={field.blur}>
        <NativeNumberField
          name={props.name}
          label={props.label}
          description={props.description}
          isRequired={props.isRequired}
          isDisabled={props.isDisabled}
          isReadOnly={props.isReadOnly}
          minValue={props.minValue}
          maxValue={props.maxValue}
          step={props.step}
          defaultValue={typeof field.value === "number" ? field.value : undefined}
          isInvalid={field.error != null}
          errorMessage={field.error}
        />
        <FieldMarkers name={props.name} kind="number" />
      </FieldBlur>
    );
  }

  const modeProps: Partial<ComponentProps<typeof NumberField>> = {
    value: typeof field.value === "number" ? field.value : Number.NaN,
    onChange: (n: number) => field.setValue(Number.isNaN(n) ? undefined : n),
  };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <NumberField
        key={props.name}
        {...props}
        {...modeProps}
        formatOptions={numberFieldAdmitsFractions(props.step) ? undefined : INTEGER_NUMBER_FORMAT}
        isInvalid={field.error != null}
        errorMessage={field.error}
      />
    </FieldBlur>
  );
}

/**
 * Whether the segmented date input inside `container` currently DISPLAYS a
 * complete date. Every editable segment showing its placeholder (`mm`, `dd`,
 * `yyyy`) means the respondent has cleared or half-cleared the field.
 *
 * `data-placeholder` and `data-type` are react-aria-components' documented
 * styling hooks on `DateSegment`, read here from qcms-owned code; the vendored
 * component stays byte-faithful to upstream (ADR-22). A DOM read is the only
 * signal available: react-aria emits `onChange` when a date becomes *complete*
 * and when *every* segment is cleared, but emits nothing at all in between, so a
 * complete date backspaced to a partial one (`1990-05-17` -> `mm/1/199`) is
 * invisible to the controlled value (issue #95, cause A).
 *
 * A container with no segments at all (no date input rendered) reports complete:
 * absence of evidence never manufactures a retraction.
 */
function dateInputIsComplete(container: HTMLElement): boolean {
  const segments = Array.from(container.querySelectorAll<HTMLElement>("[data-type]"));
  return segments.every(
    (segment) => segment.dataset["type"] === "literal" || !segment.hasAttribute("data-placeholder"),
  );
}

type DatePickerProps = NonNullable<DatePickerNode["props"]>;

/**
 * The one adapter whose native-submit rendering is a DIFFERENT control rather than
 * the same vendored one left uncontrolled (issue #920).
 *
 * Every other adapter can go uncontrolled because its vendored control is a real
 * form element underneath. The DatePicker is not: it is a row of JS-driven
 * `role="spinbutton"` segments a no-JS respondent cannot type into, and its form
 * value rides on an `<input type="text" hidden required>` the browser tries to
 * report validity on and cannot focus - so Chrome refused the whole step's submit
 * (`An invalid form control with name='q_dob' is not focusable`) and a required date
 * was a no-JS dead end. `NativeDateField` carries the reasoning and the wire
 * contract; the scripted branch below is untouched, and neither branch edits a
 * vendored byte (ADR-22).
 */
function DatePickerField(props: Readonly<DatePickerProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  // Bumped only when a clear is observed, so the vendored control remounts with
  // the parent's now-empty value. Without the remount react-aria falls back to
  // its own last complete value the moment `value` goes undefined (its
  // controlled-to-uncontrolled path), redisplaying the date the respondent just
  // cleared. Never bumped while the respondent is typing, so entry is undisturbed.
  const [clearedGeneration, setClearedGeneration] = useState(0);

  /**
   * The ADR-31 date commit moment: editing ends. Commit whatever the control
   * shows - a complete date it already reported through `onChange`, or the clear
   * it could not report, which is a retraction of the stored answer (ADR-33).
   */
  const commit = (container: HTMLElement): void => {
    if (typeof field.value === "string" && !dateInputIsComplete(container)) {
      setClearedGeneration((generation) => generation + 1);
      // The value change IS the commit; `blur` is deliberately not also fired,
      // so a host that posts on blur cannot re-post the stale value behind it.
      field.setValue(undefined);
      return;
    }
    field.blur();
  };

  if (native) {
    return (
      <FieldBlur name={props.name} onBlur={field.blur}>
        <NativeDateField
          name={props.name}
          label={props.label}
          description={props.description}
          isRequired={props.isRequired}
          isDisabled={props.isDisabled}
          isReadOnly={props.isReadOnly}
          minValue={props.minValue}
          maxValue={props.maxValue}
          defaultValue={typeof field.value === "string" ? field.value : undefined}
          isInvalid={field.error != null}
          errorMessage={field.error}
        />
        <FieldMarkers name={props.name} kind="string" />
      </FieldBlur>
    );
  }

  const modeProps: Partial<ComponentProps<typeof DatePicker>> = {
    // `NO_SELECTION` (null, never "" and never `undefined`) when unanswered, so
    // the date stays CONTROLLED like every other adapter here. This used to be
    // the one control that could not take it: the vendored body was
    // `value ? parseDate(value) : undefined`, which collapsed every empty
    // spelling to `undefined` (react-stately's uncontrolled path) no matter what
    // was passed, leaving one uncontrolled-to-controlled flip per answered date at
    // this seam (issue #144). Issues #148 and #549 fixed that upstream, so an
    // empty value now reaches react-aria as `null`, and a stored value
    // `parseDate` cannot parse renders unselected instead of throwing during
    // render.
    value: typeof field.value === "string" ? field.value : NO_SELECTION,
    onChange: (s: string) => field.setValue(s === "" ? undefined : s),
  };
  return (
    <FieldBlur name={props.name} onBlur={commit}>
      <DatePicker
        key={`${props.name}:${clearedGeneration}`}
        {...props}
        {...modeProps}
        isInvalid={field.error != null}
        errorMessage={field.error}
      />
    </FieldBlur>
  );
}

type RadioGroupProps = NonNullable<RadioGroupNode["props"]> & { readonly children?: ReactNode };
function RadioGroupField(props: RadioGroupProps) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  // boolean questions and singleChoice questions both compile to RadioGroup
  // (a2ui-mapping.md): boolean radios carry the string values "true"/"false",
  // singleChoice radios carry OptionIds ("opt_…"). Detect by the value shape so
  // onChange emits a JSON boolean for the former and an OptionId for the latter.
  // No selection → `NO_SELECTION` (null, never "") in controlled mode, which keeps
  // the group CONTROLLED while leaving RAC's roving tabindex on the first radio; a
  // bare "" would leave the group unreachable, and `undefined` reads as
  // uncontrolled (see `NO_SELECTION`). Native mode keeps `undefined`, because the
  // vendored control seeds a2ra's form state from any defined `defaultValue`.
  //
  // A RadioGroup has **no clear gesture** to audit (issue #98): a selected radio
  // cannot be toggled off - re-clicking it, or pressing Delete / Backspace /
  // Escape / Space on it, all leave it selected, and react-aria emits no change.
  // An author who wants "prefer not to say" gives the question that OPTION; it is
  // a real answer, not a clear. So a boolean or singleChoice question can only go
  // from unanswered to answered, or from one answer to another, and the only path
  // back to unanswered is whole-session erasure (out of scope, ADR-33).
  let controlValue: string | undefined;
  if (field.value === undefined) {
    controlValue = undefined;
  } else if (typeof field.value === "boolean") {
    controlValue = field.value ? "true" : "false";
  } else {
    controlValue = String(field.value);
  }
  const emitChange = (v: string): void => {
    if (v === "true") {
      field.setValue(true);
    } else if (v === "false") {
      field.setValue(false);
    } else {
      field.setValue(v);
    }
  };
  const modeProps: Partial<ComponentProps<typeof RadioGroup>> = native
    ? { defaultValue: controlValue }
    : { value: controlValue ?? NO_SELECTION, onChange: emitChange };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <RadioGroup
        key={props.name}
        {...props}
        {...modeProps}
        isInvalid={field.error != null}
        errorMessage={field.error}
      />
      {native ? <FieldMarkers name={props.name} kind="radio" /> : null}
    </FieldBlur>
  );
}

type CheckboxGroupProps = NonNullable<CheckboxGroupNode["props"]> & {
  readonly children?: ReactNode;
};

/**
 * What a required multi-choice group says about itself in native (no-JS) submit
 * mode (issue #974, Code Owner ruling 2026-09-19).
 *
 * ## The dead end this removes
 *
 * HTML has no "at least one of these" constraint. react-aria encodes the rule by
 * putting native `required` on EVERY checkbox in a required group and taking it off
 * the moment something is selected (the vendored `Checkbox.tsx` comment says so).
 * Taking it off is a re-render, which is scripting, so the server-rendered HTML
 * freezes `required` on all of them - and native `required` on a checkbox means
 * THAT box must be checked. Observed on the kitchen sink's "Which optional cover do
 * you want?": one of three checked and Chrome refuses the submit with no POST
 * leaving the page; all three checked and it submits. Every step behind that one was
 * unreachable without scripting.
 *
 * The ruling: the boxes render without the native attribute, and a group left blank
 * is reported by the server after the round trip, through the missing-required path
 * issue #964 built. The principle behind it, recorded on #974, is that JavaScript is
 * assumed and the no-JS form is a fallback that must work FUNCTIONALLY, without
 * rapid feedback. Browser validation is unchanged everywhere HTML can carry the
 * rule (the 2026-09-13 ruling on issue #920 stands); it is dropped here because HTML
 * cannot carry this one.
 *
 * ## Why this seam, and not one of the other three
 *
 * `validationBehavior` is the switch react-aria itself provides between the two
 * encodings of a required field - `required` under `"native"`, `aria-required`
 * under `"aria"` (`@react-aria/toggle`'s `useToggle`) - and it is resolved PER
 * CHECKBOX from `props.validationBehavior ?? FormContext ?? "native"`
 * (`react-aria-components`' `Checkbox`). So:
 *
 * - **Passing it to the vendored `CheckboxGroup` does nothing.** The group's value
 *   reaches `useCheckboxGroupItem`, but the RAC `Checkbox` has already resolved its
 *   own and passes it explicitly, where it wins. Verified in jsdom, not assumed.
 * - **Passing it to each `Checkbox`** is not available: the boxes are compiled child
 *   nodes rendered by `A2Renderer`, and reaching into them would mean cloning
 *   elements this adapter does not own.
 * - **Dropping `isRequired` from the group** would take the label's required marker,
 *   `data-required` and the ARIA encoding with it, leaving a required question that
 *   never says it is required.
 *
 * So the adapter provides RAC's own `FormContext` for this group's subtree alone.
 * Its scope is the provider's children, which is proved rather than assumed
 * (`packages/ui/src/native-multi-choice.test.tsx` asserts that the two required
 * controls beside the group on the same step - a RadioGroup, which reads the same
 * context, and the native number input - both keep native `required`), so every
 * other control on the step keeps browser validation exactly as the #920 ruling
 * left it.
 *
 * What the respondent is left with is react-aria's OWN ARIA encoding of the same
 * rule: the group keeps its label marker and `data-required`, each box carries
 * `aria-required` for as long as none is selected, and nothing blocks the submit.
 * The constraint is enforced where it can be - the API's `MISSING_REQUIRED` sweep -
 * and reported back onto the step.
 *
 * Only the value is overridden, not merged with an enclosing `FormContext`: the only
 * other thing that context carries is `validationErrors`, RAC's server-validation
 * channel, which the compiler never emits on a `Form` node and which QCMS does not
 * use - errors reach a control through `useQcmsField`.
 */
const NATIVE_GROUP_VALIDATION = { validationBehavior: "aria" } as const;

function CheckboxGroupField(props: CheckboxGroupProps) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof CheckboxGroup>> = native
    ? { defaultValue: isStringArray(field.value) ? [...field.value] : undefined }
    : {
        // [] when the parent holds no answer, so the group stays CONTROLLED
        // through a clear (the TextField note above applies here too).
        value: isStringArray(field.value) ? [...field.value] : [],
        onChange: (values: string[]) => field.setValue(absentIfNoSelection(values)),
      };
  const group = (
    <CheckboxGroup
      key={props.name}
      {...props}
      {...modeProps}
      isInvalid={field.error != null}
      errorMessage={field.error}
    />
  );
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      {native ? (
        <FormContext.Provider value={NATIVE_GROUP_VALIDATION}>{group}</FormContext.Provider>
      ) : (
        group
      )}
      {native ? <FieldMarkers name={props.name} kind="multi" /> : null}
    </FieldBlur>
  );
}

type SelectProps = NonNullable<SelectNode["props"]>;
function SelectField(props: Readonly<SelectProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof Select>> = native
    ? { defaultValue: typeof field.value === "string" ? field.value : undefined }
    : {
        // NO_SELECTION (null, never "") when unselected: "" is not a valid option
        // key and breaks RAC's selection manager, and `undefined` reads as
        // uncontrolled. See `NO_SELECTION`.
        value: typeof field.value === "string" ? field.value : NO_SELECTION,
        // Like the RadioGroup, a Select (singleChoice above the compiler's option
        // threshold) has **no clear gesture** to audit: the vendored trigger has no
        // clear button, and RAC does not let a chosen key be deselected. The
        // upstream `onSelectionChange` is nonetheless typed `Key | null` and the
        // vendored component narrows it with a cast, so accept the empty case here
        // and report it as absence: were react-aria ever to emit one, it would
        // reach the API as an ADR-33 retraction like every other clear, never as a
        // `null` travelling as though it were an `AnswerValue` (issue #98).
        onChange: (v: string | null) => field.setValue(v === null || v === "" ? undefined : v),
      };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <Select
        key={props.name}
        {...props}
        {...modeProps}
        isInvalid={field.error != null}
        errorMessage={field.error}
      />
      {native ? <FieldMarkers name={props.name} kind="string" /> : null}
    </FieldBlur>
  );
}

/**
 * The lean, explicit registry - only the components the compiler emits
 * (a2ui-mapping.md) plus the qcms `Honeypot` node (task 026) and the
 * render-time-only `SubmitButton` used by native submit mode (task 044). Never
 * `defaultRegistry` (ADR-22): a smaller, auditable surface. `strict` means the
 * a2ra renderer validates every node against its schema before rendering.
 *
 * Structural nodes (Form/Flex/Text) and the choice leaves (Radio/Checkbox) are
 * the vendored components verbatim; the interactive controls are the qcms
 * controlled adapters above.
 *
 * Each question control's schema is wrapped in `withAuthorMessages` (task 048,
 * ADR-32): the compiler may put the author's per-constraint wording on the
 * control node as a `messages` prop, and the vendored props objects are
 * `.strict()`, so the wrapper is what lets a node carrying it validate at all.
 * The choice leaves and the structural nodes never carry it - a message belongs
 * to a question, and a question is one control.
 */
function buildV1Registry(): ComponentRegistry {
  return createRegistry(
    {
      Form: { component: Form, schema: FormSchema },
      Flex: { component: Flex, schema: FlexSchema },
      Text: { component: Text, schema: TextSchema },
      TextField: { component: TextFieldField, schema: withAuthorMessages(TextFieldSchema) },
      TextArea: { component: TextAreaField, schema: withAuthorMessages(TextAreaSchema) },
      NumberField: { component: NumberFieldField, schema: withAuthorMessages(NumberFieldSchema) },
      DatePicker: { component: DatePickerField, schema: withAuthorMessages(DatePickerSchema) },
      RadioGroup: { component: RadioGroupField, schema: withAuthorMessages(RadioGroupSchema) },
      Radio: { component: Radio, schema: RadioSchema },
      CheckboxGroup: {
        component: CheckboxGroupField,
        schema: withAuthorMessages(CheckboxGroupSchema),
      },
      Checkbox: { component: Checkbox, schema: CheckboxSchema },
      Select: { component: SelectField, schema: withAuthorMessages(SelectSchema) },
      Honeypot: { component: Honeypot, schema: HoneypotSchema },
      SubmitButton: { component: SubmitButton, schema: SubmitButtonSchema },
    },
    { strict: true },
  );
}

const V1_REGISTRY = buildV1Registry();

/**
 * `specVersion` dispatch seam (ADR-18). Every A2UI spec version ever published
 * must keep rendering; today the corpus is a single generation (schemas of the
 * pinned `@a2ra/core`), so all versions resolve to the v1 registry. A future
 * breaking spec version branches here - rendered alongside v1, never migrating
 * stored snapshots.
 */
export function registryForSpecVersion(specVersion?: string): ComponentRegistry {
  // eslint-disable-next-line sonarjs/void-use -- intentional discard of an as-yet-unused parameter; the ADR-18 spec-version dispatch seam
  void specVersion; // single generation today; the parameter is the ADR-18 seam
  return V1_REGISTRY;
}
