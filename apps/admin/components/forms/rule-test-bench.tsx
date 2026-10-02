"use client";

import { useState, useTransition } from "react";

import { Button, NumberField, Select } from "@/components/kit";
import { IDLE_PREVIEW, type PreviewConditionState } from "@/lib/forms/builder-state";
import {
  conditionGroupReferences,
  conditionReferences,
  optionIdsOfVersion,
  typeOfPinnedVersion,
  type OperandKind,
} from "@/lib/forms/condition";
import { countBounds, draftDocumentOrder, draftGroups, questionGroupIds } from "@/lib/forms/draft";
import { ruleScope } from "@/lib/forms/rule-targets";
import type { DraftForm, DraftGroup, DraftRule, PinnableQuestion } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

import { answerKindForType, OperandControl, type OperandValue } from "./operand-control";

/** What the API is asked, from either bench. */
type PreviewCondition = (input: {
  draft: DraftForm;
  ruleId: string;
  answers: Record<string, unknown>;
  /** The hypothetical roster per group, minted by the bench (074, ADR-42 §6.4). */
  instances: Record<string, readonly string[]>;
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

/**
 * The answers, the run and the verdict: everything both benches share.
 *
 * ## The INSTANCE DIMENSION (task 074, ADR-42 §6.4)
 *
 * The bench is the surface where an author discovers that a rule they wrote reads the whole
 * group rather than one instance, so it has to be able to vary the roster as well as the
 * answers. Three things follow and all three are visible on the panel:
 *
 * 1. **A count per group the rule touches**, so the author sets how many hypothetical
 *    instances there are. The groups are the ones a whole-group operator names, the ones
 *    holding a question the condition reads, and the one holding the rule's target.
 * 2. **One answer control per instance** for a question inside a group, keyed
 *    `ins_g1_2/q_passport`, because a question inside a group has one answer per instance and
 *    no single value.
 * 3. **It is evaluable at ZERO instances**, which is not an edge case but the case the Q7
 *    ruling exists for: `everyInstance` over an empty group is FALSE rather than vacuously
 *    true, and its negation is therefore true - the shape an author is more likely to write,
 *    because a warning is usually phrased as a negation. Setting a count to 0 and pressing Run
 *    is how that reading becomes discoverable rather than documented.
 *
 * The bench mints the instance ids itself rather than asking the API for them, because the same
 * request carries answers keyed by them: a server-minted id would need a round trip before any
 * answer could be typed against it. They are positional and exist for one request.
 */
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
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const [state, setState] = useState<PreviewConditionState>(IDLE_PREVIEW);
  const [isPending, startTransition] = useTransition();

  const references = conditionReferences(rule.when);
  const groups = benchGroups(draft, rule);
  const instances = benchRoster(groups, counts);
  const groupOf = questionGroupIds(draft);
  /** One prompt per answer the bench needs: a key, and the question and instance behind it. */
  const prompts = benchPrompts(references, groupOf, instances);

  return (
    <>
      {groups.length > 0 && (
        <fieldset className="qcms-fieldset qcms-fieldset--flat" data-testid="qcms-bench-instances">
          <legend className="qcms-fieldset__legend">{t("forms.bench.instances")}</legend>
          <p className="text-sm text-(--color-text-muted)">{t("forms.bench.instancesNote")}</p>
          <div className="flex flex-wrap items-end gap-3">
            {groups.map((group) => (
              <NumberField
                key={group.groupId}
                label={t("forms.bench.instanceCount", { group: benchGroupName(draft, group) })}
                value={counts[group.groupId] ?? countBounds(group.count).min}
                minValue={0}
                onChange={(next) => {
                  setCounts((previous) => ({
                    ...previous,
                    [group.groupId]: Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0,
                  }));
                }}
              />
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="qcms-fieldset qcms-fieldset--flat">
        <legend className="qcms-fieldset__legend">{t("forms.bench.answers")}</legend>
        {prompts.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("forms.bench.noReferences")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {prompts.map((prompt) => (
              // One marked entry per ANSWER the bench needs, which is one per question outside
              // a group and one per instance inside one. The digest's "reads N questions" is a
              // count of the questions rather than of these entries, and the two differ exactly
              // when a group is involved - which is the honest reading of both numbers.
              <div key={prompt.key} data-testid="qcms-bench-reference">
                <AnswerControl
                  draft={draft}
                  library={library}
                  questionId={prompt.questionId}
                  suffix={prompt.suffix}
                  value={answers[prompt.key]}
                  onChange={(value) => {
                    // Functional form on purpose: the handler outlives the render
                    // it was created in, so spreading the `answers` it closed over
                    // drops any sibling answer set since. Issue #224 is that exact
                    // loss in the question editor, two controls changed in one tick.
                    setAnswers((previous) => ({ ...previous, [prompt.key]: value }));
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
                  answers: answersToSend(draft, library, prompts, answers),
                  instances,
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

      <InstanceVerdicts state={state} />
    </>
  );
}

/**
 * The per-instance verdict, for a rule the API reports as evaluated per instance.
 *
 * `instanceOutcomes` is present exactly when the rule's target sits inside a group, and it is
 * **empty rather than absent** when that group has no instance - which is the zero-instance case
 * from the panel's side, and the reason this says so in words rather than rendering nothing. A
 * list that silently disappeared at zero would leave the author looking at a single verdict with
 * no sign that it was a verdict about no instances at all.
 */
function InstanceVerdicts({ state }: { readonly state: PreviewConditionState }) {
  const outcomes = state.instanceOutcomes;
  if (outcomes === undefined) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="qcms-bench-instance-outcomes">
      {outcomes.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-outcome="noInstances">
          {t("forms.bench.noInstances")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {outcomes.map((entry, index) => (
            <li
              key={entry.instanceId}
              className="text-sm text-(--color-text)"
              data-instance-outcome={entry.outcome}
            >
              {t(
                entry.outcome === "match"
                  ? "forms.bench.instanceMatch"
                  : "forms.bench.instanceNoMatch",
                { position: index + 1 },
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The repeating groups one rule touches, in the draft's document order.
 *
 * Three ways a rule reaches a group, and the bench needs a count for every one of them: a
 * whole-group operator names it; a bare condition reference sits inside it (the inside-out case,
 * where scope is implicit by position); or the rule's TARGET sits inside it, which is what makes
 * the whole rule per-instance. A group the rule does not touch gets no field, because a count
 * for it would change nothing the bench could report.
 */
function benchGroups(draft: DraftForm, rule: DraftRule): readonly DraftGroup[] {
  const groupOf = questionGroupIds(draft);
  const wanted = new Set<string>(conditionGroupReferences(rule.when));
  for (const questionId of conditionReferences(rule.when)) {
    const groupId = groupOf.get(questionId);
    if (groupId !== undefined) wanted.add(groupId);
  }
  const scope = ruleScope(draft, rule.show);
  if (scope.kind === "group") wanted.add(scope.groupId);
  return draftGroups(draft).filter((group) => wanted.has(group.groupId));
}

/** What a group is called on the bench: the author's own name for it, or its id. */
function benchGroupName(draft: DraftForm, group: DraftGroup): string {
  const label = group.label[draft.defaultLocale] ?? Object.values(group.label)[0] ?? "";
  return label === "" ? group.groupId : label;
}

/**
 * The hypothetical instance ids per group, minted positionally.
 *
 * `ins_g1_2` is group 1's second instance. The group's index rather than its id keeps the id
 * short and inside the `ins_[a-z0-9_]+` grammar whatever an author named their group, and
 * positional minting means a typed answer stays on the same card when the author adds one more
 * instance. Nothing here is a session's id: these exist for one request and are never stored.
 */
function benchRoster(
  groups: readonly DraftGroup[],
  counts: Readonly<Record<string, number>>,
): Record<string, readonly string[]> {
  const rosters: Record<string, readonly string[]> = {};
  groups.forEach((group, index) => {
    const count = counts[group.groupId] ?? countBounds(group.count).min;
    rosters[group.groupId] = Array.from(
      { length: Math.max(0, count) },
      (_entry, at) => `ins_g${String(index + 1)}_${String(at + 1)}`,
    );
  });
  return rosters;
}

/** One answer the bench prompts for: its key, the question behind it, and which instance. */
interface BenchPrompt {
  /** The answer key the API reads: a bare questionId, or `instanceId/questionId`. */
  readonly key: string;
  readonly questionId: string;
  /** What the control's label says after the question, or `""` outside every group. */
  readonly suffix: string;
}

/**
 * The prompts for one condition's references: one per question outside every group, and one per
 * live hypothetical instance for a question inside one.
 *
 * A question inside a group whose count is zero contributes NO prompt, which is the honest
 * rendering: there is no instance to answer it for. That is also what makes the zero-instance
 * case readable rather than confusing - the answers fieldset empties, and the verdict below is
 * about a group with nothing in it.
 */
function benchPrompts(
  references: readonly string[],
  groupOf: ReadonlyMap<string, string>,
  instances: Readonly<Record<string, readonly string[]>>,
): readonly BenchPrompt[] {
  return references.flatMap((questionId) => {
    const groupId = groupOf.get(questionId);
    if (groupId === undefined) return [{ key: questionId, questionId, suffix: "" }];
    return (instances[groupId] ?? []).map((instanceId, at) => ({
      key: `${instanceId}/${questionId}`,
      questionId,
      suffix: t("forms.bench.instanceSuffix", { position: at + 1 }),
    }));
  });
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
  suffix,
  value,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly questionId: string;
  /**
   * Which instance this control answers for, or `""` for a question outside every group.
   *
   * It is part of the control's NAME rather than a heading above a group of them, because a
   * screen reader announces a field by its label: six passenger fields that all answer to
   * "q_passport@1" are six fields nobody can tell apart.
   */
  readonly suffix: string;
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
      label={`${questionId}@${String(control.version)}${suffix}`}
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
  prompts: readonly BenchPrompt[],
  entered: Readonly<Record<string, OperandValue>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const prompt of prompts) {
    const control = controlFor(draft, library, prompt.questionId);
    if (control === undefined) continue;
    payload[prompt.key] = entered[prompt.key] ?? startingAnswer(control.kind, control.options);
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
