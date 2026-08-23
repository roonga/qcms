import { t, type MessageKey } from "../i18n/en.ts";

import type { DraftForm, FormIssue, IssuePath } from "./types.ts";

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

/** The DOM id of one rule's region in the builder. */
export function ruleAnchorId(ruleId: string): string {
  return `rule-${ruleId}`;
}

/** The DOM id of one step's region in the builder. */
export function stepAnchorId(stepId: string): string {
  return `step-${stepId}`;
}

/** The DOM id of one pinned question's row in the step editor. */
export function pinAnchorId(questionId: string): string {
  return `pin-${questionId}`;
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
};

/** The sentence explaining one issue's code. */
export function messageForIssue(issue: FormIssue): string {
  const key = ISSUE_MESSAGES[issue.code];
  return key === undefined ? t("forms.issue.unknown", { code: issue.code }) : t(key);
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
  if (path.step !== undefined && draft.steps.some((step) => step.stepId === path.step)) {
    return stepAnchorId(path.step);
  }
  return undefined;
}

function isPinnedAnywhere(draft: DraftForm, questionId: string): boolean {
  return draft.steps.some((step) => step.items.some((item) => item.questionId === questionId));
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
  for (const step of draft.steps) {
    for (const item of step.items) stepOfQuestion.set(item.questionId, step.stepId);
  }
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const path = issue.path;
    if (path === undefined || ruleOf(path) !== undefined) continue;
    const stepId =
      path.step ?? (path.question === undefined ? undefined : stepOfQuestion.get(path.question));
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
const STRING_PATH_KEYS = ["rule", "step", "question", "option", "target", "locale"] as const;

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
  const rules = source["rules"];
  if (Array.isArray(rules)) {
    path.rules = rules.filter((entry): entry is string => typeof entry === "string");
  }
  return Object.keys(path).length === 0 ? undefined : path;
}
