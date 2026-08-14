"use client";

import { Button, Checkbox, DatePicker, NumberField, Select, TextField } from "@/components/kit";
import { DATE_OPERAND_PLACEHOLDER, type OperandKind } from "@/lib/forms/condition";
import type { DraftAnswerValue } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { QuestionType } from "@/lib/questions/types";

/**
 * One value control, shaped by what the DSL needs there (task 033).
 *
 * Two callers, one component, and that is the point rather than a saving. The condition
 * editor needs a control for an *operand* (`equals` against a date question wants a date
 * picker) and the rule test bench needs a control for a hypothetical *answer* to the same
 * question. Those are the same control: a condition compares against an answer, so their
 * shapes are identical by construction (`DOMAIN_SCHEMA` 2.4). Writing them twice would be
 * two places for "what does a multiChoice value look like?" to drift apart.
 *
 * Every control is **controlled**, always with a defined value. That is not style: an
 * undefined value flips a react-aria control to uncontrolled mid-life, which logs a React
 * warning, and the e2e console gate treats any `console.warn` as a failure. It is also why
 * a date operand starts at {@link DATE_OPERAND_PLACEHOLDER} rather than empty - `""` is
 * not an unfinished date, it is a malformed one.
 */

/**
 * What one control edits: a single value, or the list `in` / `containsAny` carry.
 *
 * Wider than `DraftAnswerValue` on purpose. `DraftAnswerValue`'s only list shape is
 * `readonly string[]` (a multiChoice answer), but `in` against a number question is a
 * list of numbers, which is a `readonly DraftAnswerValue[]` rather than an answer value.
 * The caller narrows on the way back into the node; the control only has to render it.
 */
export type OperandValue = DraftAnswerValue | readonly DraftAnswerValue[];

/** The control a hypothetical answer to a question of this type needs. */
export function answerKindForType(type: QuestionType | undefined): OperandKind {
  switch (type) {
    case "shortText":
    case "longText":
      return "text";
    case "number":
      return "number";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    case "singleChoice":
      return "option";
    case "multiChoice":
      return "optionList";
    default:
      return "unsupported";
  }
}

interface OperandProps {
  readonly kind: OperandKind;
  readonly label: string;
  /** The option ids the referenced question's pinned version declares, in order. */
  readonly options: readonly string[];
  readonly value: OperandValue;
  readonly onChange: (value: OperandValue) => void;
  readonly isDisabled?: boolean;
}

export function OperandControl(props: OperandProps) {
  switch (props.kind) {
    case "none":
      return null;
    case "unsupported":
      return <p className="text-sm text-(--color-text-muted)">{t("forms.operand.unsupported")}</p>;
    case "text":
      return <TextOperand {...props} />;
    case "number":
      return <NumberOperand {...props} />;
    case "date":
      return <DateOperand {...props} />;
    case "boolean":
      return <BooleanOperand {...props} />;
    case "option":
      return <OptionOperand {...props} />;
    case "optionList":
      return <OptionListOperand {...props} />;
    default:
      return <ScalarListOperand {...props} />;
  }
}

// --- scalars ----------------------------------------------------------------

function asText(value: OperandValue): string {
  if (Array.isArray(value)) return String((value as readonly DraftAnswerValue[])[0] ?? "");
  return String(value);
}

