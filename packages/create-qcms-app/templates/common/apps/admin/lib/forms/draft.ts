import { DEFAULT_LOCALE, localizedDraft, textOf } from "../questions/definition.ts";

import { conditionGroupReferences } from "./condition.ts";
import {
  isDraftGroup,
  type DraftForm,
  type DraftGroup,
  type DraftPin,
  type DraftRepeatCount,
  type DraftRule,
  type DraftStep,
  type DraftStepItem,
  type PinnableQuestion,
  type RepeatPresentation,
} from "./types.ts";

// The API validates drafts; this editor must not import kernel values.

function identifierCore(text: string): string {
  const collapsed = text.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "_") start += 1;
  while (end > start && collapsed[end - 1] === "_") end -= 1;
  return collapsed.slice(start, end);
}

function mintId(prefix: string, text: string, taken: readonly string[], fallback: string): string {
  const core = identifierCore(text);
  const base = `${prefix}${core === "" ? fallback : core}`;
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function formIdFromSlug(slug: string): string {
  const core = identifierCore(slug);
  return core === "" ? "" : `frm_${core}`;
}

export function blankDraft(formId: string, defaultLocale = DEFAULT_LOCALE): DraftForm {
  return { formId, defaultLocale, title: {}, steps: [], rules: [] };
}

// Reserve every rule target ID, including dangling ones, to prevent assigning an old reference a new meaning.
function reservedStepIds(draft: DraftForm): readonly string[] {
  return [...draft.steps.map((step) => step.stepId), ...draft.rules.flatMap((rule) => rule.show)];
}

export function addStep(draft: DraftForm, title: string): DraftForm {
  const stepId = mintId("stp_", title, reservedStepIds(draft), "step");
  const step: DraftStep = { stepId, title: localizedDraft(title) ?? {}, items: [] };
  return { ...draft, steps: [...draft.steps, step] };
}

export function renameStep(draft: DraftForm, stepId: string, title: string): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) =>
      step.stepId === stepId ? { ...step, title: localizedDraft(title) ?? {} } : step,
    ),
  };
}

export function moveStep(draft: DraftForm, stepId: string, delta: -1 | 1): DraftForm {
  const index = draft.steps.findIndex((step) => step.stepId === stepId);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= draft.steps.length) return draft;
  const steps = [...draft.steps];
  const moved = steps[index];
  const displaced = steps[target];
  if (moved === undefined || displaced === undefined) return draft;
  steps[index] = displaced;
  steps[target] = moved;
  return { ...draft, steps };
}

// Leave dangling rule targets visible for validation; silently rewriting rules during deletion would lose authored work.
export function removeStep(draft: DraftForm, stepId: string): DraftForm {
  return { ...draft, steps: draft.steps.filter((step) => step.stepId !== stepId) };
}

// Reserve group IDs still referenced by rules so deleting and recreating cannot silently retarget a condition.
function reservedGroupIds(draft: DraftForm): readonly string[] {
  return [
    ...draftGroups(draft).map((group) => group.groupId),
    ...draft.rules.flatMap((rule) => conditionGroupReferences(rule.when)),
  ];
}

export function draftGroups(draft: DraftForm): readonly DraftGroup[] {
  return draft.steps.flatMap((step) => step.items.filter(isDraftGroup));
}

export function findGroup(
  draft: DraftForm,
  groupId: string,
): { readonly stepId: string; readonly group: DraftGroup } | undefined {
  for (const step of draft.steps) {
    for (const item of step.items) {
      if (isDraftGroup(item) && item.groupId === groupId) {
        return { stepId: step.stepId, group: item };
      }
    }
  }
  return undefined;
}

// A question is pinned at most once across steps and groups, so its group lookup has only one answer.
export function questionGroupIds(draft: DraftForm): ReadonlyMap<string, string> {
  const byQuestion = new Map<string, string>();
  for (const group of draftGroups(draft)) {
    for (const pin of group.items) {
      if (!byQuestion.has(pin.questionId)) byQuestion.set(pin.questionId, group.groupId);
    }
  }
  return byQuestion;
}

