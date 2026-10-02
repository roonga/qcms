import { t, type MessageKey } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { REPEAT_EVALUATION_BUDGET } from "./condition.ts";
import { findGroup, stepPins } from "./draft.ts";
import { isDraftGroup, type DraftForm, type FormIssue, type IssuePath } from "./types.ts";

/**
 * Publish issues, turned into something an author can read and reach (task 033).
 *
 * Two jobs, both pure, both tested, and neither of them a judgement about whether a draft
 * is legal - that answer comes from `POST .../draft/validate` and nowhere else (R2).
 *
 * 1. **A sentence per code.** The kernel's `PublishError` union is a machine contract, so
 *    every code gets prose that names the rule it enforces (ADR-16's forward-only pass,
 *    ADR-21's set equality, R6's frozen versions). A code this build has never heard of
 *    still renders, with the code in small print, rather than vanishing from the panel.
 * 2. **An anchor per issue.** Every issue carries a *structured domain path* rather than a
 *    positional index, which is the whole reason the panel can be a list of links: the
 *    path names a rule, a step or a pinned question, and the builder gives each of those a
 *    stable DOM id. The screen contract's a11y note asks for exactly this ("activating one moves
 *    focus to the target control").
 *
 * An anchor is only produced when the thing it names is **actually in the draft**. A
 * `DANGLING_QUESTION_REF` names a question that is by definition not pinned anywhere, so
 * an anchor derived from it alone would be a link to nothing; the panel renders those as
 * plain text instead. That is why {@link anchorFor} takes the draft.
 */

/** The DOM id of one rule's row on the rules screen. */
export function ruleAnchorId(ruleId: string): string {
  return `rule-${ruleId}`;
}

/** The rules screen of one form. */
export function rulesHref(formId: string): string {
  return `/forms/${encodeURIComponent(formId)}/rules`;
}

/**
 * The address of one rule: the rules ROUTE plus that rule's fragment.
 *
 * THE ROUTE IS PART OF THE LINK AND THAT IS THE POINT (Code Owner, 2026-09-05, issue
 * #669). Rule editing used to be a selection on the builder, so `#rule-{id}` on its own
 * resolved wherever an author happened to be standing. It is a route now, and a bare
 * fragment fired from the builder would scroll the builder to an element that is no longer
 * on it - a link that silently does nothing, which is exactly what
 * `plan/admin-ux-audit.md` §5.5 said a route split would cost if the anchors were not
 * rebuilt. The ruling's mandatory constraint is that they are: every link that must
 * survive the move carries the route as well as the fragment, and the click handler
 * switches route and then focuses.
 *
 * THE FRAGMENT IS NOT ESCAPED and the form id is, which is not an inconsistency. A
 * fragment has one job here: to equal the DOM id {@link ruleAnchorId} put on the row.
 * Escaping one side of that equality and not the other is how a link stops matching its
 * own destination, and the destination is what a reader is being sent to. Only a caller
 * that has found the rule in the draft ever builds one of these, so the id is this app's
 * own `rul_`-shaped value rather than arbitrary bytes off the wire.
 */
export function ruleHref(formId: string, ruleId: string): string {
  return `${rulesHref(formId)}#${ruleAnchorId(ruleId)}`;
}

/**
 * The fragment the rules screen reads as "open the wizard on a new rule".
 *
 * The same shape as the rail's `#new-step`, and the same reason: it is a request to the
 * BROWSER about what to do on arrival rather than a different resource, so `/rules` and
 * `/rules#new-rule` stay one page with one cache entry. `new-rule` rather than `add-rule`
 * for the reason `components/forms/rail-steps.tsx` records at length - `scripts/
 * check-admin-theme.mjs` reads `#add` as a three-digit hex colour.
 */
export const NEW_RULE_HASH = "#new-rule";

/** The DOM id of one step's region in the builder. */
export function stepAnchorId(stepId: string): string {
  return `step-${stepId}`;
}

/** The DOM id of one pinned question's row in the step editor. */
export function pinAnchorId(questionId: string): string {
  return `pin-${questionId}`;
}

