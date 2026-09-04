import type { DraftForm, DraftPin, DraftRule, DraftStep } from "./types.ts";

/**
 * The proposal diff (task 041).
 *
 * The deliverable asks for one thing: what would accepting this proposal add or change,
 * grouped as steps, questions (with type) and rules, each line marked `+`/`~` in text
 * rather than by colour alone. This module answers that question and nothing else - it
 * is pure, so its test can hand it two draft-shaped values and read `DiffEntry[]` back
 * without a server, a fetch, or a component.
 *
 * `proposedDraft` arrives over the wire as `unknown` (`assist-stream.ts` does not parse
 * it, on purpose - that is this module's job). It is read the same tolerant way
 * `lib/server/forms.ts` reads every other API payload: a step or rule missing its own
 * id is dropped rather than crashing the panel, because a proposal the server already
 * validated is *expected* to be well-formed and a malformed one should degrade to "this
 * entry did not parse" rather than take the builder down with it.
 */

/** One question the proposal introduces, as much as the diff needs to label it. */
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

/**
 * The full diff: every step, pinned question and rule the proposal adds or changes,
 * relative to `current`. Order is steps, then questions, then rules, each in the
 * proposal's own order, grouped by kind.
 */
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

/**
 * Read a proposal's `proposedDraft` into the same shape the builder already edits.
 *
 * Exported so the panel's Accept action can turn the same payload into the `DraftForm`
 * it hands the builder, without a second, slightly different parser living beside this
 * one - accepting a proposal and diffing it are two views of the identical bytes.
 * `formId` and `defaultLocale` are not read from the payload: they identify *this*
 * form, are never the agent's to propose, and the route the proposal came in on
 * already pins them.
 */
export function parseProposedDraft(raw: unknown): Pick<DraftForm, "title" | "steps" | "rules"> {
  if (!isKeyedObject(raw)) return { title: {}, steps: [], rules: [] };
  return {
    title: isKeyedObject(raw["title"]) ? asLocalizedText(raw["title"]) : {},
    steps: parseSteps(raw["steps"]),
    rules: parseRules(raw["rules"]),
  };
}

/**
 * The `DraftForm` the builder should hold after Accept: the proposal's steps, rules
 * and title, addressed at *this* form. `formId` and `defaultLocale` come from
 * `current` rather than the payload, for the same reason `parseProposedDraft` does not
 * read them: they identify the form the route already pins, not something a proposal
 * gets to choose.
 */
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

function asLocalizedText(raw: Record<string, unknown>): Readonly<Record<string, string>> {
  const text: Record<string, string> = {};
  for (const [locale, value] of Object.entries(raw)) {
    if (typeof value === "string") text[locale] = value;
  }
  return text;
}

function objects(raw: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter(isKeyedObject) : [];
}

function parseSteps(raw: unknown): readonly DraftStep[] {
  return objects(raw)
    .filter((entry) => typeof entry["stepId"] === "string")
    .map((entry) => ({
      stepId: entry["stepId"] as string,
      title: isKeyedObject(entry["title"]) ? asLocalizedText(entry["title"]) : {},
      items: parsePins(entry["items"]),
    }));
}

function parsePins(raw: unknown): readonly DraftPin[] {
  return objects(raw)
    .filter(
      (entry) => typeof entry["questionId"] === "string" && typeof entry["version"] === "number",
    )
    .map((entry) => ({
      questionId: entry["questionId"] as string,
      version: entry["version"] as number,
    }));
}

function parseRules(raw: unknown): readonly DraftRule[] {
  return objects(raw)
    .filter((entry) => typeof entry["ruleId"] === "string" && isKeyedObject(entry["when"]))
    .map((entry) => ({
      ruleId: entry["ruleId"] as string,
      when: entry["when"] as DraftRule["when"],
      show: Array.isArray(entry["show"])
        ? entry["show"].filter((item): item is string => typeof item === "string")
        : [],
    }));
}

function parseQuestionTypes(raw: unknown): ReadonlyMap<string, string> {
  const types = new Map<string, string>();
  for (const entry of objects(raw)) {
    const questionId = entry["questionId"];
    const type = entry["type"];
    if (typeof questionId === "string" && typeof type === "string") types.set(questionId, type);
  }
  return types;
}

/** The text for one locale, falling back to the first entry the map carries. */
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
    } else if (JSON.stringify(existing) !== JSON.stringify(step)) {
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

/** Every pin across a draft's steps, first occurrence only (a form pins a question once). */
function flattenPins(steps: readonly DraftStep[]): readonly DraftPin[] {
  const seen = new Set<string>();
  const pins: DraftPin[] = [];
  for (const step of steps) {
    for (const pin of step.items) {
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
  questionTypes: ReadonlyMap<string, string>,
): DiffEntry[] {
  const currentPins = new Map(flattenPins(currentSteps).map((pin) => [pin.questionId, pin]));
  const entries: DiffEntry[] = [];
  for (const pin of flattenPins(proposedSteps)) {
    const entry = questionDiffEntry(pin, currentPins.get(pin.questionId), questionTypes);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

/** One proposed pin's diff entry, or `undefined` when it matches the current draft. */
function questionDiffEntry(
  pin: DraftPin,
  existing: DraftPin | undefined,
  questionTypes: ReadonlyMap<string, string>,
): DiffEntry | undefined {
  if (existing !== undefined && existing.version === pin.version) return undefined;
  const type = questionTypes.get(pin.questionId);
  const label = type === undefined ? pin.questionId : `${pin.questionId} (${type})`;
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
    } else if (JSON.stringify(existing) !== JSON.stringify(rule)) {
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