function asNumber(value: OperandValue): number {
  const parsed = Number(asText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asList(value: OperandValue): readonly DraftAnswerValue[] {
  return Array.isArray(value)
    ? (value as readonly DraftAnswerValue[])
    : [value as DraftAnswerValue];
}

function TextOperand({ label, value, onChange, isDisabled }: OperandProps) {
  return (
    <TextField
      label={label}
      value={asText(value)}
      isDisabled={isDisabled === true}
      onChange={onChange}
    />
  );
}

function NumberOperand({ label, value, onChange, isDisabled }: OperandProps) {
  return (
    <NumberField
      label={label}
      value={asNumber(value)}
      isDisabled={isDisabled === true}
      onChange={(next) => {
        // A NumberField reports `NaN` while its box is empty, and `NaN` is not a number
        // the DSL has: hold a legal value rather than writing one the schema rejects.
        onChange(Number.isFinite(next) ? next : 0);
      }}
    />
  );
}

function DateOperand({ label, value, onChange, isDisabled }: OperandProps) {
  return (
    <DatePicker
      label={label}
      value={asText(value)}
      isDisabled={isDisabled === true}
      onChange={(next) => {
        onChange(next === "" ? DATE_OPERAND_PLACEHOLDER : next);
      }}
    />
  );
}

function BooleanOperand({ label, value, onChange, isDisabled }: OperandProps) {
  return (
    <Select
      label={label}
      value={value === true ? "true" : "false"}
      isDisabled={isDisabled === true}
      items={[
        { label: t("forms.operand.true"), value: "true" },
        { label: t("forms.operand.false"), value: "false" },
      ]}
      onChange={(next) => {
        onChange(next === "true");
      }}
    />
  );
}

// --- choice -----------------------------------------------------------------

function OptionOperand({ label, options, value, onChange, isDisabled }: OperandProps) {
  if (options.length === 0) {
    return <p className="text-sm text-(--color-text-muted)">{t("forms.operand.noOptions")}</p>;
  }
  return (
    <Select
      label={label}
      value={asText(value)}
      isDisabled={isDisabled === true}
      items={options.map((optionId) => ({ label: optionId, value: optionId }))}
      onChange={onChange}
    />
  );
}

/**
 * A set of option ids.
 *
 * Checkboxes rather than a multi-`Select`, because the kit has no multi-select and because
 * a set is what the value *is*: `equals` on a multiChoice question is whole-answer set
 * equality (ADR-21), so the control that reads best is the one showing every option with
 * its own state rather than a summary line.
 */
function OptionListOperand({ label, options, value, onChange, isDisabled }: OperandProps) {
  const selected = asList(value).map(String);
  if (options.length === 0) {
    return <p className="text-sm text-(--color-text-muted)">{t("forms.operand.noOptions")}</p>;
  }
  return (
    <fieldset className="qcms-fieldset qcms-fieldset--flat">
      <legend className="qcms-fieldset__legend">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((optionId) => (
          <Checkbox
            key={optionId}
            label={optionId}
            isSelected={selected.includes(optionId)}
            isDisabled={isDisabled === true}
            onChange={(isSelected) => {
              const next = isSelected
                ? [...selected, optionId]
                : selected.filter((candidate) => candidate !== optionId);
              // `.min(1)` in the kernel for `in` and `containsAny`: clearing the last tick
              // would make the node unparseable, so it cannot be cleared.
              onChange(next.length === 0 ? selected : next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

// --- lists of scalars -------------------------------------------------------

/** The scalar control one row of a `textList` / `numberList` / `dateList` needs. */
function rowKindOf(kind: OperandKind): OperandKind {
  if (kind === "numberList") return "number";
  if (kind === "dateList") return "date";
  return "text";
}

/**
 * A fresh row's starting value, always a shape the kernel parses.
 *
 * A table rather than a chain of returns, because a function whose branches return
 * different primitive types is exactly what `sonarjs/function-return-type` objects to -
 * and here the union is the point, so the table is the honest way to say so.
 */
const STARTING_ROW: Readonly<Partial<Record<OperandKind, DraftAnswerValue>>> = {
  numberList: 0,
  dateList: DATE_OPERAND_PLACEHOLDER,
};

function startingRow(kind: OperandKind): DraftAnswerValue {
  return STARTING_ROW[kind] ?? "";
}

/**
 * A list of scalars, as `in` needs against a text, number or date question.
 *
 * Rows are keyed by position, which is right here rather than a shortcut: a value in this
 * list has no identity of its own, it *is* its position, so a reorder and a rewrite are
 * the same edit. (Contrast an option row in 032's editor, whose `optionId` is a permanent
 * name and must therefore key its row.)
 */
function ScalarListOperand({ kind, label, options, value, onChange, isDisabled }: OperandProps) {
  const rows = asList(value);
  const rowKind = rowKindOf(kind);

  return (
    <fieldset className="qcms-fieldset qcms-fieldset--flat">
      <legend className="qcms-fieldset__legend">{label}</legend>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={`row-${String(index)}`} className="flex items-end gap-2">
            <OperandControl
              kind={rowKind}
              label={t("forms.operand.item", { position: index + 1 })}
              options={options}
              value={row}
              isDisabled={isDisabled === true}
              onChange={(next) => {
                const edited = rows.map((current, at) => (at === index ? next : current));
                onChange(edited as readonly DraftAnswerValue[]);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              isDisabled={isDisabled === true || rows.length <= 1}
              onPress={() => {
                onChange(rows.filter((_row, at) => at !== index));
              }}
            >
              {t("forms.operand.remove", { position: index + 1 })}
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={isDisabled === true}
          onPress={() => {
            onChange([...rows, startingRow(kind)]);
          }}
        >
          {t("forms.operand.add")}
        </Button>
      </div>
    </fieldset>
  );
}