export function countBounds(count: DraftRepeatCount): {
  readonly min: number;
  readonly max: number | undefined;
} {
  return count.source === "fixed"
    ? { min: count.count, max: count.count }
    : { min: count.min, max: count.max };
}

// Derive the singular name from the authored instance template, not an English singularization guess.
export function instanceNoun(group: DraftGroup, locale = DEFAULT_LOCALE): string {
  const template = textOf(group.instanceLabel, locale);
  // Strip every template token from the singular noun, including unknown ones retained for publish validation.
  const stripped = template.replaceAll(/\{[^{}]*\}/g, "").trim();
  if (stripped !== "") return stripped;
  const label = textOf(group.label, locale);
  return label === "" ? group.groupId : label;
}

// Leave new group maxima unset: any default would invent an answer-changing limit. Validation asks the author to choose one.
const STARTING_COUNT: DraftRepeatCount = { source: "open", min: 1 };

// Mint permanent group IDs against both live and dangling references; renaming must not change them.
export function addGroup(draft: DraftForm, stepId: string, label: string): DraftForm {
  const groupId = mintId("grp_", label, reservedGroupIds(draft), "group");
  const group: DraftGroup = {
    groupId,
    label: localizedDraft(label) ?? {},
    instanceLabel: localizedDraft(label === "" ? "" : `${label} {n}`) ?? {},
    items: [],
    count: STARTING_COUNT,
    presentation: "stacked",
  };
  return {
    ...draft,
    steps: draft.steps.map((step) =>
      step.stepId === stepId ? { ...step, items: [...step.items, group] } : step,
    ),
  };
}

// Leave rules reading a removed group intact so validation exposes the dangling reference rather than losing logic.
export function removeGroup(draft: DraftForm, groupId: string): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      items: step.items.filter((item) => !(isDraftGroup(item) && item.groupId === groupId)),
    })),
  };
}

function withGroup(
  draft: DraftForm,
  groupId: string,
  change: (group: DraftGroup) => DraftGroup,
): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      items: step.items.map((item) =>
        isDraftGroup(item) && item.groupId === groupId ? change(item) : item,
      ),
    })),
  };
}

export function renameGroup(draft: DraftForm, groupId: string, label: string): DraftForm {
  return withGroup(draft, groupId, (group) => ({
    ...group,
    label: localizedDraft(label) ?? {},
  }));
}

export function setGroupInstanceLabel(
  draft: DraftForm,
  groupId: string,
  template: string,
): DraftForm {
  return withGroup(draft, groupId, (group) => ({
    ...group,
    instanceLabel: localizedDraft(template) ?? {},
  }));
}

// Refuse duplicate question pins across both ordinary and grouped items; one question cannot be repeated and non-repeated in the same form.
export function addPinToGroup(
  draft: DraftForm,
  groupId: string,
  questionId: string,
  version: number,
  index?: number,
): DraftForm {
  if (isPinned(draft, questionId)) return draft;
  const pin: DraftPin = { questionId, version };
  return withGroup(draft, groupId, (group) => {
    const at = Math.min(Math.max(index ?? group.items.length, 0), group.items.length);
    return { ...group, items: [...group.items.slice(0, at), pin, ...group.items.slice(at)] };
  });
}

export function movePinWithinGroup(
  draft: DraftForm,
  groupId: string,
  questionId: string,
  delta: -1 | 1,
): DraftForm {
  return withGroup(draft, groupId, (group) => {
    const index = group.items.findIndex((item) => item.questionId === questionId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= group.items.length) return group;
    const items = [...group.items];
    const moved = items[index];
    const displaced = items[target];
    if (moved === undefined || displaced === undefined) return group;
    items[index] = displaced;
    items[target] = moved;
    return { ...group, items };
  });
}

// Replace count sources whole; spreading between variants can retain incompatible fields the kernel rejects.
export function setGroupCount(
  draft: DraftForm,
  groupId: string,
  count: DraftRepeatCount,
): DraftForm {
  return withGroup(draft, groupId, (group) => ({ ...group, count }));
}

