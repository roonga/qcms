import { t, type MessageKey } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { REPEAT_EVALUATION_BUDGET } from "./condition.ts";
import { findGroup, stepPins } from "./draft.ts";
import { isDraftGroup, type DraftForm, type FormIssue, type IssuePath } from "./types.ts";

// The API alone supplies legality. Map every issue to catalog copy and the most specific rendered control without dropping unfamiliar codes.

export function ruleAnchorId(ruleId: string): string {
  return `rule-${ruleId}`;
}

export function rulesHref(formId: string): string {
  return `/forms/${encodeURIComponent(formId)}/rules`;
}

// Include the rules route before its fragment; issue links can originate outside the screen that renders the control.
export function ruleHref(formId: string, ruleId: string): string {
  return `${rulesHref(formId)}#${ruleAnchorId(ruleId)}`;
}

// Use a fragment for an arrival action so opening a new-rule dialog does not create another server resource.
export const NEW_RULE_HASH = "#new-rule";

export function stepAnchorId(stepId: string): string {
  return `step-${stepId}`;
}

export function pinAnchorId(questionId: string): string {
  return `pin-${questionId}`;
}

// Group-only issues need a group anchor; no question control can represent a group bound or label refusal.
export function groupAnchorId(groupId: string): string {
  return `group-${groupId}`;
}

const ISSUE_MESSAGES: Readonly<Record<string, MessageKey>> = {
  DANGLING_QUESTION_REF: "forms.issue.danglingQuestion",
  DANGLING_OPTION_REF: "forms.issue.danglingOption",
  DANGLING_STEP_REF: "forms.issue.danglingStep",
  UNPUBLISHED_QUESTION_PIN: "forms.issue.unpublishedPin",
  LOCALE_INCOMPLETE: "forms.issue.localeIncomplete",
  RULE_BACKWARD_TARGET: "forms.issue.backwardTarget",
  RULE_CYCLE: "forms.issue.cycle",
  RULE_DEPTH_EXCEEDED: "forms.issue.depthExceeded",
  RULE_TYPE_MISMATCH: "forms.issue.typeMismatch",
  DUPLICATE_QUESTION_IN_FORM: "forms.issue.duplicateQuestion",
  DUPLICATE_STEP_ID: "forms.issue.duplicateStep",
  DEPRECATED_PIN: "forms.issue.deprecatedPin",

  FOREIGN_WORKSPACE_PIN: "forms.issue.foreignWorkspacePin",
  BLANK_LOCALIZED_TEXT: "forms.issue.blankText",

  DUPLICATE_GROUP_ID: "forms.issue.duplicateGroup",
  DANGLING_GROUP_REF: "forms.issue.danglingGroup",
  REPEAT_MAX_MISSING: "forms.issue.repeatMaxMissing",
  REPEAT_MIN_ABOVE_MAX: "forms.issue.repeatMinAboveMax",
  REPEAT_NESTING_NOT_ALLOWED: "forms.issue.repeatNesting",
  REPEAT_COUNT_BACKWARD_REF: "forms.issue.repeatCountBackward",
  REPEAT_COUNT_NOT_A_NUMBER: "forms.issue.repeatCountNotANumber",
  REPEAT_COUNT_INSIDE_GROUP: "forms.issue.repeatCountInsideGroup",
  INSTANCE_LABEL_PLACEHOLDER_UNKNOWN: "forms.issue.instanceLabelPlaceholder",
  REPEAT_OPERATOR_NESTING_NOT_ALLOWED: "forms.issue.repeatOperatorNesting",
  RULE_READS_GROUP_WITHOUT_OPERATOR: "forms.issue.readsGroupWithoutOperator",
  // Keep interpolated codes in the table because membership also decides whether this build recognises a code.
  RULE_TARGETS_SPAN_SCOPES: "forms.issue.targetsSpanScopes",
  REPEAT_EVALUATION_BUDGET_EXCEEDED: "forms.issue.budgetExceeded",
  TABLE_COLUMN_TYPE_NOT_ALLOWED: "forms.issue.tableColumnType",

  MULTICHOICE_SAME_STEP_TARGET: "forms.warning.multiChoiceSameStep",
  PATTERN_CLASS_SET_AMBIGUOUS: "forms.warning.patternClassSet",
};

