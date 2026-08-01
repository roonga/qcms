"use client";

import { useState, useTransition } from "react";

import { Button, Select } from "@/components/kit";
import { IDLE_PREVIEW, type PreviewConditionState } from "@/lib/forms/builder-state";
import {
  conditionReferences,
  optionIdsOfVersion,
  typeOfPinnedVersion,
  type OperandKind,
} from "@/lib/forms/condition";
import { draftDocumentOrder } from "@/lib/forms/draft";
import type { DraftForm, DraftRule, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

import { answerKindForType, OperandControl, type OperandValue } from "./operand-control";

/**
 * The rule test bench (task 033; wireframe "test bench").
 *
 * ## Read-only, and evaluated server-side
 *
 * The kernel is not importable in this app (rule 1 of the import-surface test), so the
 * bench does not evaluate anything: it posts the draft, the rule id and the hypothetical
 * answers to `POST .../draft/preview-condition`, which runs core's own evaluator on a
 * synthetic snapshot in the API. That is the same resolution 032's question preview took,
 * and it has a property a client-side evaluator could not have: what the bench shows is
 * what the engine would actually do, from the same code path.
 *
 * ## Three outcomes, never two
 *
 * `match`, `noMatch` and `unavailable`. Collapsing the third into the second would teach an
 * author something false: "this condition did not match" and "this condition could not be
 * evaluated" are different answers, and the second usually means the draft or the answers
 * are incomplete rather than that the logic is wrong. `unavailable` therefore renders in
 * its own words, with its own sentence for each reason.
 *
 * ## The answers never leave this screen except to be judged
 *
 * SEC-13 / ADR-34: the values typed here are answer-shaped. They are not stored, not
 * logged, and not echoed back in any message. The action forwards them, a verdict comes
 * back, and the verdict is all that is rendered.
 */
export function RuleTestBench({
  draft,
  rules,
  library,
  previewCondition,
}: {
  readonly draft: DraftForm;
  readonly rules: readonly DraftRule[];
  readonly library: readonly PinnableQuestion[];
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
}) {
  const [ruleId, setRuleId] = useState(rules[0]?.ruleId ?? "");
  const [answers, setAnswers] = useState<Record<string, OperandValue>>({});
  const [state, setState] = useState<PreviewConditionState>(IDLE_PREVIEW);
  const [isPending, startTransition] = useTransition();

  const rule = rules.find((candidate) => candidate.ruleId === ruleId) ?? rules[0];
  const references = rule === undefined ? [] : conditionReferences(rule.when);

  return (
    <details className="rounded-md border border-(--color-border) bg-(--color-surface) p-4">
      <summary className="cursor-pointer text-base font-semibold text-(--color-text)">
        {t("forms.bench.title")}
      </summary>

      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.bench.note")}</p>

        {rule === undefined ? (
          <p className="text-sm text-(--color-text-muted)">{t("forms.bench.noRules")}</p>
        ) : (
          <>
            <Select
              label={t("forms.bench.rule")}
              value={rule.ruleId}
              items={rules.map((candidate) => ({
                label: candidate.ruleId,
                value: candidate.ruleId,
              }))}
              onChange={(next) => {
                setRuleId(next);
                setAnswers({});
                setState(IDLE_PREVIEW);
              }}
            />

            <fieldset className="qcms-fieldset qcms-fieldset--flat">
              <legend className="qcms-fieldset__legend">{t("forms.bench.answers")}</legend>
              {references.length === 0 ? (
                <p className="text-sm text-(--color-text-muted)">{t("forms.bench.noReferences")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {references.map((questionId) => (
                    <AnswerControl
                      key={questionId}
                      draft={draft}
                      library={library}
                      questionId={questionId}
                      value={answers[questionId]}
                      onChange={(value) => {
                        setAnswers({ ...answers, [questionId]: value });
                      }}
                    />
                  ))}
                </div>
              )}
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  startTransition(async () => {
                    setState(
                      await previewCondition({
                        draft,
                        ruleId: rule.ruleId,
                        answers: answersToSend(draft, library, references, answers),
                      }),
                    );
                  });
                }}
              >
                {t("forms.bench.run")}
              </Button>
              <p aria-live="polite" className="text-sm text-(--color-text)">
                <span data-testid="qcms-bench-outcome" data-outcome={state.outcome ?? state.status}>
                  {outcomeSentence(state)}
                </span>
              </p>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

/** One hypothetical answer, in the control that question's pinned type calls for. */
function AnswerControl({
  draft,
  library,
  questionId,
  value,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly library: readonly PinnableQuestion[];
  readonly questionId: string;
  readonly value: OperandValue | undefined;
  readonly onChange: (value: OperandValue) => void;
}) {
  const control = controlFor(draft, library, questionId);
  if (control === undefined) {
    // An unpinned reference has no version, so there is nothing to answer it against. The
    // API reads it as unanswered, and saying so here beats rendering a control whose value
    // would be ignored.
    return (
      <p className="text-sm text-(--color-text-muted)">
        {t("forms.bench.unpinned", { questionId })}
      </p>
    );
  }

  return (
    <OperandControl
      kind={control.kind}
      label={`${questionId}@${String(control.version)}`}
      options={control.options}
      value={value ?? startingAnswer(control.kind, control.options)}
      onChange={onChange}
    />
  );
}

interface AnswerControlShape {
  readonly kind: OperandKind;
  readonly options: readonly string[];
  readonly version: number;
}

/** What control one referenced question needs, or `undefined` when it is not pinned. */
function controlFor(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
  questionId: string,
): AnswerControlShape | undefined {
  const pin = draftDocumentOrder(draft).find((entry) => entry.questionId === questionId);
  if (pin === undefined) return undefined;
  const question = library.find((entry) => entry.questionId === questionId);
  return {
    kind: answerKindForType(typeOfPinnedVersion(question, pin.version)),
    options: optionIdsOfVersion(question, pin.version),
    version: pin.version,
  };
}

/**
 * The payload: exactly what the controls are showing, including the ones nobody touched.
 *
 * A control cannot start empty (an empty date is malformed, not unfinished), so every
 * reference renders with a starting value the moment the bench opens. Sending only the
 * values the author *changed* would therefore make the bench lie: the screen would show
 * "opt_yes" beside a verdict computed against no answer at all, and a vendored `Select`
 * does not even fire a change when the author picks the value it is already displaying, so
 * the two disagree precisely when the author thinks they have confirmed their intent. What
 * is on screen is what is evaluated.
 *
 * An unpinned reference is still omitted, and that is not the same thing: there is no
 * version to answer it against, the bench says so instead of rendering a control, and the
 * engine reads it as unanswered.
 */
function answersToSend(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
  references: readonly string[],
  entered: Readonly<Record<string, OperandValue>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const questionId of references) {
    const control = controlFor(draft, library, questionId);
    if (control === undefined) continue;
    payload[questionId] = entered[questionId] ?? startingAnswer(control.kind, control.options);
  }
  return payload;
}

/** A control's value before the author touches it, always a shape the engine parses. */
// eslint-disable-next-line sonarjs/function-return-type -- the union is what a type decides.
function startingAnswer(kind: OperandKind, options: readonly string[]): OperandValue {
  if (kind === "number") return 0;
  if (kind === "boolean") return false;
  if (kind === "option") return options[0] ?? "";
  if (kind === "optionList") return [];
  return "";
}

/** The verdict, in the words the outcome deserves. */
function outcomeSentence(state: PreviewConditionState): string {
  if (state.status === "idle") return "";
  if (state.status === "error") return t("forms.bench.failed", { message: state.message ?? "" });
  if (state.outcome === "match") return t("forms.bench.match");
  if (state.outcome === "noMatch") return t("forms.bench.noMatch");
  if (state.reason === undefined) return t("forms.bench.unavailable");
  const reason = t(`forms.bench.reason.${state.reason}`);
  return `${t("forms.bench.unavailable")} ${reason}`;
}