/**
 * The DOM id of one repeating group's boundary row in the step editor.
 *
 * A group gets an anchor of its own because it is the subject of eight publish codes that
 * name no question at all - `REPEAT_MAX_MISSING`, `REPEAT_MIN_ABOVE_MAX`,
 * `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN` and the rest. Without one, every refusal about a
 * group's bounds or its label template would render as plain text in the validation panel
 * with nothing to move focus to, which is the state {@link anchorFor} exists to avoid.
 */
export function groupAnchorId(groupId: string): string {
  return `group-${groupId}`;
}

/** Every code this build has a sentence for. Anything else gets the fallback. */
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
  BLANK_LOCALIZED_TEXT: "forms.issue.blankText",
  // --- the repeating group's own refusals (ADR-42, Q24 to Q27) ---
  //
  // Every one of these is a shape that used to be unsayable rather than illegal, so each
  // sentence names the authoring gesture that answers it rather than restating the code.
  // The kernel owns the verdict and this app owns nothing but the wording (R2).
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
  // These two take substitutions, so they are composed by `messageForIssue` from the path
  // and the draft rather than rendered as fixed prose. They stay in this table because the
  // table is also the "is this code known to this build" test.
  RULE_TARGETS_SPAN_SCOPES: "forms.issue.targetsSpanScopes",
  REPEAT_EVALUATION_BUDGET_EXCEEDED: "forms.issue.budgetExceeded",
  TABLE_COLUMN_TYPE_NOT_ALLOWED: "forms.issue.tableColumnType",
  // Warnings (issue #123) share this table because they share the wire shape and the
  // renderer: one entry has one sentence, whether it refuses a publish or advises about
  // one. What separates them is where the panel puts them, not how they are read.
  MULTICHOICE_SAME_STEP_TARGET: "forms.warning.multiChoiceSameStep",
  PATTERN_CLASS_SET_AMBIGUOUS: "forms.warning.patternClassSet",
};

/**
 * The sentence explaining one issue's code.
 *
 * ## Two codes are COMPOSED rather than quoted, and that is the deliverable
 *
 * Every other code renders a fixed sentence, because the code alone says what is wrong and
 * the panel's own anchor says where. Two of the repeating group's do not:
 *
 * - **`RULE_TARGETS_SPAN_SCOPES`** has to name the scopes the rule straddles and tell the
 *   author to **split it into two rules**, which is always possible because the condition is
 *   copyable and the split changes nothing about what either rule means. A sentence that
 *   only reported the refusal would leave an author with a rule the kernel will not take and
 *   no idea that the remedy is mechanical.
 * - **`REPEAT_EVALUATION_BUDGET_EXCEEDED`** has to name both groups, both maxima and their
 *   product, and say that the refusal is about **this rule's cost and not about either
 *   group's size** (Q14 left no installation-wide ceiling, and the budget caps no group's
 *   `max`). Without that sentence the obvious reading is "my group is too big", and the
 *   author's next act would be to shrink a group for no reason.
 *
 * `draft` is optional because the two composed sentences are the only readers of it: a
 * caller with no draft to hand gets the same sentence with ids where the names would be,
 * which is honest rather than blank. The maxima come from the draft's own declarations,
 * which is also where the author will go to change them.
 */
export function messageForIssue(issue: FormIssue, draft?: DraftForm): string {
  const key = ISSUE_MESSAGES[issue.code];
  if (key === undefined) return t("forms.issue.unknown", { code: issue.code });
  if (issue.code === "RULE_TARGETS_SPAN_SCOPES") return spanScopesMessage(issue, draft);
  if (issue.code === "REPEAT_EVALUATION_BUDGET_EXCEEDED") return budgetMessage(issue, draft);
  return t(key);
}

/** What a group is called on screen: the author's own name for it, or its id. */
export function groupName(groupId: string, draft: DraftForm | undefined): string {
  if (draft === undefined) return groupId;
  const found = findGroup(draft, groupId);
  const label = found === undefined ? "" : textOf(found.group.label, draft.defaultLocale);
  return label === "" ? groupId : label;
}

/** One scope of a `show` list: a named group, or the form outside every group. */
function scopeName(scope: string, draft: DraftForm | undefined): string {
  return scope === "form" ? t("forms.issue.scopeForm") : groupName(scope, draft);
}

