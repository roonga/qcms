"use client";

import { useState, useTransition } from "react";

import { Button, NumberField, Select } from "@/components/kit";
import {
  IDLE_PREVIEW,
  PREVIEW_INSTANCE_CAP,
  type PreviewConditionState,
} from "@/lib/forms/builder-state";
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

type PreviewCondition = (input: {
  draft: DraftForm;
  ruleId: string;
  answers: Record<string, unknown>;
  instances: Record<string, readonly string[]>;
}) => Promise<PreviewConditionState>;

/* Hypothetical answers go only to the API for evaluation; never persist or log them. Unavailable is
   distinct from noMatch. */
export function RuleTestBench({
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
  return (
    <section
      aria-labelledby="qcms-bench-heading"
      data-testid="qcms-bench"
      className="flex flex-col gap-3"
    >
      {/* Use h3 within the modal because its own title is h3 and the rest of the page outline is hidden. */}
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

/* Reset inputs and verdict when changing rules so one rule cannot display another rule's outcome. */
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

/* Zero instances are evaluable: everyInstance is false for an empty group, so its negation is true. */
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
                maxValue={countBounds(group.count).max ?? PREVIEW_INSTANCE_CAP}
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
              <div key={prompt.key} data-testid="qcms-bench-reference">
                <AnswerControl
                  draft={draft}
                  library={library}
                  questionId={prompt.questionId}
                  suffix={prompt.suffix}
                  value={answers[prompt.key]}
                  onChange={(value) => {
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

function benchGroupName(draft: DraftForm, group: DraftGroup): string {
  const label = group.label[draft.defaultLocale] ?? Object.values(group.label)[0] ?? "";
  return label === "" ? group.groupId : label;
}

/* These ids exist for one hypothetical request and must never be treated as session identity. */
function benchRoster(
  groups: readonly DraftGroup[],
  counts: Readonly<Record<string, number>>,
): Record<string, readonly string[]> {
  const rosters: Record<string, readonly string[]> = {};
  groups.forEach((group, index) => {
    const asked = counts[group.groupId] ?? countBounds(group.count).min;
    const ceiling = countBounds(group.count).max ?? PREVIEW_INSTANCE_CAP;
    rosters[group.groupId] = Array.from(
      { length: Math.min(Math.max(0, asked), ceiling) },
      (_entry, at) => `ins_g${String(index + 1)}_${String(at + 1)}`,
    );
  });
  return rosters;
}

interface BenchPrompt {
  readonly key: string;
  readonly questionId: string;
  readonly suffix: string;
}

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
  readonly suffix: string;
  readonly value: OperandValue | undefined;
  readonly onChange: (value: OperandValue) => void;
}) {
  const control = controlFor(draft, library, questionId);
  if (control === undefined) {
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

// eslint-disable-next-line sonarjs/function-return-type -- the union is what a type decides.
function startingAnswer(kind: OperandKind, options: readonly string[]): OperandValue {
  if (kind === "number") return 0;
  if (kind === "boolean") return false;
  if (kind === "option") return options[0] ?? "";
  if (kind === "optionList") return [];
  return "";
}

function outcomeSentence(state: PreviewConditionState): string {
  if (state.status === "idle") return "";
  if (state.status === "error") return t("forms.bench.failed", { message: state.message ?? "" });
  if (state.outcome === "match") return t("forms.bench.match");
  if (state.outcome === "noMatch") return t("forms.bench.noMatch");
  if (state.reason === undefined) return t("forms.bench.unavailable");
  const reason = t(`forms.bench.reason.${state.reason}`);
  return `${t("forms.bench.unavailable")} ${reason}`;
}
