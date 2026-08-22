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
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

import { answerKindForType, OperandControl, type OperandValue } from "./operand-control";

/**
 * The rule test bench (task 033; screen contract "test bench").
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
 *
 * ## The summary carries a heading and a digest (issue 519)
 *
 * Same change, same reasons, as the settings panel beside it: an `h2` inside the
 * `<summary>` so the bench has an entry in the builder's heading outline at the level
 * every other section uses (`plan/admin-ux-audit.md` §4.3), and a §3.7 digest whose every
 * fact also exists inside the panel - the rule is the Select's value, and the question
 * count is the number of entries the "Hypothetical answers" fieldset renders.
 *
 * Two things the digest deliberately does not say. It states no **issue** count: the
 * validation panel on the same screen owns the one authoritative count, and a second
 * count of an overlapping set is §5.6's named mistake. And it states no **outcome**: the
 * verdict only exists after a run, so before the first press "not run yet" would be a
 * fact living in the summary alone, which is exactly what §3.7 forbids.
 */
export function RuleTestBench({
  draft,
  rules,
  library,
  previewCondition,
}: {
  readonly draft: DraftForm;
  readonly rules: readonly DraftRule[];
  readonly library: ReadState<readonly PinnableQuestion[]>;
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
      {/* One heading element plus phrasing content is what `<summary>` accepts; the
          heading is `inline` so the marker, the title and the digest share a line. */}
      <summary className="cursor-pointer">
        <h2 className="inline text-base font-semibold text-(--color-text)">
          {t("forms.bench.title")}
        </h2>
        <span
          className="ms-2 text-sm font-normal text-(--color-text-muted)"
          data-testid="qcms-bench-digest"
        >
          {benchDigest(rule?.ruleId, references.length)}
        </span>
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
                    // One marked entry per question the condition reads, whether it
                    // resolves to a control or to the unpinned sentence. The digest's
                    // "reads N questions" is a count of exactly these, so the §3.7
                    // property - the fact in the summary also exists inside the panel -
                    // is a countable claim rather than an argued one (issue 519).
                    <div key={questionId} data-testid="qcms-bench-reference">
                      <AnswerControl
                        draft={draft}
                        library={library}
                        questionId={questionId}
                        value={answers[questionId]}
                        onChange={(value) => {
                          // Functional form on purpose: the handler outlives the render
                          // it was created in, so spreading the `answers` it closed over
                          // drops any sibling answer set since. Issue #224 is that exact
                          // loss in the question editor, two controls changed in one tick.
                          setAnswers((previous) => ({ ...previous, [questionId]: value }));
                        }}
                      />
                    </div>
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
              {/* Testid on the region as well as on its sentence, so the `aria-live` can
                  be asserted directly (#368). */}
              <p
                aria-live="polite"
                className="text-sm text-(--color-text)"
                data-testid="qcms-bench-status"
              >
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

/**
 * What the bench is loaded with, in the summary's own words (issue 519).
 *
 * Two facts, both of them inside the panel: the rule id is the Select's current value,
 * and the question count is the number of `qcms-bench-reference` entries the fieldset
 * renders. With no rules at all there is nothing to state, and the panel says so in its
 * own sentence.
 */
function benchDigest(ruleId: string | undefined, references: number): string {
  if (ruleId === undefined) return t("forms.bench.digest.noRules");
  return t("forms.bench.digest", {
    rule: ruleId,
    questions: tPlural(
      "forms.bench.digest.questionOne",
      "forms.bench.digest.questionOther",
      references,
    ),
  });
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
  readonly library: ReadState<readonly PinnableQuestion[]>;
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

/**
 * What control one referenced question needs, or `undefined` when it is not pinned.
 *
 * A library read that FAILED lands where a question the library does not hold lands: the
 * pinned version's type is unknown, so the bench renders the generic control it renders
 * for any unknown type (issues 572, 544). The library arrives as a `ReadState` rather than
 * as an array so that "unknown" is a fact this function was told rather than one it
 * inferred from an empty list somebody else invented.
 */
function controlFor(
  draft: DraftForm,
  library: ReadState<readonly PinnableQuestion[]>,
  questionId: string,
): AnswerControlShape | undefined {
  const pin = draftDocumentOrder(draft).find((entry) => entry.questionId === questionId);
  if (pin === undefined) return undefined;
  const question = library.ok
    ? library.data.find((entry) => entry.questionId === questionId)
    : undefined;
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
  library: ReadState<readonly PinnableQuestion[]>,
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
