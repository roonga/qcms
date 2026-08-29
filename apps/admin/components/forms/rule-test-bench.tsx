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

/** What the API is asked, from either bench. */
type PreviewCondition = (input: {
  draft: DraftForm;
  ruleId: string;
  answers: Record<string, unknown>;
}) => Promise<PreviewConditionState>;

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
 * ## TWO BENCHES, ABOUT TWO DIFFERENT RULES (Code Owner, 2026-08-30)
 *
 * This module exports both, over one shared {@link BenchBody}:
 *
 * - {@link RuleTestBenchPanel} is the screen's, expanded under the rules table on the
 *   rules screen, with a `Select` to pick between the form's rules. It is about a rule as
 *   it was **stored**, which is the question an author asks while reading the table: "the
 *   form has these rules - what does that one do?"
 * - {@link RuleTestBench} is the wizard's third phase, about the ONE rule being edited and
 *   against the draft the WIZARD is holding, so it answers about the edit in progress
 *   rather than about the last save. The dialog buffers, so those are different rules
 *   until Save is pressed, and that difference is the whole value of testing from inside
 *   it. `plan/admin-design-contracts.md` §6's 2026-08-30 amendment records the buffering.
 *
 * Neither is redundant: one tests what the form currently does, the other tests what an
 * unsaved edit would do. The picker belongs to the screen alone, because in the wizard the
 * rule is decided before the bench is reached and there is nothing left to pick.
 *
 * A consequence to expect rather than to be surprised by: while a rule is half-built the
 * draft carrying it is often unparseable (a rule with no target fails `show.min(1)`), and
 * the API answers that with an ordinary `unavailable`/`unparseableDraft` verdict rather
 * than an error. That is the endpoint's own deliberate behaviour, and the bench already
 * has a sentence for it.
 *
 * ## The heading carries a digest (issue 519)
 *
 * Same change, same reasons, as the settings panel: a heading so the bench has an entry in
 * the outline at the level its frame uses (`plan/admin-ux-audit.md` §4.3), and a §3.7
 * digest whose every fact also exists inside the panel - the rule, and the number of
 * entries the "Hypothetical answers" fieldset renders.
 *
 * Two things the digest deliberately does not say. It states no **issue** count: the
 * validation panel owns the one authoritative count, and a second count of an overlapping
 * set is §5.6's named mistake. And it states no **outcome**: the verdict only exists after
 * a run, so before the first press "not run yet" would be a fact living in the summary
 * alone, which is exactly what §3.7 forbids.
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
  readonly previewCondition: PreviewCondition;
}) {
  return (
    <section
      aria-labelledby="qcms-bench-heading"
      data-testid="qcms-bench"
      className="flex flex-col gap-3"
    >
      {/* NOT A DISCLOSURE (Code Owner, 2026-08-29), and no bordered panel either: it is a
          phase of a dialog, and the dialog is the frame.

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
          {benchDigest(rule.ruleId, conditionReferences(rule.when).length)}
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.bench.note")}</p>
        <BenchBody
          draft={draft}
          rule={rule}
          library={library}
          previewCondition={previewCondition}
        />
      </div>
    </section>
  );
}

/**
 * The screen's bench: the form's rules, one picked at a time (Code Owner, 2026-08-30).
 *
 * EXPANDED, NOT A DISCLOSURE, for the reason the settings panel stopped being one: it
 * shipped shut because it shared a screen with four other panels, and it now sits under
 * the rules it tests on a screen of their own.
 *
 * The `key` on the body is the picked rule id, so changing the pick REMOUNTS it and the
 * hypothetical answers and the verdict start empty. Carrying them across would show a
 * verdict computed for one rule beside the id of another, which is the one wrong thing a
 * bench must never do.
 */
export function RuleTestBenchPanel({
  draft,
  rules,
  library,
  previewCondition,
}: {
  readonly draft: DraftForm;
  readonly rules: readonly DraftRule[];
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly previewCondition: PreviewCondition;
}) {
  const [ruleId, setRuleId] = useState(rules[0]?.ruleId ?? "");
  const rule = rules.find((candidate) => candidate.ruleId === ruleId) ?? rules[0];

  return (
    <section
      aria-labelledby="qcms-screen-bench-heading"
      data-testid="qcms-bench-screen"
      className="rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <div>
        <h2
          id="qcms-screen-bench-heading"
          className="inline text-base font-semibold text-(--color-text)"
        >
          {t("forms.bench.title")}
        </h2>
        <span
          className="ms-2 text-sm font-normal text-(--color-text-muted)"
          data-testid="qcms-bench-digest"
        >
          {benchDigest(
            rule?.ruleId,
            rule === undefined ? 0 : conditionReferences(rule.when).length,
          )}
        </span>
      </div>

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
              onChange={setRuleId}
            />
            <BenchBody
              key={rule.ruleId}
              draft={draft}
              rule={rule}
              library={library}
              previewCondition={previewCondition}
            />
          </>
        )}
      </div>
    </section>
  );
}

/** The answers, the run and the verdict: everything both benches share. */
function BenchBody({
  draft,
  rule,
  library,
  previewCondition,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly previewCondition: PreviewCondition;
}) {
  const [answers, setAnswers] = useState<Record<string, OperandValue>>({});
  const [state, setState] = useState<PreviewConditionState>(IDLE_PREVIEW);
  const [isPending, startTransition] = useTransition();

  const references = conditionReferences(rule.when);

  return (
    <>
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
  );
}

/**
 * What the bench is loaded with, in the heading's own words (issue 519).
 *
 * Two facts, both of them inside the panel: the rule id, and the question count, which is
 * the number of `qcms-bench-reference` entries the fieldset renders. `undefined` is only
 * reachable from the screen's bench, which can be looking at a form that has no rules yet.
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
