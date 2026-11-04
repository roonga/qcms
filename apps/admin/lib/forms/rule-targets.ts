import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { eligibleTargets, findGroup, instanceNoun, questionGroupIds, stepPins } from "./draft.ts";
import type { DraftForm, DraftGroup } from "./types.ts";

// A straddling step has a backward whole-step target but may still have forward individual question targets; show both choices.

export interface TargetOption {
  readonly id: string;

  readonly label: string;
  readonly kind: "question" | "step";

  readonly groupId?: string | undefined;
}

export interface TargetStepGroup {
  readonly stepId: string;

  readonly title: string;
  readonly options: readonly TargetOption[];
}

export interface TargetGroups {
  readonly eligible: readonly TargetStepGroup[];
  readonly ineligible: readonly TargetStepGroup[];
}

// Split scope-spanning targets into separate rules with the same condition; that preserves their meaning.
export type RuleScope =
  | { readonly kind: "none" }
  | { readonly kind: "form" }
  | {
      readonly kind: "group";
      readonly groupId: string;

      readonly label: string;

      readonly noun: string;
    }
  | { readonly kind: "spanning"; readonly scopes: readonly string[] };

export function ruleScope(draft: DraftForm, show: readonly string[]): RuleScope {
  if (show.length === 0) return { kind: "none" };
  const groupOf = questionGroupIds(draft);
  const scopes = new Set<string>();
  for (const target of show) {
    // A step target is form-scoped: expanding it can include questions outside any one repeating group.
    if (draft.steps.some((step) => step.stepId === target)) {
      scopes.add("form");
      continue;
    }
    const groupId = groupOf.get(target);
    if (groupId !== undefined) scopes.add(groupId);
    else if (draft.steps.some((step) => stepPins(step).some((p) => p.questionId === target))) {
      scopes.add("form");
    }
  }
  const only = [...scopes];
  if (only.length === 0) return { kind: "none" };
  if (only.length > 1) return { kind: "spanning", scopes: only };
  const single = only[0];
  if (single === undefined || single === "form") return { kind: "form" };
  const found = findGroup(draft, single);
  if (found === undefined) return { kind: "form" };
  return {
    kind: "group",
    groupId: single,
    label: groupLabel(draft, found.group),
    noun: instanceNoun(found.group, draft.defaultLocale),
  };
}

function groupLabel(draft: DraftForm, group: DraftGroup): string {
  const label = textOf(group.label, draft.defaultLocale);
  return label === "" ? group.groupId : label;
}

// Use the same scope vocabulary in chips and rule sentences.
export function scopeChipLabel(scope: RuleScope): string | undefined {
  if (scope.kind === "group") return t("forms.rule.scopePerInstance", { noun: scope.noun });
  return undefined;
}

export function countTargets(groups: TargetGroups): number {
  return [...groups.eligible, ...groups.ineligible].reduce(
    (total, group) => total + group.options.length,
    0,
  );
}

function stepTitle(draft: DraftForm, stepId: string): string {
  const step = draft.steps.find((candidate) => candidate.stepId === stepId);
  const title = step === undefined ? "" : textOf(step.title, draft.defaultLocale);
  return title === "" ? stepId : title;
}

export function targetGroups(
  draft: DraftForm,
  references: readonly string[],

  groupReferences: readonly string[] = [],
): TargetGroups {
  const eligible = eligibleTargets(draft, references, groupReferences);
  const eligibleIds = new Set<string>([...eligible.questions, ...eligible.steps]);
  const groupOf = questionGroupIds(draft);

  const build = (wanted: boolean): readonly TargetStepGroup[] =>
    draft.steps
      .map((step) => {
        const options: TargetOption[] = [];

        if (stepPins(step).length > 0 && eligibleIds.has(step.stepId) === wanted) {
          options.push({ id: step.stepId, label: step.stepId, kind: "step" });
        }

        for (const pin of stepPins(step)) {
          if (eligibleIds.has(pin.questionId) === wanted) {
            const groupId = groupOf.get(pin.questionId);
            options.push({
              id: pin.questionId,
              label: pin.questionId,
              kind: "question",
              ...(groupId === undefined ? {} : { groupId }),
            });
          }
        }
        return { stepId: step.stepId, title: stepTitle(draft, step.stepId), options };
      })
      .filter((group) => group.options.length > 0);

  // Reuse the wizard reference list for grouping, backward checks and the bench.
  return { eligible: build(true), ineligible: build(false) };
}

// A matching step title keeps its questions because authors can search by the container name.
export function filterTargets(groups: TargetGroups, query: string): TargetGroups {
  const needle = query.trim().toLowerCase();
  if (needle === "") return groups;

  const narrow = (list: readonly TargetStepGroup[]): readonly TargetStepGroup[] =>
    list
      .map((group) => {
        const stepMatches =
          group.stepId.toLowerCase().includes(needle) || group.title.toLowerCase().includes(needle);
        if (stepMatches) return group;
        return {
          ...group,
          options: group.options.filter((option) => option.label.toLowerCase().includes(needle)),
        };
      })
      .filter((group) => group.options.length > 0);

  return { eligible: narrow(groups.eligible), ineligible: narrow(groups.ineligible) };
}