// Scope-spanning rules require a split into separate rules with the same condition. When names are unavailable, IDs remain an honest fallback.
export function messageForIssue(issue: FormIssue, draft?: DraftForm): string {
  const key = ISSUE_MESSAGES[issue.code];
  if (key === undefined) return t("forms.issue.unknown", { code: issue.code });
  if (issue.code === "RULE_TARGETS_SPAN_SCOPES") return spanScopesMessage(issue, draft);
  if (issue.code === "REPEAT_EVALUATION_BUDGET_EXCEEDED") return budgetMessage(issue, draft);
  return t(key);
}

export function groupName(groupId: string, draft: DraftForm | undefined): string {
  if (draft === undefined) return groupId;
  const found = findGroup(draft, groupId);
  const label = found === undefined ? "" : textOf(found.group.label, draft.defaultLocale);
  return label === "" ? groupId : label;
}

function scopeName(scope: string, draft: DraftForm | undefined): string {
  return scope === "form" ? t("forms.issue.scopeForm") : groupName(scope, draft);
}

function spanScopesMessage(issue: FormIssue, draft: DraftForm | undefined): string {
  const scopes = issue.path?.scopes ?? [];
  // When wire data lacks scopes, show the remedy rather than an empty joined phrase.
  if (scopes.length === 0) return t("forms.issue.targetsSpanScopesBare");
  return t("forms.issue.targetsSpanScopes", {
    scopes: scopes.map((scope) => scopeName(scope, draft)).join(", "),
  });
}

function budgetMessage(issue: FormIssue, draft: DraftForm | undefined): string {
  const path = issue.path;
  const targetGroup = path?.targetGroup ?? "";
  const readGroup = path?.readGroup ?? "";
  const targetMax = declaredMax(targetGroup, draft);
  const readMax = declaredMax(readGroup, draft);
  return t("forms.issue.budgetExceeded", {
    targetGroup: groupName(targetGroup, draft),
    readGroup: groupName(readGroup, draft),
    targetMax: maxLabel(targetMax),
    readMax: maxLabel(readMax),
    product: targetMax === undefined || readMax === undefined ? "?" : String(targetMax * readMax),
    budget: REPEAT_EVALUATION_BUDGET,
  });
}

function declaredMax(groupId: string, draft: DraftForm | undefined): number | undefined {
  if (draft === undefined || groupId === "") return undefined;
  const found = findGroup(draft, groupId);
  if (found === undefined) return undefined;
  const count = found.group.count;
  return count.source === "fixed" ? count.count : count.max;
}

// An unreadable or unset maximum is unknown, not zero; never invent a ceiling.
function maxLabel(max: number | undefined): string {
  return max === undefined ? "?" : String(max);
}

export function locationOf(issue: FormIssue): string {
  const path = issue.path;
  if (path === undefined) return "";
  const parts: string[] = [];
  if (path.rule !== undefined) parts.push(path.rule);
  if (path.rules !== undefined && path.rules.length > 0) parts.push(path.rules.join(" -> "));
  if (path.step !== undefined) parts.push(path.step);
  if (path.question !== undefined) parts.push(path.question);
  if (path.option !== undefined) parts.push(path.option);
  if (path.target !== undefined) parts.push(path.target);
  if (path.locale !== undefined) parts.push(path.locale);
  if (path.version !== undefined) parts.push(`v${String(path.version)}`);
  return parts.join(" / ");
}

function ruleOf(path: IssuePath | undefined): string | undefined {
  return path?.rule ?? path?.rules?.[0];
}

// Prefer rule, question, group, then step anchors so focus reaches the most specific rendered control.
export function anchorFor(issue: FormIssue, draft: DraftForm): string | undefined {
  const path = issue.path;
  if (path === undefined) return undefined;
  const rule = ruleOf(path);
  if (rule !== undefined && draft.rules.some((candidate) => candidate.ruleId === rule)) {
    return ruleAnchorId(rule);
  }
  if (path.question !== undefined && isPinnedAnywhere(draft, path.question)) {
    return pinAnchorId(path.question);
  }
  // Prefer group before its step, but retain an external count question target when that is the refusal subject.
  if (path.group !== undefined && findGroup(draft, path.group) !== undefined) {
    return groupAnchorId(path.group);
  }
  if (path.step !== undefined && draft.steps.some((step) => step.stepId === path.step)) {
    return stepAnchorId(path.step);
  }
  return undefined;
}

// Select the owning step before focusing an anchor; the element may exist only in an inactive builder panel.
export function stepOwningAnchor(issue: FormIssue, draft: DraftForm): string | undefined {
  const path = issue.path;
  if (path === undefined) return undefined;
  if (ruleOf(path) !== undefined) return undefined;

  if (path.group !== undefined) return findGroup(draft, path.group)?.stepId;
  const question = path.question;
  if (question === undefined) return undefined;
  return draft.steps.find((step) => stepPins(step).some((pin) => pin.questionId === question))
    ?.stepId;
}