export function setGroupPresentation(
  draft: DraftForm,
  groupId: string,
  presentation: RepeatPresentation,
): DraftForm {
  return withGroup(draft, groupId, (group) => ({ ...group, presentation }));
}

// Expand groups in document order; questions themselves do not encode whether they repeat.
export function stepPins(step: DraftStep): readonly DraftPin[] {
  return step.items.flatMap((item) => (isDraftGroup(item) ? item.items : [item]));
}

export function pinnedQuestionIds(draft: DraftForm): readonly string[] {
  return draft.steps.flatMap((step) => stepPins(step).map((pin) => pin.questionId));
}

export function isPinned(draft: DraftForm, questionId: string): boolean {
  return pinnedQuestionIds(draft).includes(questionId);
}

// Index is an insertion boundary: zero prepends and items.length appends.
export function addPinAt(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  version: number,
  index: number,
): DraftForm {
  if (isPinned(draft, questionId)) return draft;
  const pin: DraftPin = { questionId, version };
  return {
    ...draft,
    steps: draft.steps.map((step) => {
      if (step.stepId !== stepId) return step;
      const at = Math.min(Math.max(index, 0), step.items.length);
      return { ...step, items: [...step.items.slice(0, at), pin, ...step.items.slice(at)] };
    }),
  };
}

export function addPin(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  version: number,
): DraftForm {
  const step = draft.steps.find((entry) => entry.stepId === stepId);
  return addPinAt(draft, stepId, questionId, version, step?.items.length ?? 0);
}

// Repoint only this form pin; bulk upgrades would change meaning across forms. Never move the pin into or out of a group.
export function movePin(draft: DraftForm, questionId: string, version: number): DraftForm {
  const repoint = (pin: DraftPin): DraftPin =>
    pin.questionId === questionId ? { questionId, version } : pin;
  return mapPins(draft, (step) => ({
    ...step,
    items: step.items.map((item) =>
      isDraftGroup(item) ? { ...item, items: item.items.map(repoint) } : repoint(item),
    ),
  }));
}

export function removePin(draft: DraftForm, questionId: string): DraftForm {
  const keep = (pin: DraftPin): boolean => pin.questionId !== questionId;
  return mapPins(draft, (step) => ({
    ...step,
    items: step.items
      .map((item) => (isDraftGroup(item) ? { ...item, items: item.items.filter(keep) } : item))
      .filter((item) => isDraftGroup(item) || keep(item)),
  }));
}

function mapPins(draft: DraftForm, change: (step: DraftStep) => DraftStep): DraftForm {
  return { ...draft, steps: draft.steps.map(change) };
}

export function movePinWithinStep(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  delta: -1 | 1,
): DraftForm {
  return moveStepItem(
    draft,
    stepId,
    (item) => !isDraftGroup(item) && item.questionId === questionId,
    delta,
  );
}

// Reordering must not silently change whether a question repeats; group membership uses explicit add and remove.
export function moveGroupWithinStep(
  draft: DraftForm,
  stepId: string,
  groupId: string,
  delta: -1 | 1,
): DraftForm {
  return moveStepItem(
    draft,
    stepId,
    (item) => isDraftGroup(item) && item.groupId === groupId,
    delta,
  );
}

function moveStepItem(
  draft: DraftForm,
  stepId: string,
  matches: (item: DraftStepItem) => boolean,
  delta: -1 | 1,
): DraftForm {
  return mapPins(draft, (step) => {
    if (step.stepId !== stepId) return step;
    const index = step.items.findIndex(matches);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= step.items.length) return step;
    const items = [...step.items];
    const moved = items[index];
    const displaced = items[target];
    if (moved === undefined || displaced === undefined) return step;
    items[index] = displaced;
    items[target] = moved;
    return { ...step, items };
  });
}

export function newRule(draft: DraftForm, questionId: string): DraftRule {
  const ruleId = mintId(
    "rul_",
    questionId.replace(/^q_/, ""),
    draft.rules.map((rule) => rule.ruleId),
    "rule",
  );
  return { ruleId, when: { op: "answered", questionId }, show: [] };
}

