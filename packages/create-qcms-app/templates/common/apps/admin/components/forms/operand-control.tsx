"use client";

import { Button, Checkbox, DatePicker, NumberField, Select, TextField } from "@/components/kit";
import { DATE_OPERAND_PLACEHOLDER, type OperandKind } from "@/lib/forms/condition";
import type { DraftAnswerValue } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { QuestionType } from "@/lib/questions/types";

export type OperandValue = DraftAnswerValue | readonly DraftAnswerValue[];

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

/* Multi-choice equals compares the whole answer as a set; checkboxes expose each member's state. */
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
              onChange(next.length === 0 ? selected : next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function rowKindOf(kind: OperandKind): OperandKind {
  if (kind === "numberList") return "number";
  if (kind === "dateList") return "date";
  return "text";
}

const STARTING_ROW: Readonly<Partial<Record<OperandKind, DraftAnswerValue>>> = {
  numberList: 0,
  dateList: DATE_OPERAND_PLACEHOLDER,
};

function startingRow(kind: OperandKind): DraftAnswerValue {
  return STARTING_ROW[kind] ?? "";
}

/* These values have positional identity and are replaced together; permanent option ids elsewhere must key
   their own rows. */
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
