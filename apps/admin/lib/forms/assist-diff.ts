import { stepPins } from "./draft.ts";
import { readDraftRules, readDraftSteps, readLocalizedText } from "./draft-payload.ts";
import type { DraftForm, DraftPin, DraftRule, DraftStep, FormIssue } from "./types.ts";

// Use the same draft reader for stored drafts, proposal diffs and acceptance so repeating groups cannot disappear in one view.

export interface ProposedQuestion {
  readonly questionId: string;
  readonly type: string;
}

export interface DiffEntry {
  readonly kind: "step" | "question" | "rule";
  readonly change: "added" | "changed";
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export function proposalDiff(
  current: DraftForm,
  proposedDraftRaw: unknown,
  newQuestionsRaw: unknown,
): readonly DiffEntry[] {
  const proposed = parseProposedDraft(proposedDraftRaw);
  const questionTypes = parseQuestionTypes(newQuestionsRaw);
  return [
    ...stepDiff(current.steps, proposed.steps, current.defaultLocale),
    ...questionDiff(current.steps, proposed.steps, questionTypes),
    ...ruleDiff(current.rules, proposed.rules),
  ];
}

// Keep formId and defaultLocale from the current route; the agent cannot propose another identity.
export function parseProposedDraft(raw: unknown): Pick<DraftForm, "title" | "steps" | "rules"> {
  if (!isKeyedObject(raw)) return { title: {}, steps: [], rules: [] };
  return {
    title: readLocalizedText(raw["title"]),
    steps: readDraftSteps(raw["steps"]),
    rules: readDraftRules(raw["rules"]),
  };
}

// Keep route-pinned identity while replacing accepted content; payload identity is not authoritative.
export function acceptedDraft(current: DraftForm, proposedDraftRaw: unknown): DraftForm {
  const proposed = parseProposedDraft(proposedDraftRaw);
  return {
    formId: current.formId,
    defaultLocale: current.defaultLocale,
    title: Object.keys(proposed.title).length > 0 ? proposed.title : current.title,
    steps: proposed.steps,
    rules: proposed.rules,
  };
}

function isKeyedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Compare object content independently of JSONB key ordering. Array order remains content.
function sameContent(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isKeyedObject(value)) return JSON.stringify(value) ?? "null";
  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
  return `{${entries.join(",")}}`;
}

function objects(raw: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter(isKeyedObject) : [];
}

// Only version-one step pins to questions created by this accept stop dangling. Unpinned rule and count references remain genuine errors.
export function pendingNewQuestionPins(
  proposedDraftRaw: unknown,
  newQuestionsRaw: unknown,
): ReadonlySet<string> {
  const invented = parseQuestionTypes(newQuestionsRaw);
  const pending = new Set<string>();
  for (const step of parseProposedDraft(proposedDraftRaw).steps) {
    for (const pin of stepPins(step)) {
      if (pin.version === 1 && invented.has(pin.questionId)) {
        pending.add(pinKey(step.stepId, pin.questionId));
      }
    }
  }
  return pending;
}

/* A question nothing has created yet reads as dangling; one an earlier plan step creates reads as an
   unpublished pin, because the draft was validated as it will stand once that step has run. */
const PENDING_PIN_CODES: readonly string[] = ["DANGLING_QUESTION_REF", "UNPUBLISHED_QUESTION_PIN"];

export function isPendingNewQuestionPin(issue: FormIssue, pending: ReadonlySet<string>): boolean {
  const path = issue.path;
  if (!PENDING_PIN_CODES.includes(issue.code) || path === undefined) return false;
  if (path.rule !== undefined || path.step === undefined || path.question === undefined) {
    return false;
  }
  return pending.has(pinKey(path.step, path.question));
}

function pinKey(stepId: string, questionId: string): string {
  return `${stepId}\u0000${questionId}`;
}

/** What a proposed question is called and what it is, as far as the proposal says. */
interface ProposedFacts {
  readonly type: string | undefined;
  readonly label: string | undefined;
}

