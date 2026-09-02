"use client";

import { compilesUnderV, toVSafePattern } from "@qcms/ui";
import { useState } from "react";

import { Checkbox, DatePicker, NumberField, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { PATTERN_INPUT_LIMIT } from "@/lib/questions/definition";
import { fieldErrorProps, optionalProp } from "@/lib/questions/errors";
import type { ConstraintsView, DefinitionIssue, QuestionType } from "@/lib/questions/types";

/**
 * The per-type constraint panel (task 032; screen contract "constraints panel, per type").
 *
 * One component per type rather than one component with seven branches, and 032 kept it
 * that way for task 048 ("leave the constraint editor composable for that"): ADR-32's
 * per-constraint validation-message field looked like a new prop threaded through each
 * row here. **048 did not need that, and this file is unchanged by it.** The message
 * fields are their own panel (`messages-editor.tsx`) because `required` is not a
 * constraint at all and the fields have to appear and disappear as constraints come and
 * go, which is one derived list rather than seven panels each re-deriving it. The
 * composability still paid off, in the negative: no row had to move.
 *
 * Every control is optional and every empty control means "no constraint", which is why
 * clearing a `NumberField` yields `undefined` rather than `0`. Sending `0` where the
 * author meant "unset" is a silently wrong question, not a validation error.
 */

/** What every per-type panel receives. */
interface PanelProps {
  readonly constraints: ConstraintsView;
  readonly onChange: (constraints: ConstraintsView) => void;
  readonly issues: ReadonlyMap<string, DefinitionIssue[]>;
  readonly isFrozen: boolean;
}

/** A cleared `NumberField` reports `NaN`; that means "no constraint", never zero. */
function numberOrUndefined(value: number): number | undefined {
  return Number.isNaN(value) ? undefined : value;
}

/**
 * The inverse: "no constraint" as a value the control can hold.
 *
 * `NaN` rather than an omitted prop, and it is load-bearing. Omitting `value` leaves
 * react-aria's field uncontrolled, so the first keystroke flips it from uncontrolled to
 * controlled and React logs "A component changed from controlled to uncontrolled" - which
 * the Playwright console gate treats as a failure, correctly, because a field that changes
 * mode mid-edit can drop the value the operator just typed. `NaN` is react-aria's own
 * representation of an empty number field, so the control stays controlled from mount.
 */
function numberOrNaN(value: number | undefined): number {
  return value ?? Number.NaN;
}

/** A labelled numeric constraint, wired to its kernel error path. */
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

/**
 * The pattern field, with a live "try a sample" helper.
 *
 * The helper compiles the expression **in the browser, with JavaScript's own engine**,
 * and says whether a sample answer matches. It is a convenience, not a verdict, and the
 * hint text says so: the kernel accepts a deliberately restricted, RE2-safe subset, so an
 * expression that matches happily here can still be refused on save with
 * `PATTERN_INVALID` or `PATTERN_UNSUPPORTED`. Claiming otherwise would put a second,
 * weaker validator in the BFF, which is the thing R2 exists to prevent - so this one is
 * scoped to answering "did I write what I meant?", which the kernel cannot answer at all.
 *
 * The input is capped at the kernel's own pattern length so a runaway expression cannot
 * be typed here in the first place.
 */
/**
 * The v-safe spelling to suggest for a pattern, or `undefined` when there is
 * nothing to say (issue #53).
 *
 * A browser compiles the HTML `pattern` attribute under the `v` flag, whose
 * character-class grammar is narrower than the one this expression is authored
 * and validated against, so a pattern like `[A-Za-z .,'-]` is dropped by the
 * browser with a console error. `toVSafePattern` (issue #52) already repairs
 * that at render time, on every render, forever. Offering its output here lets
 * the author store the repaired spelling instead, which is the same rule
 * written so that nothing downstream has to rewrite it.
 *
 * Three outcomes, and the middle one is the reason this is message-level rather
 * than a widget: nothing to say, a suggestion to make, or a warning with no
 * suggestion behind it (the normalization declines patterns whose rewrite would
 * not be provably meaning-preserving, and omission is then correct - the API is
 * the validation authority, R2).
 */
function vSafeNote(pattern: string): string {
  if (pattern === "" || compilesUnderV(pattern)) return "";
  const suggestion = toVSafePattern(pattern);
  return suggestion === undefined
    ? t("questions.constraint.patternVUnsafe")
    : t("questions.constraint.patternVSuggestion", { suggestion });
}

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
        // Polite for the same reason the sample verdict is: it recomputes on every
        // keystroke, and an assertive region would interrupt the author mid-word.
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
          {/* Polite, not assertive: this updates on every keystroke, and an assertive
              region would interrupt the operator mid-word on each one. Testid on the
              region itself so the `aria-live` can be asserted directly (#368). */}
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
      <DatePicker
        label={t("questions.constraint.earliest")}
        isDisabled={isFrozen}
        {...optionalProp(
          "value",
          typeof constraints.min === "string" ? constraints.min : undefined,
        )}
        {...fieldErrorProps(issues, "constraints.min")}
        onChange={(next) => {
          onChange({ ...constraints, min: next === "" ? undefined : next });
        }}
      />
      <DatePicker
        label={t("questions.constraint.latest")}
        isDisabled={isFrozen}
        {...optionalProp(
          "value",
          typeof constraints.max === "string" ? constraints.max : undefined,
        )}
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

/** The seven types, mapped to their panel. `boolean` and `singleChoice` have none. */
const PANELS: Readonly<Record<QuestionType, ((props: PanelProps) => React.JSX.Element) | null>> = {
  shortText: ShortTextPanel,
  longText: LongTextPanel,
  number: NumberPanel,
  date: DatePanel,
  boolean: null,
  singleChoice: null,
  multiChoice: MultiChoicePanel,
};

/** The constraint panel for one question type, or the "nothing to set" note. */
export function ConstraintsEditor({
  type,
  ...props
}: PanelProps & { readonly type: QuestionType }) {
  const Panel = PANELS[type];
  return (
    <fieldset className="qcms-fieldset">
      <legend className="qcms-fieldset__legend">{t("questions.editor.constraints")}</legend>
      {Panel === null ? (
        <p className="text-sm text-(--color-text-muted)">{t("questions.editor.noConstraints")}</p>
      ) : (
        <Panel {...props} />
      )}
    </fieldset>
  );
}
