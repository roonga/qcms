import { t, type MessageKey } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import type { ReadState } from "../read-state.ts";

import { draftDocumentOrder, findGroup, instanceNoun } from "./draft.ts";
import type {
  DraftAnswerValue,
  DraftCondition,
  DraftForm,
  DraftRule,
  InstanceCountComparison,
  LeafConditionOp,
  PinnableQuestion,
} from "./types.ts";

// Resolve choice labels only from a successful library read; otherwise show the stored option ID honestly.

export interface RuleSentenceSegment {
  readonly text: string;

  readonly kind?: "question" | "step" | "group" | "value";
}

export function ruleSentence(
  rule: DraftRule,
  library: ReadState<readonly PinnableQuestion[]>,
  draft: DraftForm,
): readonly RuleSentenceSegment[] {
  const context = sentenceContext(library, draft);
  const condition = renderCondition(rule.when, context);
  if (rule.show.length === 0) {
    return merge(fill("forms.sentence.frameNoTargets", { condition }));
  }
  const targets = joinList(
    rule.show.map((id) => renderTarget(id, context)),
    "forms.sentence.listAnd",
  );
  return merge(fill("forms.sentence.frame", { condition, targets }));
}

// Resolve labels against the frozen version this form pins, not the latest library version.
interface SentenceContext {
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly draft: DraftForm;
  readonly pinnedVersions: ReadonlyMap<string, number>;
}

function sentenceContext(
  library: ReadState<readonly PinnableQuestion[]>,
  draft: DraftForm,
): SentenceContext {
  const pinnedVersions = new Map<string, number>();
  for (const position of draftDocumentOrder(draft)) {
    if (!pinnedVersions.has(position.questionId)) {
      pinnedVersions.set(position.questionId, position.version);
    }
  }
  return { library, draft, pinnedVersions };
}

function questionName(
  questionId: string,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if (!context.library.ok) return [{ text: t("forms.step.labelUnknown") }];
  const question = context.library.data.find((entry) => entry.questionId === questionId);
  const label = textOf(question?.label ?? undefined);
  return label === ""
    ? [{ text: t("forms.step.labelMissing") }]
    : [{ text: label, kind: "question" }];
}

function renderTarget(id: string, context: SentenceContext): readonly RuleSentenceSegment[] {
  const step = context.draft.steps.find((candidate) => candidate.stepId === id);
  if (step === undefined) return questionName(id, context);

  // Distinguish question targets from step targets; identical bare names would conceal what the rule shows.
  const title = textOf(step.title);
  const name: RuleSentenceSegment =
    title === "" ? { text: t("forms.steps.untitled") } : { text: title, kind: "step" };
  return merge(fill("forms.sentence.stepTarget", { name: [name] }));
}

type LeafCondition = Extract<DraftCondition, { readonly questionId: string }>;

const LEAF_FRAMES: Record<LeafConditionOp, MessageKey> = {
  answered: "forms.sentence.op.answered",
  equals: "forms.sentence.op.equals",
  notEquals: "forms.sentence.op.notEquals",
  in: "forms.sentence.op.in",
  contains: "forms.sentence.op.contains",
  containsAny: "forms.sentence.op.containsAny",
  gt: "forms.sentence.op.gt",
  gte: "forms.sentence.op.gte",
  lt: "forms.sentence.op.lt",
  lte: "forms.sentence.op.lte",
};

// Widen only the runtime lookup: keep the closed table exhaustive while allowing unknown wire operators to miss.
const LEAF_FRAME_FOR: Readonly<Record<string, MessageKey | undefined>> = LEAF_FRAMES;

// Match the node op directly; the separate operator predicate does not narrow the carrying node.
function renderCondition(
  condition: DraftCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if (condition.op === "and" || condition.op === "or") {
    const conjunction = condition.op === "and" ? "forms.sentence.listAnd" : "forms.sentence.listOr";
    if (condition.conditions.length === 0) return [{ text: t("forms.sentence.noBranches") }];
    return joinList(
      condition.conditions.map((child) => branch(child, context)),
      conjunction,
    );
  }
  if (condition.op === "not") return renderNot(condition.condition, context);
  if (
    condition.op === "anyInstance" ||
    condition.op === "everyInstance" ||
    condition.op === "instanceCount"
  ) {
    return renderGroupRead(condition, context);
  }
  return renderLeaf(condition, context);
}

// everyInstance is false for an empty group, so not(everyInstance) is true there.
function renderNot(
  inner: DraftCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if (inner.op === "everyInstance") {
    return fill("forms.sentence.op.notEveryInstance", {
      noun: groupNoun(inner.groupId, context),
      condition: branch(inner.condition, context),
    });
  }
  return fill("forms.sentence.not", { condition: renderCondition(inner, context) });
}

const COUNT_FRAMES: Record<InstanceCountComparison, MessageKey> = {
  equals: "forms.sentence.count.equals",
  gt: "forms.sentence.count.gt",
  gte: "forms.sentence.count.gte",
  lt: "forms.sentence.count.lt",
  lte: "forms.sentence.count.lte",
};

const COUNT_FRAME_FOR: Readonly<Record<string, MessageKey | undefined>> = COUNT_FRAMES;

