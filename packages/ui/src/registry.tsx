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
 * `A2Renderer` has no channel for the parent-owned value or error, so every adapter reaches the controlled
 * state through `useQcmsField`; all qcms wiring lives here (ADR-22). Adapters report an emptied control as
 * `undefined`, so the host posts one ADR-33 retraction.
 */

function isStringArray(value: A2UIAnswerValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * Absence, never an answer of nothing (ADR-33): an empty text box is the pristine
 * rendering, so the respondent cannot mean the empty value as a value, and posting it
 * would 422 against any constraint while the server kept the old answer.
 */
function absentIfEmptyText(value: string): string | undefined {
  return value === "" ? undefined : value.normalize("NFC");
}

function absentIfNoSelection(values: readonly string[]): readonly string[] | undefined {
  // Canonical multiChoice is deduplicated. RAC never emits duplicates; this keeps the
  // encoding canonical whatever it emits.
  const selected = [...new Set(values)];
  return selected.length > 0 ? selected : undefined;
}

/**
 * Not `undefined`, which react-stately reads as uncontrolled, after which it serves its own last internal value.
 * Not `""` either: it matches no radio, making the group keyboard-unreachable, and is looked up as an invalid
 * option key.
 */
const NO_SELECTION = null;

/**
 * Lets the BFF decode the post without knowing the question (R2). `__qk__` carries the transport kind; `__qa__`
 * marks the question answered, so a marked field arriving empty is the respondent clearing it.
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
 * The vendored controls neither forward `onBlur` nor expose a questionId-keyed node, so this supplies both.
 * `display: contents` adds no box and no role; the `id` lets a host target the question for focus. Blur ignores
 * focus moves inside the control.
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
 * Every adapter keys its control by the question's `name`, because `A2Renderer` keys children by index:
 * otherwise a step swap or branch prune reconciles a mounted control onto another question, and a RadioGroup's
 * `lastFocusedValue` left every radio at `tabIndex=-1`.
 */

type TextFieldProps = NonNullable<TextFieldNode["props"]>;
function TextFieldField(props: Readonly<TextFieldProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof TextField>> = native
    ? { defaultValue: typeof field.value === "string" ? field.value : undefined }
    : {
        // Not `undefined`, which takes react-aria's uncontrolled path and redisplays
        // the cleared text.
        value: typeof field.value === "string" ? field.value : "",
        onChange: (v: string) => field.setValue(absentIfEmptyText(v)),
      };
  return (
    <FieldBlur name={props.name} onBlur={field.blur}>
      <TextField
        key={props.name}
        {...props}
        // Browsers compile `pattern` with the `v` flag, which rejects class-literal
        // spellings the authored `u` flag accepts. The API is the authority (R2), so an
        // unnormalizable pattern is dropped rather than rendered and logged as invalid.
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
 * react-aria reads the format, not `step`, so its default admitted three fraction digits to an integer-only
 * question. It also settles a hydration mismatch: with fraction digits `inputMode` is `decimal` on touch but a
 * server render, having no `navigator`, emits `numeric`.
 */
const INTEGER_NUMBER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };

/**
 * The compiler emits `step: 1` for an integer-constrained question and nothing
 * otherwise, so a missing or non-integral step is the fractional case.
 */
export function numberFieldAdmitsFractions(step: number | undefined): boolean {
  return step === undefined || !Number.isInteger(step);
}

/**
 * The vendored NumberField splits one question across an unnamed visible text input and
 * a JavaScript-synced hidden input carrying the form value, so with scripting off
 * keystrokes are never serialized.
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
 * A DOM read of react-aria's styling hooks is the only signal: `onChange` fires when a date becomes complete or
 * every segment is cleared, never in between. No segments at all reports complete, so absence of evidence never
 * manufactures a retraction.
 */
function dateInputIsComplete(container: HTMLElement): boolean {
  const segments = Array.from(container.querySelectorAll<HTMLElement>("[data-type]"));
  return segments.every(
    (segment) => segment.dataset["type"] === "literal" || !segment.hasAttribute("data-placeholder"),
  );
}

type DatePickerProps = NonNullable<DatePickerNode["props"]>;

/**
 * The vendored DatePicker is JS-driven segments plus a `hidden required` input the browser cannot focus, so a
 * required date made the browser refuse the whole step's submit.
 */
function DatePickerField(props: Readonly<DatePickerProps>) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  // Bumped only when a clear is observed, so the vendored control remounts with the now-empty value; without it
  // react-aria takes its uncontrolled path and redisplays the cleared date. Never bumped while typing.
  const [clearedGeneration, setClearedGeneration] = useState(0);

  /** The ADR-31 commit moment, where the clear `onChange` cannot report is observed. */
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
  // boolean and singleChoice both compile to RadioGroup, so the value shape picks a JSON boolean or an OptionId.
  // Native mode keeps `undefined`: the vendored control seeds form state from any defined `defaultValue`.
  // No clear gesture exists (a selected radio cannot be toggled off); only whole-session erasure unanswers it (ADR-33).
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
 * HTML has no "at least one of these" constraint; react-aria puts native `required` on every checkbox and removes
 * it after the first selection, which a server-rendered page never sees. The ARIA encoding replaces it, through a
 * context over this subtree alone, since `validationBehavior` resolves per checkbox from `props ?? FormContext`.
 */
const NATIVE_GROUP_VALIDATION = { validationBehavior: "aria" } as const;

function CheckboxGroupField(props: CheckboxGroupProps) {
  const field = useQcmsField(props.name);
  const native = useQcmsNativeSubmit();
  const modeProps: Partial<ComponentProps<typeof CheckboxGroup>> = native
    ? { defaultValue: isStringArray(field.value) ? [...field.value] : undefined }
    : {
        // Not `undefined`, as with the TextField above.
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
 * The vendored Select renders a real `<select>` inside a clipped `aria-hidden` container behind a trigger only
 * JavaScript opens, so the question is neither visible nor operable and a required one made the browser abandon
 * the submission.
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
    // "" is not a valid option key and breaks RAC's selection manager.
    value: typeof field.value === "string" ? field.value : NO_SELECTION,
    // No clear gesture exists, but `onSelectionChange` is typed `Key | null` upstream,
    // so the empty case is reported as absence rather than travelling as an
    // `AnswerValue`.
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
 * Never `defaultRegistry` (ADR-22), so the surface stays small and auditable. The
 * question controls are wrapped in `withAuthorMessages` because the vendored props
 * objects are `.strict()`; the choice leaves and structural nodes never carry messages.
 */
function buildV1Registry(): ComponentRegistry {
  return createRegistry(
    {
      // An adapter only because a form's action may be a function (ADR-43 as amended);
      // it delegates to the vendored component otherwise.
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
      // `RepeatInstance` exists only after expansion clones the template, so stored bytes never carry one. Both are
      // qcms-owned because nothing upstream describes a container cloned per instance and the vendored props are
      // `.strict()` (ADR-22).
      RepeatGroup: { component: RepeatGroup, schema: RepeatGroupSchema },
      RepeatInstance: { component: RepeatInstance, schema: RepeatInstanceSchema },
      // A native `<table>` has a fixed element nesting and the a2ra renderer adds no wrapper, so each cell element
      // needs a node. Not the vendored `Table`: it renders `role="grid"` and manages focus with script, which ADR-43
      // refuses.
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
 * Every published A2UI spec version must keep rendering (ADR-18), so a future breaking
 * version branches here rather than migrating stored snapshots.
 */
export function registryForSpecVersion(specVersion?: string): ComponentRegistry {
  // eslint-disable-next-line sonarjs/void-use -- discards an as-yet-unused parameter; the ADR-18 spec-version dispatch seam
  void specVersion;
  return V1_REGISTRY;
}
