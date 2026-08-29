"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/kit";
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
 * ## One rule, the one being edited (Code Owner, 2026-08-30)
 *
 * The bench used to sit under the rules table and take the whole draft's rules, with a
 * `Select` to pick between them. It is the third phase of the rule wizard now, so the rule
 * is decided before the bench is reached and the picker had nothing left to pick: an
 * author who wants to try a different rule opens that rule.
 *
 * The `draft` it is handed is the one the WIZARD is holding, which carries the rule as it
 * is currently being edited rather than as it was last saved. That is the whole value of
 * testing from inside a buffering dialog: the question "what would this rule do" is being
 * asked about the edit in progress, and the answer would be about the wrong rule if this
 * posted the stored draft. `plan/admin-design-contracts.md` §6's 2026-08-30 amendment is
 * where the buffering is recorded; `form-builder.tsx` is where the substitution is made.
 *
 * A consequence to expect rather than to be surprised by: while a rule is half-built the
 * draft carrying it is often unparseable (a rule with no target fails `show.min(1)`), and
 * the API answers that with an ordinary `unavailable`/`unparseableDraft` verdict rather
 * than an error. That is the endpoint's own deliberate behaviour, and the bench already
 * has a sentence for it.
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
  rule,
  library,
  previewCondition,
}: {
  /** The draft the verdict is computed against, carrying {@link rule} as it stands now. */
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
  }) => Promise<PreviewConditionState>;
}) {
  const [answers, setAnswers] = useState<Record<string, OperandValue>>({});
  const [state, setState] = useState<PreviewConditionState>(IDLE_PREVIEW);
  const [isPending, startTransition] = useTransition();

  const references = conditionReferences(rule.when);

  return (
    <section aria-labelledby="qcms-bench-heading" className="flex flex-col gap-3">
      {/* NOT A DISCLOSURE (Code Owner, 2026-08-29), and no longer a bordered panel either:
          it is a phase of a dialog now, and the dialog is the frame. The digest stays
          beside the heading - it was there to say what the panel held while it was shut,
          and open it is still the bench as one sentence.

          AN `h3`, matching the dialog's own title level. Inside a modal the rest of the
          document is `aria-hidden`, so the outline a reader navigates here starts at the
          dialog's `<h3>` title rather than at the screen's `<h1>`; an `h2` under it would
          be a level this dialog does not have. `e2e/a11y-axe.pw.ts` runs `heading-order`,
          which is what makes that a checked claim rather than a preference. */}
      <div>
        <h3 id="qcms-bench-heading" className="inline text-base font-semibold text-(--color-text)">
          {t("forms.bench.title")}
        </h3>
        <span
          className="ms-2 text-sm font-normal text-(--color-text-muted)"
          data-testid="qcms-bench-digest"
        >
          {benchDigest(rule.ruleId, references.length)}
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.bench.note")}</p>

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
      </div>
    </section>
  );
}

/**
 * What the bench is loaded with, in the summary's own words (issue 519).
 *
 * Two facts, both of them inside the panel: the rule id, which is also the dialog's own
 * title, and the question count, which is the number of `qcms-bench-reference` entries the
 * fieldset renders. "No rules to try" went with the rule picker on 2026-08-30 - the bench
 * is reached through a rule now, so there is no state in which it has none.
 */
function benchDigest(ruleId: string, references: number): string {
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