function parseQuestionTypes(raw: unknown): ReadonlyMap<string, ProposedFacts> {
  const types = new Map<string, ProposedFacts>();
  for (const entry of objects(raw)) {
    const questionId = entry["questionId"];
    const type = entry["type"];
    const label = entry["label"];
    if (typeof questionId !== "string") continue;
    types.set(questionId, {
      type: typeof type === "string" ? type : undefined,
      label: typeof label === "string" ? label : localeText(label),
    });
  }
  return types;
}

function localeText(raw: unknown): string | undefined {
  const found = textOf(readLocalizedText(raw), "");
  return found === "" ? undefined : found;
}

function textOf(text: Readonly<Record<string, string>>, locale: string): string {
  const exact = text[locale];
  if (exact !== undefined && exact !== "") return exact;
  return Object.values(text).find((value) => value !== "") ?? "";
}

function stepDiff(
  current: readonly DraftStep[],
  proposed: readonly DraftStep[],
  locale: string,
): DiffEntry[] {
  const byId = new Map(current.map((step) => [step.stepId, step]));
  const entries: DiffEntry[] = [];
  for (const step of proposed) {
    const existing = byId.get(step.stepId);
    const label = textOf(step.title, locale) || step.stepId;
    if (existing === undefined) {
      entries.push({
        kind: "step",
        change: "added",
        id: step.stepId,
        label,
        detail: JSON.stringify(step, null, 2),
      });
    } else if (!sameContent(existing, step)) {
      entries.push({
        kind: "step",
        change: "changed",
        id: step.stepId,
        label,
        detail: JSON.stringify(step, null, 2),
      });
    }
  }
  return entries;
}

function flattenPins(steps: readonly DraftStep[]): readonly DraftPin[] {
  const seen = new Set<string>();
  const pins: DraftPin[] = [];
  for (const step of steps) {
    for (const pin of stepPins(step)) {
      if (seen.has(pin.questionId)) continue;
      seen.add(pin.questionId);
      pins.push(pin);
    }
  }
  return pins;
}

function questionDiff(
  currentSteps: readonly DraftStep[],
  proposedSteps: readonly DraftStep[],
  questionTypes: ReadonlyMap<string, ProposedFacts>,
): DiffEntry[] {
  const currentPins = new Map(flattenPins(currentSteps).map((pin) => [pin.questionId, pin]));
  const entries: DiffEntry[] = [];
  for (const pin of flattenPins(proposedSteps)) {
    const entry = questionDiffEntry(pin, currentPins.get(pin.questionId), questionTypes);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

function questionDiffEntry(
  pin: DraftPin,
  existing: DraftPin | undefined,
  questionTypes: ReadonlyMap<string, ProposedFacts>,
): DiffEntry | undefined {
  if (existing !== undefined && existing.version === pin.version) return undefined;
  const proposed = questionTypes.get(pin.questionId);
  const type = proposed?.type;
  const named = proposed?.label ?? pin.questionId;
  const label = type === undefined ? named : `${named} (${type})`;
  return {
    kind: "question",
    change: existing === undefined ? "added" : "changed",
    id: pin.questionId,
    label,
    detail: JSON.stringify({ ...pin, type }, null, 2),
  };
}

function ruleDiff(current: readonly DraftRule[], proposed: readonly DraftRule[]): DiffEntry[] {
  const byId = new Map(current.map((rule) => [rule.ruleId, rule]));
  const entries: DiffEntry[] = [];
  for (const rule of proposed) {
    const existing = byId.get(rule.ruleId);
    const label = rule.ruleId;
    if (existing === undefined) {
      entries.push({
        kind: "rule",
        change: "added",
        id: rule.ruleId,
        label,
        detail: JSON.stringify(rule, null, 2),
      });
    } else if (!sameContent(existing, rule)) {
      entries.push({
        kind: "rule",
        change: "changed",
        id: rule.ruleId,
        label,
        detail: JSON.stringify(rule, null, 2),
      });
    }
  }
  return entries;
}