function spanScopesMessage(issue: FormIssue, draft: DraftForm | undefined): string {
  const scopes = issue.path?.scopes ?? [];
  // No scopes on the path is not a state the kernel produces, but this reads bytes off the
  // wire (`parseIssues`), so the sentence degrades to the remedy rather than to "and ".
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

/** A group's declared instance ceiling, which for a `fixed` count is the count itself. */
function declaredMax(groupId: string, draft: DraftForm | undefined): number | undefined {
  if (draft === undefined || groupId === "") return undefined;
  const found = findGroup(draft, groupId);
  if (found === undefined) return undefined;
  const count = found.group.count;
  return count.source === "fixed" ? count.count : count.max;
}

/**
 * A declared maximum, or the stand-in for a group whose `max` this build cannot read.
 *
 * `?` rather than a number: the only way to reach it is a group the draft no longer has or a
 * bounded source with the field still empty, and printing a 0 there would state a ceiling
 * nobody set.
 */
function maxLabel(max: number | undefined): string {
  return max === undefined ? "?" : String(max);
}

/**
 * The domain path, written out for a human.
 *
 * Ids rather than titles, deliberately: an id is what the author sees on the pin row, in
 * the JSON pane and in the rule heading, so a location written in ids is one they can
 * match by eye without a lookup.
 */
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

/** The first rule id a path names, whether it names one rule or a cycle of them. */
function ruleOf(path: IssuePath | undefined): string | undefined {
  return path?.rule ?? path?.rules?.[0];
}

/**
 * The DOM id an issue should move focus to, or `undefined` when nothing renders it.
 *
 * Precedence is rule, then pinned question, then step, and it follows the structure of the
 * codes rather than a preference: every `RULE_*` issue is a statement about a rule, and a
 * pin issue is a statement about one row inside a step, so the most specific rendered
 * element is always the right destination.
 */
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
  // A GROUP before its step, and after the question, by the same precedence the rest of
  // this function follows: the most specific rendered element wins. A refusal about a
  // group's bounds names no question, and a refusal about its count source names the count
  // question - which lives OUTSIDE the group, so the question anchor above is the better
  // destination for that one and this branch is reached only when there is no question.
  if (path.group !== undefined && findGroup(draft, path.group) !== undefined) {
    return groupAnchorId(path.group);
  }
  if (path.step !== undefined && draft.steps.some((step) => step.stepId === path.step)) {
    return stepAnchorId(path.step);
  }
  return undefined;
}

/**
 * The step whose screen renders the element {@link anchorFor} names, or `undefined` when
 * the anchor is not on a step screen at all.
 *
 * The builder is THREE screens behind one route since 2026-08-26, so an anchored issue link
 * can name an element that is real but not currently rendered: a pin lives inside one
 * step's editor, and the reader may be looking at the form, at the rules, or at another
 * step. This is what lets the link switch screens first rather than resolving to nothing.
 *
 * A rule anchor and a step anchor both return `undefined`, and for opposite reasons: a rule
 * is on the rules ROUTE, which {@link anchorIsOnRulesScreen} answers for separately, and a
 * step's own anchor is in the RAIL, which every screen of this route shows. Neither needs a
 * step to be selected.
 */
export function stepOwningAnchor(issue: FormIssue, draft: DraftForm): string | undefined {
  const path = issue.path;
  if (path === undefined) return undefined;
  if (ruleOf(path) !== undefined) return undefined;
  // A GROUP's own anchor is on its step's screen, exactly as a pin's is, so an issue about a
  // group bounds or label has to switch the selection before it can focus anything.
  if (path.group !== undefined) return findGroup(draft, path.group)?.stepId;
  const question = path.question;
  if (question === undefined) return undefined;
  return draft.steps.find((step) => stepPins(step).some((pin) => pin.questionId === question))
    ?.stepId;
}