// Rule controls live on their own route; a local fragment cannot reach them from the builder.
export function anchorIsOnRulesScreen(issue: FormIssue, draft: DraftForm): boolean {
  return ruleForIssue(issue, draft) !== undefined;
}

export function ruleForIssue(issue: FormIssue, draft: DraftForm): string | undefined {
  const path = issue.path;
  if (path === undefined) return undefined;
  const rule = ruleOf(path);
  if (rule === undefined) return undefined;
  return draft.rules.some((candidate) => candidate.ruleId === rule) ? rule : undefined;
}

function isPinnedAnywhere(draft: DraftForm, questionId: string): boolean {
  return draft.steps.some((step) => stepPins(step).some((pin) => pin.questionId === questionId));
}

export function issuesForGroup(
  issues: readonly FormIssue[],
  groupId: string,
): readonly FormIssue[] {
  return issues.filter((issue) => issue.path?.group === groupId && issue.path?.rule === undefined);
}

export function issuesForRule(issues: readonly FormIssue[], ruleId: string): readonly FormIssue[] {
  return issues.filter((issue) => {
    const path = issue.path;
    if (path === undefined) return false;
    return path.rule === ruleId || (path.rules ?? []).includes(ruleId);
  });
}

// Do not spread form-owned rule issues across steps; attribute question issues to their pinned step.
export function stepIssueCounts(
  issues: readonly FormIssue[],
  draft: DraftForm,
): ReadonlyMap<string, number> {
  const owners = stepOwners(draft);
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const path = issue.path;
    if (path === undefined || ruleOf(path) !== undefined) continue;
    const stepId = stepForPath(path, owners);
    if (stepId === undefined) continue;
    counts.set(stepId, (counts.get(stepId) ?? 0) + 1);
  }
  return counts;
}

function stepOwners(draft: DraftForm): {
  readonly byQuestion: ReadonlyMap<string, string>;
  readonly byGroup: ReadonlyMap<string, string>;
} {
  const byQuestion = new Map<string, string>();
  const byGroup = new Map<string, string>();
  for (const step of draft.steps) {
    for (const pin of stepPins(step)) byQuestion.set(pin.questionId, step.stepId);
    for (const item of step.items) {
      if (isDraftGroup(item)) byGroup.set(item.groupId, step.stepId);
    }
  }
  return { byQuestion, byGroup };
}

function stepForPath(
  path: IssuePath,
  owners: {
    readonly byQuestion: ReadonlyMap<string, string>;
    readonly byGroup: ReadonlyMap<string, string>;
  },
): string | undefined {
  if (path.step !== undefined) return path.step;
  if (path.question !== undefined) return owners.byQuestion.get(path.question);
  if (path.group !== undefined) return owners.byGroup.get(path.group);
  return undefined;
}

// Preserve unfamiliar codes: those issues are especially important for an older editor to show.
export function parseIssues(raw: unknown): readonly FormIssue[] {
  if (!Array.isArray(raw)) return [];
  const parsed: FormIssue[] = [];
  for (const entry of raw) {
    const issue = entry as { code?: unknown; message?: unknown; path?: unknown };
    if (typeof issue.code !== "string" || typeof issue.message !== "string") continue;
    const path = parsePath(issue.path);
    parsed.push(
      path === undefined
        ? { code: issue.code, message: issue.message }
        : {
            code: issue.code,
            message: issue.message,
            path,
          },
    );
  }
  return parsed;
}

const STRING_PATH_KEYS = [
  "rule",
  "step",
  "group",
  "question",
  "option",
  "target",
  "locale",
  "placeholder",
  "outerGroup",
  "innerGroup",
  "targetGroup",
  "readGroup",
] as const;

type MutableIssuePath = {
  -readonly [K in keyof IssuePath]: IssuePath[K];
};

// A predicate supplies the record index signature that typeof object alone cannot establish.
function isKeyedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePath(raw: unknown): IssuePath | undefined {
  if (!isKeyedObject(raw)) return undefined;
  const source = raw;
  const path: MutableIssuePath = {};
  for (const key of STRING_PATH_KEYS) {
    const value = source[key];
    if (typeof value === "string") path[key] = value;
  }
  const version = source["version"];
  if (typeof version === "number") path.version = version;
  for (const key of ["rules", "scopes"] as const) {
    const list = source[key];
    if (Array.isArray(list)) {
      path[key] = list.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return Object.keys(path).length === 0 ? undefined : path;
}
