import { createRegistry } from "@a2ra/core";
import type { ComponentRegistry } from "@a2ra/core";
import type { FocusEvent, ReactNode } from "react";

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
import type { A2UIAnswerValue } from "./field-context.tsx";
import { useQcmsField } from "./field-context.tsx";
import { Honeypot } from "./honeypot/Honeypot.tsx";
import { HoneypotSchema } from "./honeypot/honeypot.schema.ts";

/**
 * Controlled qcms adapters over the vendored a2-react-aria controls. The a2ra
 * `A2Renderer` only passes a node's compiled JSON props to its component; it has
 * no channel for the parent-owned value/error. Each adapter reaches the
 * controlled state through `useQcmsField(name)` and injects `value` (flowing
 * down), `onChange`/`isInvalid`/`errorMessage`, translating the control's raw
 * value to/from the canonical `AnswerValue` encoding for its question type. The
 * vendored components are used byte-for-byte upstream (clean `a2ra diff`,
 * ADR-22); all qcms wiring lives here.
 */

/** Narrows a canonical answer to the multiChoice (OptionId[]) shape. */
function isStringArray(value: A2UIAnswerValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * Fires the parent `onBlur(name)` when focus leaves the whole control (touched
 * semantics; focus *policy* is 029/030). The vendored controls do not forward
 * `onBlur`, so we capture the bubbling focusout on a `display:contents` wrapper
 * (invisible to layout) and ignore focus moves that stay inside the control
 * (e.g. between a NumberField's steppers).
 */
function FieldBlur({
  onBlur,
  children,
}: {
  readonly onBlur: () => void;
  readonly children: ReactNode;
}) {
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onBlur();
    }
  };
  return (
    <div style={{ display: "contents" }} onBlur={handleBlur}>
      {children}
    </div>
  );
}

type TextFieldProps = NonNullable<TextFieldNode["props"]>;
function TextFieldField(props: TextFieldProps) {
  const field = useQcmsField(props.name);
  return (
    <FieldBlur onBlur={field.blur}>
      <TextField
        {...props}
        value={typeof field.value === "string" ? field.value : ""}
        isInvalid={field.error != null}
        errorMessage={field.error}
        onChange={(v) => field.setValue(v.normalize("NFC"))}
      />
    </FieldBlur>
  );
}

type TextAreaProps = NonNullable<TextAreaNode["props"]>;
function TextAreaField(props: TextAreaProps) {
  const field = useQcmsField(props.name);
  return (
    <FieldBlur onBlur={field.blur}>
      <TextArea
        {...props}
        value={typeof field.value === "string" ? field.value : ""}
        isInvalid={field.error != null}
        errorMessage={field.error}
        onChange={(v) => field.setValue(v.normalize("NFC"))}
      />
    </FieldBlur>
  );
}

type NumberFieldProps = NonNullable<NumberFieldNode["props"]>;
function NumberFieldField(props: NumberFieldProps) {
  const field = useQcmsField(props.name);
  return (
    <FieldBlur onBlur={field.blur}>
      <NumberField
        {...props}
        value={typeof field.value === "number" ? field.value : Number.NaN}
        isInvalid={field.error != null}
        errorMessage={field.error}
        onChange={(n) => field.setValue(Number.isNaN(n) ? undefined : n)}
      />
    </FieldBlur>
  );
}

type DatePickerProps = NonNullable<DatePickerNode["props"]>;
function DatePickerField(props: DatePickerProps) {
  const field = useQcmsField(props.name);
  return (
    <FieldBlur onBlur={field.blur}>
      <DatePicker
        {...props}
        value={typeof field.value === "string" ? field.value : undefined}
        isInvalid={field.error != null}
        errorMessage={field.error}
        onChange={(s) => field.setValue(s === "" ? undefined : s)}
      />
    </FieldBlur>
  );
}