/**
 * Whether the element {@link anchorFor} names is rendered by the RULES screen.
 *
 * The companion to {@link stepOwningAnchor}, and what tells a caller which of the two
 * moves an issue link has to make: switch the builder's step selection, or leave this
 * route entirely.
 *
 * IT IS A ROUTE SINCE 2026-09-05 (Code Owner, issue #669), and the audit's objection is
 * answered rather than avoided. `plan/admin-ux-audit.md` §5.5 warned that moving a panel
 * to its own route resolves every one of its focus anchors to nothing; the ruling's
 * mandatory constraint is that a link which must survive carries the route as well as the
 * fragment ({@link ruleHref}) and that its handler switches route before focusing. So the
 * two-hop path §5.5 priced is what an author gets, knowingly, and nothing disappears.
 *
 * Validation went the other way for a reason that does not apply here: its entries point
 * at controls the BUILDER renders - a pin row, a step row - so there is no route that
 * could carry them.
 */
export function anchorIsOnRulesScreen(issue: FormIssue, draft: DraftForm): boolean {
  return ruleForIssue(issue, draft) !== undefined;
}

/**
 * The rule this issue is about, when the draft actually has it, and `undefined` otherwise.
 *
 * The value behind {@link anchorIsOnRulesScreen}, exported because a caller that has to
 * BUILD the address needs the id rather than the yes/no. Reading it back out of the DOM id
 * would be parsing a string this module had just minted.
 */
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

/**
 * The issues that belong to one repeating group: about this group, and not about a rule.
 *
 * The same split `issuesForPin` makes, and for the same reason: a rule issue naming a group
 * (`DANGLING_GROUP_REF`, the budget refusal) is a statement about the RULE, and showing it on
 * the group panel would invite an author to change a group's bounds to fix a rule.
 */
export function issuesForGroup(
  issues: readonly FormIssue[],
  groupId: string,
): readonly FormIssue[] {
  return issues.filter(
    (issue) => issue.path?.group === groupId && issue.path?.rule === undefined,
  );
}

/** The issues that belong to one rule, including its share of a reported cycle. */
export function issuesForRule(issues: readonly FormIssue[], ruleId: string): readonly FormIssue[] {
  return issues.filter((issue) => {
    const path = issue.path;
    if (path === undefined) return false;
    return path.rule === ruleId || (path.rules ?? []).includes(ruleId);
  });
}

/**
 * How many issues each step carries, for the rail's per-step count tag.
 *
 * An issue counts against a step when it names the step outright, or when it names a
 * question pinned inside it. Rule issues are not attributed to a step: a rule belongs to
 * the form rather than to any one step, and spreading its count over the steps it happens
 * to mention would make the rail's numbers add up to more than the panel's.
 */
export function stepIssueCounts(
  issues: readonly FormIssue[],
  draft: DraftForm,
): ReadonlyMap<string, number> {
  const stepOfQuestion = new Map<string, string>();
  const stepOfGroup = new Map<string, string>();
  for (const step of draft.steps) {
    for (const pin of stepPins(step)) stepOfQuestion.set(pin.questionId, step.stepId);
    for (const item of step.items) {
      if (isDraftGroup(item)) stepOfGroup.set(item.groupId, step.stepId);
    }
  }
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const path = issue.path;
    if (path === undefined || ruleOf(path) !== undefined) continue;
    const stepId =
      path.step ??
      (path.question === undefined ? undefined : stepOfQuestion.get(path.question)) ??
      (path.group === undefined ? undefined : stepOfGroup.get(path.group));
    if (stepId === undefined) continue;
    counts.set(stepId, (counts.get(stepId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Read the API's `issues` array, which the route schema types as `unknown[]`.
 *
 * A view of the bytes rather than a second declaration of the union (the same stance
 * `types.ts` takes): anything with a string `code` and a string `message` is rendered,
 * and a `path` is carried through only where its fields have the expected primitive
 * shapes. Nothing is dropped for having an unfamiliar code, because a code this build
 * has not met is exactly the one an author most needs to see.
 */
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

/** The path fields that are plain strings, which is all of them but two. */
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

/** {@link IssuePath} while it is being assembled: same fields, writable. */
type MutableIssuePath = {
  -readonly [K in keyof IssuePath]: IssuePath[K];
};

/**
 * `unknown` -> keyed-object narrowing, as a predicate rather than a cast.
 *
 * `typeof x === "object" && x !== null` narrows only to `object`, which TypeScript will
 * not accept as `Record<string, unknown>` (no index signature), while an `as` cast there
 * is flagged unnecessary by the lint gate. A predicate satisfies both: the narrowing is
 * declared once, here, and every caller reads a properly typed value.
 */
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
