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
import { FormSchema } from "./components/a2ui/form/index.ts";
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
import { FormField } from "./form-field.tsx";
import { Honeypot } from "./honeypot/Honeypot.tsx";
import { HoneypotSchema } from "./honeypot/honeypot.schema.ts";
import { NativeDateField } from "./native-date-field.tsx";
import { NativeNumberField } from "./native-number-field.tsx";
import { NativeSelectField } from "./native-select-field.tsx";
import { RepeatCell } from "./repeat/RepeatCell.tsx";
import { RepeatGroup } from "./repeat/RepeatGroup.tsx";
import { RepeatInstance } from "./repeat/RepeatInstance.tsx";
import { RepeatRow } from "./repeat/RepeatRow.tsx";
import { RepeatTable } from "./repeat/RepeatTable.tsx";
import { RepeatGroupSchema, RepeatInstanceSchema } from "./repeat/repeat.schema.ts";
import {
  RepeatCellSchema,
  RepeatRowSchema,
  RepeatTableSchema,
} from "./repeat/repeat-table.schema.ts";
import {
  NATIVE_FIELD_ANSWERED_PREFIX,
  NATIVE_FIELD_ANSWERED_VALUE,
  NATIVE_FIELD_KIND_PREFIX,
  type NativeFieldKind,
} from "./native-submit.ts";
import { toVSafePattern } from "./v-safe-pattern.ts";

/**
 * Controlled qcms adapters over the vendored a2-react-aria controls.
 *
 * `A2Renderer` passes a node's compiled JSON props to its component and has no channel
 * for the parent-owned value or error, so each adapter reaches the controlled state
 * through `useQcmsField(name)` and translates the control's raw value to and from the
 * canonical `AnswerValue` encoding for its question type. The vendored components stay
 * byte-identical upstream (ADR-22), so all qcms wiring lives here.
 *
 * Every adapter reports an emptied control as `undefined`, so one respondent gesture
 * has one meaning at this seam and the host posts a single ADR-33 retraction at the
 * control's ADR-31 commit moment.
 *
 * In native (no-JS) submit mode the adapters render the same vendored control
 * uncontrolled, seeded from `values` with no `onChange`, so native form serialization
 * carries the answer, plus the hidden `FieldMarkers` the BFF decodes with. The
 * controlled branch is unchanged, so the conformance snapshots are undisturbed.
 *
 * Three adapters render a different control in native mode (DatePicker, NumberField,
 * Select), because the vendored control's form value does not live in the element the
 * respondent operates, so nothing they do without scripting reaches the wire. A fourth,
 * the CheckboxGroup, keeps the vendored control and swaps its required encoding. Each
 * carries its own reason below.
 */