// State that everyInstance requires a nonempty group; its false-on-empty meaning differs from classical universal quantification.
function renderGroupRead(
  condition: Extract<DraftCondition, { readonly groupId: string }>,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  const group = groupName(condition.groupId, context);
  const noun = groupNoun(condition.groupId, context);
  if (condition.op === "instanceCount") {
    const frame = COUNT_FRAME_FOR[condition.compare];
    if (frame === undefined) {
      return fill("forms.sentence.op.unknown", { op: [{ text: String(condition.compare) }] });
    }
    return fill(frame, { group, value: [{ text: String(condition.value) }] });
  }
  const frame =
    condition.op === "anyInstance"
      ? "forms.sentence.op.anyInstance"
      : "forms.sentence.op.everyInstance";
  // Bracket a nested and/or condition so the quantifier's boundary cannot change the sentence's meaning.
  return fill(frame, { noun, condition: branch(condition.condition, context) });
}

// Group and step names are form-owned and remain knowable when the question library read fails.
function groupName(groupId: string, context: SentenceContext): readonly RuleSentenceSegment[] {
  const found = findGroup(context.draft, groupId);
  if (found === undefined) return [{ text: groupId }];
  const label = textOf(found.group.label, context.draft.defaultLocale);
  return label === "" ? [{ text: groupId }] : [{ text: label, kind: "group" }];
}

// Use the authored singular instance template, not the plural group label.
function groupNoun(groupId: string, context: SentenceContext): readonly RuleSentenceSegment[] {
  const found = findGroup(context.draft, groupId);
  if (found === undefined) return [{ text: groupId }];
  return [{ text: instanceNoun(found.group, context.draft.defaultLocale), kind: "group" }];
}

function branch(
  condition: DraftCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  const rendered = renderCondition(condition, context);
  if (condition.op !== "and" && condition.op !== "or") return rendered;
  return fill("forms.sentence.group", { condition: rendered });
}

function renderLeaf(
  condition: LeafCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  const frame = LEAF_FRAME_FOR[condition.op];
  if (frame === undefined) {
    return fill("forms.sentence.op.unknown", { op: [{ text: String(condition.op) }] });
  }
  return fill(frame, {
    question: questionName(condition.questionId, context),

    value: renderOperand(condition, context),
  });
}

// values means alternatives and reads with or; multiChoice value is one set-equality answer and reads with and.
function renderOperand(
  condition: LeafCondition,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if ("values" in condition) {
    if (condition.values.length === 0) return [{ text: t("forms.sentence.emptyValue") }];
    return joinList(
      condition.values.map((value) => renderValue(value, condition.questionId, context)),
      "forms.sentence.listOr",
    );
  }
  if ("value" in condition) return renderValue(condition.value, condition.questionId, context);
  return [];
}

function renderValue(
  value: DraftAnswerValue,
  questionId: string,
  context: SentenceContext,
): readonly RuleSentenceSegment[] {
  if (typeof value === "boolean") {
    return [{ text: t(value ? "forms.operand.true" : "forms.operand.false") }];
  }
  if (typeof value === "number") return [{ text: String(value) }];
  if (typeof value === "string") return [choiceOrLiteral(value, questionId, context)];
  if (value.length === 0) return [{ text: t("forms.sentence.emptyValue") }];
  return joinList(
    value.map((optionId) => [choiceOrLiteral(optionId, questionId, context)]),
    "forms.sentence.listAnd",
  );
}

function choiceOrLiteral(
  text: string,
  questionId: string,
  context: SentenceContext,
): RuleSentenceSegment {
  if (text === "") return { text: t("forms.sentence.emptyValue") };
  const label = optionLabel(text, questionId, context);
  return label === undefined ? { text } : { text: label, kind: "value" };
}

function optionLabel(
  optionId: string,
  questionId: string,
  context: SentenceContext,
): string | undefined {
  if (!context.library.ok) return undefined;
  const version = context.pinnedVersions.get(questionId);
  if (version === undefined) return undefined;
  const question = context.library.data.find((entry) => entry.questionId === questionId);
  const pinned = question?.versions.find((candidate) => candidate.version === version);
  const option = pinned?.definition.options?.find((candidate) => candidate.optionId === optionId);
  const label = textOf(option?.label);
  return label === "" ? undefined : label;
}

// Leave an unsupplied placeholder visible; silently removing it would hide a missing interpolation.
function fill(
  key: MessageKey,
  parts: Readonly<Record<string, readonly RuleSentenceSegment[]>>,
): readonly RuleSentenceSegment[] {
  const template = t(key);
  const out: RuleSentenceSegment[] = [];
  const placeholder = /\{(\w+)\}/g;
  let cursor = 0;
  for (let found = placeholder.exec(template); found !== null; found = placeholder.exec(template)) {
    out.push({ text: template.slice(cursor, found.index) });
    const replacement = parts[found[1] ?? ""];
    if (replacement === undefined) out.push({ text: found[0] });
    else out.push(...replacement);
    cursor = found.index + found[0].length;
  }
  out.push({ text: template.slice(cursor) });
  return out;
}

function joinList(
  items: readonly (readonly RuleSentenceSegment[])[],
  conjunction: MessageKey,
): readonly RuleSentenceSegment[] {
  const first = items[0];
  if (first === undefined) return [];
  let joined = first;
  for (let index = 1; index < items.length; index += 1) {
    const next = items[index] ?? [];
    const separator = index === items.length - 1 ? conjunction : "forms.sentence.listComma";
    joined = fill(separator, { left: joined, right: next });
  }
  return joined;
}

function merge(segments: readonly RuleSentenceSegment[]): readonly RuleSentenceSegment[] {
  const out: RuleSentenceSegment[] = [];
  for (const segment of segments) {
    if (segment.text === "") continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && previous.kind === undefined && segment.kind === undefined) {
      out[out.length - 1] = { text: previous.text + segment.text };
      continue;
    }
    out.push(segment);
  }
  return out;
}