export function upsertRule(draft: DraftForm, rule: DraftRule): DraftForm {
  const exists = draft.rules.some((candidate) => candidate.ruleId === rule.ruleId);
  return exists
    ? updateRule(draft, rule.ruleId, rule)
    : { ...draft, rules: [...draft.rules, rule] };
}

export function addRule(draft: DraftForm, questionId: string): DraftForm {
  return upsertRule(draft, newRule(draft, questionId));
}

export function updateRule(draft: DraftForm, ruleId: string, next: DraftRule): DraftForm {
  return { ...draft, rules: draft.rules.map((rule) => (rule.ruleId === ruleId ? next : rule)) };
}

export function removeRule(draft: DraftForm, ruleId: string): DraftForm {
  return { ...draft, rules: draft.rules.filter((rule) => rule.ruleId !== ruleId) };
}

export interface DraftPosition {
  readonly stepId: string;
  readonly questionId: string;
  readonly version: number;
  readonly groupId?: string | undefined;
}

// Compute order over incomplete working drafts that the kernel cannot parse; the BFF has no kernel value import.
export function draftDocumentOrder(draft: DraftForm): readonly DraftPosition[] {
  return draft.steps.flatMap((step) =>
    step.items.flatMap((item) =>
      isDraftGroup(item)
        ? item.items.map((pin) => ({
            stepId: step.stepId,
            questionId: pin.questionId,
            version: pin.version,
            groupId: item.groupId,
          }))
        : [{ stepId: step.stepId, questionId: item.questionId, version: item.version }],
    ),
  );
}

// Targets must follow all condition references in the single forward pass. A whole-group read cuts after the entire group span.
export function eligibleTargets(
  draft: DraftForm,
  references: readonly string[],
  groupReferences: readonly string[] = [],
): { readonly questions: readonly string[]; readonly steps: readonly string[] } {
  const order = draftDocumentOrder(draft);
  const positionOf = new Map(order.map((entry, index) => [entry.questionId, index]));

  const spanEndOf = new Map<string, number>();
  order.forEach((entry, index) => {
    if (entry.groupId !== undefined) spanEndOf.set(entry.groupId, index);
  });

  const cuts = [
    ...references.map((questionId) => positionOf.get(questionId)),
    ...groupReferences.map((groupId) => spanEndOf.get(groupId)),
  ].filter((position): position is number => position !== undefined);
  // Unresolved references impose no order cut; publish validation reports their dangling-reference issues.
  const lastReference = cuts.length === 0 ? -1 : Math.max(...cuts);

  const questions = order
    .filter((entry) => (positionOf.get(entry.questionId) ?? -1) > lastReference)
    .map((entry) => entry.questionId);
  const eligible = new Set(questions);
  const steps = draft.steps
    .filter((step) => {
      const pins = stepPins(step);
      return pins.length > 0 && pins.every((pin) => eligible.has(pin.questionId));
    })
    .map((step) => step.stepId);
  return { questions, steps };
}

// A new rule with no targets is structurally unparseable; defer autosave until the author completes the intermediate state.
export type UnsaveableReason = "noSteps" | "emptyStep" | "emptyGroup" | "ruleWithoutTarget";

export function unsaveableReason(draft: DraftForm): UnsaveableReason | undefined {
  if (draft.steps.length === 0) return "noSteps";
  if (draft.steps.some((step) => step.items.length === 0)) return "emptyStep";
  // New empty groups are also structurally unparseable; keep the intermediate editor state without submitting a malformed save.
  if (draftGroups(draft).some((group) => group.items.length === 0)) return "emptyGroup";
  if (draft.rules.some((rule) => rule.show.length === 0)) return "ruleWithoutTarget";
  return undefined;
}

// Offer only published, non-deprecated versions for new pins.
export function pinnableVersions(question: PinnableQuestion): readonly number[] {
  return question.versions.filter((v) => v.status === "published").map((v) => v.version);
}

export function isPinnable(question: PinnableQuestion): boolean {
  return pinnableVersions(question).length > 0;
}

export function pinnedVersionStatus(
  question: PinnableQuestion | undefined,
  version: number,
): string | undefined {
  return question?.versions.find((v) => v.version === version)?.status;
}