function isStringArray(value: A2UIAnswerValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * An emptied control reports absence, never an answer of nothing (ADR-33).
 *
 * Nothing in the UI distinguishes emptied from never answered: an empty text box is the
 * pristine rendering, so the respondent cannot mean the empty value as a value, and only
 * an authored option can say that. An empty post is not a way to say cleared either:
 * where a constraint rejects it the post 422s, so the respondent sees a refusal while
 * the server keeps the old answer and Continue advances on it.
 *
 * The kernel backs this rather than depending on it, refusing `""` and `[]` outright, so
 * an adapter that forgot to convert fails loudly at the API. `undefined` for a question
 * with no stored answer is a server-side no-op, so this never manufactures a tombstone.
 */
function absentIfEmptyText(value: string): string | undefined {
  return value === "" ? undefined : value.normalize("NFC");
}

/** The multiChoice counterpart: an empty selection is absence, not an empty set. */
function absentIfNoSelection(values: readonly string[]): readonly string[] | undefined {
  // Canonical multiChoice is deduplicated; RAC never emits duplicates, but dedupe
  // defensively to keep the encoding canonical.
  const selected = [...new Set(values)];
  return selected.length > 0 ? selected : undefined;
}

/**
 * The controlled "nothing is selected" value for the single-value controls (RadioGroup,
 * Select, DatePicker), as `null` rather than `undefined` or `""`.
 *
 * react-stately decides controlled against uncontrolled by `value !== undefined` alone,
 * so `undefined` is uncontrolled, and while uncontrolled it serves its own last internal
 * value in place of the parent's absence.
 *
 * `null` is react-aria's own spelling of no selection for these controls, and it keeps
 * two properties a bare `""` would break:
 *
 * - Roving tabindex: `useRadio` narrows the group's tab stop to the selected radio only
 *   when `selectedValue != null`, so with `""` nothing matches and the whole group
 *   becomes keyboard-unreachable.
 * - Option-key validity: the select's key lookup is guarded by `selectedKey != null`,
 *   whereas `""` is looked up as an invalid key.
 */
const NO_SELECTION = null;

/**
 * The hidden companions that travel with one answer field in native mode, so the BFF
 * can decode the form-encoded post without knowing the question (R2).
 *
 * `__qk__<id>` carries the transport kind, because a form posts strings and the API
 * expects a JSON boolean, number, string or array. `__qa__<id>` marks the question as
 * currently answered, because a native form posts an emptied field exactly as it posts a
 * never-touched one: a marked field arriving empty is the respondent clearing it, and
 * the BFF posts the same ADR-33 retraction the scripted path does.
 *
 * Presence is read from the same `values` the control is seeded from, so this restates
 * an already visible signal rather than adding state. Both inputs are `type="hidden"`:
 * no box, no tab stop, no accessible name.
 */
function FieldMarkers({ name, kind }: { readonly name?: string; readonly kind: NativeFieldKind }) {
  // Called before the early return, because a conditional hook is not allowed.
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
 * Wraps one control to supply a touched-semantics `onBlur(name)` and a stable
 * focus-target handle for the question, neither of which the vendored controls offer.
 *
 * It is a `display:contents` wrapper, so it adds no box and no role and the
 * accessibility tree is unchanged, carrying `id={name}` and `data-qcms-field={name}`.
 * The `id` lets a host target the question for focus (error-summary jump links, focus
 * recovery when a branch change removes the focused question) without guessing at each
 * control type's internal DOM. Blur ignores focus moves that stay inside the control.
 *
 * The wrapper element is handed to `onBlur` so an adapter can inspect what its control
 * currently displays at the commit moment, which the DatePicker adapter needs.
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
 * Every adapter below keys its vendored control by the question's `name`, so one
 * mounted control serves exactly one question.
 *
 * `A2Renderer` keys a node's children by array index, so swapping in another step's
 * document, or pruning a question out of the current one, reconciles the control at
 * index i onto whatever sat there before: a mounted control starts serving a different
 * question. The parent-owned value follows, but the vendored control's internal state
 * does not, and that state is visible. A RadioGroup carried the previous question's
 * `lastFocusedValue` across, leaving every radio at `tabIndex=-1` and the question
 * unreachable by keyboard or screen reader; the DatePicker carries a stale date.
 *
 * Keying by questionId makes that re-target a remount, and the key is stable for the
 * life of a question, so nothing remounts while the respondent is answering.
 */

type TextFieldProps = NonNullable<TextFieldNode["props"]>;
function TextFieldField(props: Readonly<TextFieldProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof TextField>> = native
    ? { defaultValue: typeof field.value === "string" ? field.value : undefined }
    : {
        // "" when the parent holds no answer, so the control stays controlled through a
        // clear: `undefined` takes react-aria's uncontrolled path and redisplays the
        // cleared text.
        value: typeof field.value === "string" ? field.value : "",
        onChange: (v: string) => field.setValue(absentIfEmptyText(v)),
      };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <TextField
        key={props.name}
        {...props}
        // Browsers compile the HTML `pattern` attribute with the `v` flag, which rejects
        // class-literal spellings the authored `u` flag accepts. Normalize where that is
        // provably semantics-preserving, otherwise drop the hint: the API is the
        // validation authority (R2).
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
 * The `Intl.NumberFormat` options an integer number question renders with, rather than
 * react-aria's default.
 *
 * react-aria reads the format, not `step`, when deciding what the field accepts and what
 * software keyboard to ask for, and its default format admits three fraction digits, so
 * an integer-only question accepted "2.5" while typing and offered a decimal keypad.
 *
 * It also fixes a hydration mismatch: `@react-aria/numberfield` derives `inputMode` from
 * the resolved format and from platform detection that reads `navigator`, so with
 * fraction digits allowed it asks for `decimal` on touch while a server render, having no
 * `navigator`, always emits `numeric`. With no fraction digits every platform branch
 * leaves `inputMode` at `numeric` and both renders agree by construction.
 *
 * `inputMode` for a question that admits fractions, and `aria-roledescription` on any
 * number question, are still environment-derived and not reachable from here: the
 * vendored control forwards a fixed prop list, `useNumberField` sets both after
 * spreading the caller's props, and only a prop on the `<Input>` would win, which needs
 * an upstream passthrough (ADR-22). `number-input-mode.test.tsx` holds a self-arming
 * marker for each.
 */
const INTEGER_NUMBER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };

/**
 * Whether a compiled NumberField admits fractional input, read from `step` alone: the
 * compiler emits `step: 1` for an integer-constrained question and nothing otherwise, so
 * a missing or non-integral step is the fractional case.
 */
export function numberFieldAdmitsFractions(step: number | undefined): boolean {
  return step === undefined || !Number.isInteger(step);
}

/**
 * Native mode renders a different control here: the vendored NumberField splits one
 * question across an unnamed visible text input and a JavaScript-synced hidden input
 * that carries the form value, so with scripting off keystrokes are never serialized.
 * `NativeNumberField` carries the wire contract.
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
 * Whether the segmented date input inside `container` currently displays a complete
 * date.
 *
 * A DOM read of react-aria's documented `data-placeholder` and `data-type` styling
 * hooks is the only signal available: react-aria emits `onChange` when a date becomes
 * complete and when every segment is cleared, and nothing in between, so a complete
 * date backspaced to a partial one is invisible to the controlled value.
 *
 * A container with no segments reports complete: absence of evidence never manufactures
 * a retraction.
 */
function dateInputIsComplete(container: HTMLElement): boolean {
  const segments = Array.from(container.querySelectorAll<HTMLElement>("[data-type]"));
  return segments.every(
    (segment) => segment.dataset["type"] === "literal" || !segment.hasAttribute("data-placeholder"),
  );
}

type DatePickerProps = NonNullable<DatePickerNode["props"]>;

/**
 * Native mode renders a different control here: the vendored DatePicker is a row of
 * JS-driven spinbutton segments a no-JS respondent cannot type into, and its form value
 * rides on a `hidden required` input the browser tries to report validity on and cannot
 * focus, so a required date made the browser refuse the whole step's submit.
 * `NativeDateField` carries the wire contract.
 */
function DatePickerField(props: Readonly<DatePickerProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  // Bumped only when a clear is observed, so the vendored control remounts with the
  // parent's now-empty value: without the remount react-aria takes its uncontrolled
  // path and redisplays the date the respondent just cleared. Never bumped while they
  // are typing, so entry is undisturbed.
  const [clearedGeneration, setClearedGeneration] = useState(0);

  /**
   * The ADR-31 date commit moment: commit whatever the control shows, which is either a
   * complete date already reported through `onChange` or the clear it could not report,
   * an ADR-33 retraction of the stored answer.
   */
  const commit = (container: HTMLElement): void => {
    if (typeof field.value === "string" && !dateInputIsComplete(container)) {
      setClearedGeneration((generation) => generation + 1);
      // The value change is the commit; `blur` is deliberately not also fired, so a host
      // that posts on blur cannot re-post the stale value behind it.
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
        <FieldMarkers name={props.name} kind="date" />
      </FieldBlur>
    );
  }

  const modeProps: Partial<ComponentProps<typeof DatePicker>> = {
    // `NO_SELECTION` when unanswered, so the date stays controlled like every other
    // adapter here, and a stored value `parseDate` cannot parse renders unselected
    // rather than throwing during render.
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
  // boolean and singleChoice questions both compile to RadioGroup, carrying
  // "true"/"false" and OptionIds respectively, so the value shape is what decides
  // whether onChange emits a JSON boolean or an OptionId. Native mode keeps `undefined`,
  // because the vendored control seeds a2ra's form state from any defined
  // `defaultValue`.
  //
  // A RadioGroup has no clear gesture: a selected radio cannot be toggled off and
  // react-aria emits no change for any attempt. An author who wants "prefer not to say"
  // gives the question that option, which is a real answer. So the only path back to
  // unanswered is whole-session erasure (ADR-33).
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
 * How a required multi-choice group states its rule in native (no-JS) submit mode.
 *
 * HTML has no "at least one of these" constraint. react-aria encodes it by putting
 * native `required` on every checkbox and removing it once something is selected, but
 * that removal is a re-render, so the server-rendered HTML freezes `required` on all of
 * them, and native `required` on a checkbox means that box must be checked. The browser
 * then refused the submit for any partial selection, making every later step
 * unreachable without scripting.
 *
 * So the boxes render with react-aria's ARIA encoding instead, and a blank group is
 * reported by the server after the round trip. Browser validation is unchanged wherever
 * HTML can carry the rule; it is dropped here because HTML cannot carry this one.
 *
 * `validationBehavior` is react-aria's own switch between the two encodings, resolved
 * per checkbox from `props ?? FormContext ?? "native"`, which rules out the three other
 * seams: on the vendored `CheckboxGroup` it loses to the value each RAC `Checkbox`
 * resolves for itself; on each `Checkbox` it is unreachable, since the boxes are
 * compiled child nodes this adapter does not own; and dropping `isRequired` would take
 * the label marker and the ARIA encoding with it. Hence a `FormContext` over this
 * group's subtree alone, with every other control on the step unaffected.
 *
 * Only the value is overridden rather than merged with an enclosing `FormContext`: the
 * only other thing that context carries is `validationErrors`, which QCMS does not use,
 * since errors reach a control through `useQcmsField`.
 */
const NATIVE_GROUP_VALIDATION = { validationBehavior: "aria" } as const;

function CheckboxGroupField(props: CheckboxGroupProps) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof CheckboxGroup>> = native
    ? { defaultValue: isStringArray(field.value) ? [...field.value] : undefined }
    : {
        // [] when the parent holds no answer, so the group stays controlled through a
        // clear, as with the TextField above.
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

/**
 * Native mode renders a different control here. Nothing is missing from the wire: the
 * vendored Select does render a real `<select>` under the question's own name, but
 * inside a clipped `aria-hidden` container with `tabindex="-1"`, behind a trigger only
 * JavaScript can open, so the question can be neither seen nor operated, and a required
 * one made the browser abandon the step's submission on an unfocusable invalid control.
 * `NativeSelectField` carries the wire contract and the empty-valued placeholder option.
 */
function SelectField(props: Readonly<SelectProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();

  if (native) {
    return (
      <FieldBlur name={props.name} onBlur={field.blur}>
        <NativeSelectField
          name={props.name}
          label={props.label}
          description={props.description}
          isRequired={props.isRequired}
          isDisabled={props.isDisabled}
          items={props.items}
          placeholder={props.placeholder}
          disabledKeys={props.disabledKeys}
          defaultValue={typeof field.value === "string" ? field.value : undefined}
          isInvalid={field.error != null}
          errorMessage={field.error}
        />
        <FieldMarkers name={props.name} kind="string" />
      </FieldBlur>
    );
  }

  const modeProps: Partial<ComponentProps<typeof Select>> = {
    // NO_SELECTION when unselected: "" is not a valid option key and breaks RAC's
    // selection manager.
    value: typeof field.value === "string" ? field.value : NO_SELECTION,
    // The vendored Select has no clear gesture, but `onSelectionChange` is typed
    // `Key | null` upstream, so the empty case is accepted and reported as absence:
    // were react-aria ever to emit one it reaches the API as an ADR-33 retraction
    // rather than a `null` travelling as though it were an `AnswerValue`.
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
    </FieldBlur>
  );
}

/**
 * The lean, explicit registry: only the components the compiler emits plus the
 * qcms-owned nodes. Never `defaultRegistry` (ADR-22), so the surface stays small and
 * auditable, and `strict` makes the renderer validate every node before rendering it.
 *
 * Each question control's schema is wrapped in `withAuthorMessages` (ADR-32), because
 * the vendored props objects are `.strict()` and a node carrying the author's `messages`
 * prop would not validate otherwise. The choice leaves and structural nodes never carry
 * it: a message belongs to a question, and a question is one control.
 */
function buildV1Registry(): ComponentRegistry {
  return createRegistry(
    {
      // The qcms adapter rather than the vendored `Form` directly, only because a form's
      // action may be a function (ADR-43 as amended). It delegates to the vendored
      // component whenever no function action is supplied.
      Form: { component: FormField, schema: FormSchema },
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
      // The repeating group (ADR-42, ADR-43). `RepeatGroup` is the compiler's template
      // node; `RepeatInstance` exists only after `expandRepeatGroups` clones it per live
      // instance, so the stored bytes never carry one. Both are qcms-owned node types
      // because nothing upstream describes a container cloned per instance and the
      // vendored props objects are `.strict()` (ADR-22).
      RepeatGroup: { component: RepeatGroup, schema: RepeatGroupSchema },
      RepeatInstance: { component: RepeatInstance, schema: RepeatInstanceSchema },
      // The table presentation's render-time node types (ADR-43). A native `<table>` has
      // a fixed element nesting and the a2ra renderer adds no wrapper of its own, so
      // each cell element needs a node. They are not the vendored `Table`, which renders
      // `role="grid"` and manages focus with script: ADR-43 refuses that, so what the
      // vendored component contributes here is its style map rather than its markup.
      RepeatTable: { component: RepeatTable, schema: RepeatTableSchema },
      RepeatRow: { component: RepeatRow, schema: RepeatRowSchema },
      RepeatCell: { component: RepeatCell, schema: RepeatCellSchema },
      SubmitButton: { component: SubmitButton, schema: SubmitButtonSchema },
    },
    { strict: true },
  );
}

const V1_REGISTRY = buildV1Registry();

/**
 * `specVersion` dispatch seam (ADR-18). Every published A2UI spec version must keep
 * rendering; the corpus is a single generation today, so every version resolves to the
 * v1 registry. A future breaking version branches here, rendered alongside v1 rather
 * than migrating stored snapshots.
 */
export function registryForSpecVersion(specVersion?: string): ComponentRegistry {
  // eslint-disable-next-line sonarjs/void-use -- discards an as-yet-unused parameter; the ADR-18 spec-version dispatch seam
  void specVersion;
  return V1_REGISTRY;
}