type RadioGroupProps = NonNullable<RadioGroupNode["props"]> & { readonly children?: ReactNode };
function RadioGroupField(props: RadioGroupProps) {
  const field = useQcmsField(props.name);
  // boolean questions and singleChoice questions both compile to RadioGroup
  // (a2ui-mapping.md): boolean radios carry the string values "true"/"false",
  // singleChoice radios carry OptionIds ("opt_…"). Detect by the value shape so
  // onChange emits a JSON boolean for the former and an OptionId for the latter.
  // No selection → `undefined` (not ""), so RAC's roving tabindex keeps the
  // first radio in the tab order; a bare "" would leave the group unreachable.
  const controlValue =
    field.value === undefined
      ? undefined
      : typeof field.value === "boolean"
        ? field.value
          ? "true"
          : "false"
        : String(field.value);
  return (
    <FieldBlur onBlur={field.blur}>
      <RadioGroup
        {...props}
        value={controlValue}
        isInvalid={field.error != null}
        errorMessage={field.error}
        onChange={(v) => field.setValue(v === "true" ? true : v === "false" ? false : v)}
      />
    </FieldBlur>
  );
}

type CheckboxGroupProps = NonNullable<CheckboxGroupNode["props"]> & {
  readonly children?: ReactNode;
};
function CheckboxGroupField(props: CheckboxGroupProps) {
  const field = useQcmsField(props.name);
  return (
    <FieldBlur onBlur={field.blur}>
      <CheckboxGroup
        {...props}
        value={isStringArray(field.value) ? [...field.value] : []}
        isInvalid={field.error != null}
        errorMessage={field.error}
        // Canonical multiChoice is deduplicated (task 002); RAC never emits
        // duplicates, but dedupe defensively to keep the encoding canonical.
        onChange={(values: string[]) => field.setValue([...new Set(values)])}
      />
    </FieldBlur>
  );
}

type SelectProps = NonNullable<SelectNode["props"]>;
function SelectField(props: SelectProps) {
  const field = useQcmsField(props.name);
  return (
    <FieldBlur onBlur={field.blur}>
      <Select
        {...props}
        // undefined (not "") when unselected - "" is not a valid option key and
        // breaks RAC's selection manager.
        value={typeof field.value === "string" ? field.value : undefined}
        isInvalid={field.error != null}
        errorMessage={field.error}
        onChange={(v) => field.setValue(v)}
      />
    </FieldBlur>
  );
}

/**
 * The lean, explicit registry - only the components the compiler emits
 * (a2ui-mapping.md) plus the qcms `Honeypot` node (task 026). Never
 * `defaultRegistry` (ADR-22): a smaller, auditable surface. `strict` means the
 * a2ra renderer validates every node against its schema before rendering.
 *
 * Structural nodes (Form/Flex/Text) and the choice leaves (Radio/Checkbox) are
 * the vendored components verbatim; the interactive controls are the qcms
 * controlled adapters above.
 */
function buildV1Registry(): ComponentRegistry {
  return createRegistry(
    {
      Form: { component: Form, schema: FormSchema },
      Flex: { component: Flex, schema: FlexSchema },
      Text: { component: Text, schema: TextSchema },
      TextField: { component: TextFieldField, schema: TextFieldSchema },
      TextArea: { component: TextAreaField, schema: TextAreaSchema },
      NumberField: { component: NumberFieldField, schema: NumberFieldSchema },
      DatePicker: { component: DatePickerField, schema: DatePickerSchema },
      RadioGroup: { component: RadioGroupField, schema: RadioGroupSchema },
      Radio: { component: Radio, schema: RadioSchema },
      CheckboxGroup: { component: CheckboxGroupField, schema: CheckboxGroupSchema },
      Checkbox: { component: Checkbox, schema: CheckboxSchema },
      Select: { component: SelectField, schema: SelectSchema },
      Honeypot: { component: Honeypot, schema: HoneypotSchema },
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
  void specVersion; // single generation today; the parameter is the ADR-18 seam
  return V1_REGISTRY;
}
