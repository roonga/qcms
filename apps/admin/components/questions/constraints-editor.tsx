"use client";

import { compilesUnderV, toVSafePattern } from "@roonga/qcms-ui";
import { useState } from "react";

import { Checkbox, DatePicker, NumberField, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { PATTERN_INPUT_LIMIT } from "@/lib/questions/definition";
import { fieldErrorProps, optionalProp } from "@/lib/questions/errors";
import type { ConstraintsView, DefinitionIssue, QuestionType } from "@/lib/questions/types";

interface PanelProps {
  readonly constraints: ConstraintsView;
  readonly onChange: (constraints: ConstraintsView) => void;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
}

/* A cleared NumberField reports NaN, meaning no constraint rather than zero. */
function numberOrUndefined(value: number): number | undefined {
  return Number.isNaN(value) ? undefined : value;
}

/* Keep the empty value controlled; omitting it changes control mode on the first edit and can lose input. */
function numberOrNaN(value: number | undefined): number {
  return value ?? Number.NaN;
}

function ConstraintNumber({
  field,
  label,
  value,
  constraints,
  onChange,
  issues,
  isFrozen,
  step,
}: PanelProps & {
  readonly field: keyof ConstraintsView;
  readonly label: string;
  readonly value: number | undefined;
  readonly step?: number;
}) {
  return (
    <NumberField
      label={label}
      isDisabled={isFrozen}
      value={numberOrNaN(value)}
      {...optionalProp("step", step)}
      {...fieldErrorProps(issues, `constraints.${field}`)}
      onChange={(next) => {
        onChange({ ...constraints, [field]: numberOrUndefined(next) });
      }}
    />
  );
}

function vSafeNote(pattern: string): string {
  if (pattern === "" || compilesUnderV(pattern)) return "";
  const suggestion = toVSafePattern(pattern);
  return suggestion === undefined
    ? t("questions.constraint.patternVUnsafe")
    : t("questions.constraint.patternVSuggestion", { suggestion });
}

/* This browser regex test is only a convenience; the kernel's restricted RE2-safe validation remains
   authoritative. */
function PatternField({ constraints, onChange, issues, isFrozen }: PanelProps) {
  const [sample, setSample] = useState("");
  const pattern = typeof constraints.pattern === "string" ? constraints.pattern : "";

  let verdict = "";
  if (pattern !== "" && sample !== "") {
    try {
      verdict = new RegExp(pattern, "u").test(sample)
        ? t("questions.constraint.patternMatch")
        : t("questions.constraint.patternNoMatch");
    } catch {
      verdict = t("questions.constraint.patternUnreadable");
    }
  }

  const vNote = isFrozen ? "" : vSafeNote(pattern);

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label={t("questions.constraint.pattern")}
        description={t("questions.constraint.patternHint")}
        value={pattern}
        maxLength={PATTERN_INPUT_LIMIT}
        isDisabled={isFrozen}
        {...fieldErrorProps(issues, "constraints.pattern")}
        onChange={(next) => {
          onChange({ ...constraints, pattern: next === "" ? undefined : next });
        }}
      />
      {vNote !== "" && (
        <p
          aria-live="polite"
          className="text-sm text-(--color-text-muted)"
          data-testid="qcms-pattern-v-note"
        >
          {vNote}
        </p>
      )}
      {!isFrozen && (
        <>
          <TextField
            label={t("questions.constraint.patternSample")}
            value={sample}
            maxLength={PATTERN_INPUT_LIMIT}
            onChange={setSample}
          />
          {/* Use a polite region for keystroke updates so the operator is not interrupted mid-word. */}
          <p
            aria-live="polite"
            className="text-sm text-(--color-text-muted)"
            data-testid="qcms-pattern-verdict"
          >
            {verdict}
          </p>
        </>
      )}
    </div>
  );
}

function ShortTextPanel(props: PanelProps) {
  return (
    <div className="qcms-constraints">
      <ConstraintNumber
        {...props}
        field="minLength"
        label={t("questions.constraint.minLength")}
        value={props.constraints.minLength}
        step={1}
      />
      <ConstraintNumber
        {...props}
        field="maxLength"
        label={t("questions.constraint.maxLength")}
        value={props.constraints.maxLength}
        step={1}
      />
      <div className="qcms-constraints__wide">
        <PatternField {...props} />
      </div>
    </div>
  );
}

function LongTextPanel(props: PanelProps) {
  return (
    <div className="qcms-constraints">
      <ConstraintNumber
        {...props}
        field="maxLength"
        label={t("questions.constraint.maxLength")}
        value={props.constraints.maxLength}
        step={1}
      />
    </div>
  );
}

function NumberPanel(props: PanelProps) {
  const { constraints, onChange, isFrozen } = props;
  return (
    <div className="qcms-constraints">
      <ConstraintNumber
        {...props}
        field="min"
        label={t("questions.constraint.min")}
        value={typeof constraints.min === "number" ? constraints.min : undefined}
      />
      <ConstraintNumber
        {...props}
        field="max"
        label={t("questions.constraint.max")}
        value={typeof constraints.max === "number" ? constraints.max : undefined}
      />
      <div className="qcms-constraints__wide">
        <Checkbox
          label={t("questions.constraint.integer")}
          isSelected={constraints.integer === true}
          isDisabled={isFrozen}
          onChange={(selected) => {
            onChange({ ...constraints, integer: selected });
          }}
        />
      </div>
    </div>
  );
}

function DatePanel({ constraints, onChange, issues, isFrozen }: PanelProps) {
  return (
    <div className="qcms-constraints">
      {/* Pass null for an unset controlled date; omitting value makes the field uncontrolled. */}
      <DatePicker
        label={t("questions.constraint.earliest")}
        isDisabled={isFrozen}
        value={typeof constraints.min === "string" ? constraints.min : null}
        {...fieldErrorProps(issues, "constraints.min")}
        onChange={(next) => {
          onChange({ ...constraints, min: next === "" ? undefined : next });
        }}
      />
      <DatePicker
        label={t("questions.constraint.latest")}
        isDisabled={isFrozen}
        value={typeof constraints.max === "string" ? constraints.max : null}
        {...fieldErrorProps(issues, "constraints.max")}
        onChange={(next) => {
          onChange({ ...constraints, max: next === "" ? undefined : next });
        }}
      />
    </div>
  );
}

function MultiChoicePanel(props: PanelProps) {
  return (
    <div className="qcms-constraints">
      <ConstraintNumber
        {...props}
        field="minSelected"
        label={t("questions.constraint.minSelected")}
        value={props.constraints.minSelected}
        step={1}
      />
      <ConstraintNumber
        {...props}
        field="maxSelected"
        label={t("questions.constraint.maxSelected")}
        value={props.constraints.maxSelected}
        step={1}
      />
    </div>
  );
}

const PANELS: Readonly<Record<QuestionType, ((props: PanelProps) => React.JSX.Element) | null>> = {
  shortText: ShortTextPanel,
  longText: LongTextPanel,
  number: NumberPanel,
  date: DatePanel,
  boolean: null,
  singleChoice: null,
  multiChoice: MultiChoicePanel,
};

export function ConstraintsEditor({
  type,
  ...props
}: PanelProps & { readonly type: QuestionType }) {
  const Panel = PANELS[type];
  if (Panel === null) return null;
  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.editor.constraints")}</legend>
      <Panel {...props} />
    </fieldset>
  );
}
