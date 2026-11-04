import type { Condition } from "@roonga/qcms-core";

import type { QuestionType } from "../questions/types.ts";

import type {
  ConditionOp,
  DraftAnswerValue,
  DraftCondition,
  GroupConditionOp,
  InstanceCountComparison,
  LeafConditionOp,
  PinnableQuestion,
} from "./types.ts";

// Build complete schema-shaped nodes on every edit so the UI never emits malformed DSL.

// Mirror kernel limits without a value import; condition tests pin the declarations together.
export const MAX_CONDITION_DEPTH = 8;

// Mirror the evaluation budget only to explain the limit; the kernel enforces it.
export const REPEAT_EVALUATION_BUDGET = 10_000;

// The type-level gate makes new kernel operators fail here until the closed editor vocabulary is updated.
const OP_ARITY = {
  answered: "leaf",
  equals: "leaf",
  notEquals: "leaf",
  in: "leaf",
  gt: "leaf",
  gte: "leaf",
  lt: "leaf",
  lte: "leaf",
  contains: "leaf",
  containsAny: "leaf",
  and: "combinator",
  or: "combinator",
  not: "combinator",
  // Whole-group operators form a third arity: they name groups, not question leaves or combinator lists.
  anyInstance: "group",
  everyInstance: "group",
  instanceCount: "group",
} satisfies Record<Condition["op"], "leaf" | "combinator" | "group">;

export function isCombinator(op: ConditionOp): op is "and" | "or" | "not" {
  return OP_ARITY[op] === "combinator";
}

// Whole-group reads cannot nest another whole-group read; quantifiers carry a child and instanceCount carries a comparison.
export function isGroupOp(op: ConditionOp): op is GroupConditionOp {
  return OP_ARITY[op] === "group";
}

export type OperandKind =
  | "none"
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "option"
  | "optionList"
  | "textList"
  | "numberList"
  | "dateList"
  | "unsupported";

function equalityOperand(type: QuestionType): OperandKind {
  switch (type) {
    case "shortText":
    case "longText":
      return "text";
    case "number":
      return "number";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    case "singleChoice":
      return "option";
    case "multiChoice":
      return "optionList";
  }
}

function membershipOperand(type: QuestionType): OperandKind {
  switch (type) {
    case "shortText":
    case "longText":
      return "textList";
    case "number":
      return "numberList";
    case "date":
      return "dateList";
    case "singleChoice":
      return "optionList";
    case "boolean":
    case "multiChoice":
      return "unsupported";
  }
}

export function operandKind(op: LeafConditionOp, type: QuestionType | undefined): OperandKind {
  if (type === undefined) return "unsupported";
  switch (op) {
    case "answered":
      return "none";
    case "equals":
    case "notEquals":
      return equalityOperand(type);
    case "in":
      return membershipOperand(type);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      if (type === "number") return "number";
      if (type === "date") return "date";
      return "unsupported";
    case "contains":
      return type === "multiChoice" ? "option" : "unsupported";
    case "containsAny":
      return type === "multiChoice" ? "optionList" : "unsupported";
  }
}

export function isOpSupported(op: LeafConditionOp, type: QuestionType | undefined): boolean {
  return operandKind(op, type) !== "unsupported";
}

export function optionIdsOfVersion(
  question: PinnableQuestion | undefined,
  version: number,
): readonly string[] {
  const found = question?.versions.find((v) => v.version === version);
  return (found?.definition.options ?? []).map((option) => option.optionId);
}

export function typeOfPinnedVersion(
  question: PinnableQuestion | undefined,
  version: number,
): QuestionType | undefined {
  const found = question?.versions.find((v) => v.version === version);
  return found?.definition.type;
}

// Use a fixed canonical date placeholder so a new node parses and SSR never depends on the current clock.
export const DATE_OPERAND_PLACEHOLDER = "2000-01-01";

// Initial operands must satisfy required schema shapes; empty lists and dates are malformed, not merely unfinished.
// The operand runtime type is being selected; callers need the heterogeneous closed answer union.
// eslint-disable-next-line sonarjs/function-return-type
function startingOperand(kind: OperandKind, options: readonly string[]): DraftAnswerValue {
  switch (kind) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "date":
      return DATE_OPERAND_PLACEHOLDER;
    case "option":
      return options[0] ?? "";
    case "optionList":
      return options[0] === undefined ? [] : [options[0]];
    // Keep optionList as a whole-answer array for multiChoice set equality.
    case "textList":
      return "";
    case "numberList":
      return 0;
    case "dateList":
      return DATE_OPERAND_PLACEHOLDER;
    case "text":
    case "none":
    case "unsupported":
    default:
      return "";
  }
}

// Rebuild nodes on operator changes so incompatible operand keys cannot survive a spread.
export function conditionForOp(
  op: ConditionOp,
  questionId: string,
  type: QuestionType | undefined,
  options: readonly string[],
  previous?: DraftCondition,

  groupId?: string,
): DraftCondition {
  if (op === "not") {
    return { op, condition: notChildOf(previous) ?? { op: "answered", questionId } };
  }
  if (op === "and" || op === "or") {
    return { op, conditions: childrenOf(previous, questionId) };
  }
  if (isGroupOp(op)) {
    // Without a group there is no legal whole-group node; fall back rather than creating a dangling reference.
    if (groupId === undefined || groupId === "") return { op: "answered", questionId };
    if (op === "instanceCount") return { op, groupId, compare: "gte", value: 1 };
    return {
      op,
      groupId,
      condition: groupNestedOf(previous) ?? { op: "answered", questionId },
    };
  }
  const kind = operandKind(op, type);
  const answered = { op: "answered", questionId } as const;
  if (kind === "unsupported") return answered;

  const needsOption = kind === "option" || (kind === "optionList" && op !== "equals");
  if (needsOption && options.length === 0) return answered;
  const starting = startingOperand(kind, options);

  switch (op) {
    case "answered":
      return answered;
    case "equals":
    case "notEquals":
      return { op, questionId, value: starting };
    case "in":
      return { op, questionId, values: asList(starting) };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { op, questionId, value: kind === "number" ? 0 : DATE_OPERAND_PLACEHOLDER };
    case "contains":
      return { op, questionId, value: String(starting) };
    case "containsAny":
      return { op, questionId, values: asList(starting).map(String) };
  }
}

// Array.isArray widens a readonly array union to mutable any[]; object narrowing preserves the safe return type.
function asList(starting: DraftAnswerValue): readonly DraftAnswerValue[] {
  return typeof starting === "object" ? starting : [starting];
}

function childrenOf(previous: DraftCondition | undefined, questionId: string): DraftCondition[] {
  if (previous === undefined) return [{ op: "answered", questionId }];
  if (previous.op === "and" || previous.op === "or") return [...previous.conditions];
  const only = nestedOf(previous);
  return only === undefined ? [previous] : [only];
}

// Wrapping a whole-group read in not preserves its meaning; unwrapping it would silently discard the group operation.
function notChildOf(previous: DraftCondition | undefined): DraftCondition | undefined {
  if (previous === undefined) return undefined;
  if (previous.op === "and" || previous.op === "or") return previous.conditions[0];
  if (previous.op === "not") return previous.condition;
  return previous;
}

// Drop nested whole-group reads when building a group operator because the kernel forbids that nesting.
function groupNestedOf(previous: DraftCondition | undefined): DraftCondition | undefined {
  if (previous === undefined) return undefined;
  const candidate =
    previous.op === "and" || previous.op === "or"
      ? previous.conditions[0]
      : (nestedOf(previous) ?? previous);
  if (candidate === undefined) return undefined;
  return conditionGroupReferences(candidate).length > 0 ? undefined : candidate;
}

function nestedOf(condition: DraftCondition): DraftCondition | undefined {
  if (
    condition.op === "not" ||
    condition.op === "anyInstance" ||
    condition.op === "everyInstance"
  ) {
    return condition.condition;
  }
  return undefined;
}

// Group quantifier children count toward the same condition depth limit as not.
export function conditionDepth(condition: DraftCondition): number {
  if (condition.op === "and" || condition.op === "or") {
    return 1 + Math.max(...condition.conditions.map(conditionDepth));
  }
  const nested = nestedOf(condition);
  return nested === undefined ? 1 : 1 + conditionDepth(nested);
}

// Whole-group references cut document order after the entire group span, unlike bare question references.
export function conditionReferences(condition: DraftCondition): readonly string[] {
  const found: string[] = [];
  collect(condition, found);
  return [...new Set(found)];
}

function collect(condition: DraftCondition, out: string[]): void {
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((child) => {
        collect(child, out);
      });
      return;
    case "not":
    case "anyInstance":
    case "everyInstance":
      collect(condition.condition, out);
      return;
    case "instanceCount":
      return;
    default:
      out.push(condition.questionId);
  }
}

export function conditionGroupReferences(condition: DraftCondition): readonly string[] {
  const found: string[] = [];
  collectGroups(condition, found);
  return [...new Set(found)];
}

function collectGroups(condition: DraftCondition, out: string[]): void {
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((child) => {
        collectGroups(child, out);
      });
      return;
    case "not":
      collectGroups(condition.condition, out);
      return;
    case "anyInstance":
    case "everyInstance":
      out.push(condition.groupId);
      // Traverse even invalid nested group reads: JSON-edited drafts need geometry that describes their actual references.
      collectGroups(condition.condition, out);
      return;
    case "instanceCount":
      out.push(condition.groupId);
      return;
    default:
  }
}

// Use positional paths because condition nodes have no IDs; only their enclosing rule does.
export type ConditionPath = readonly number[];

export function nodeAt(condition: DraftCondition, path: ConditionPath): DraftCondition | undefined {
  let current: DraftCondition | undefined = condition;
  for (const index of path) {
    if (current === undefined) return undefined;
    current = childAt(current, index);
  }
  return current;
}

function childAt(condition: DraftCondition, index: number): DraftCondition | undefined {
  if (condition.op === "and" || condition.op === "or") return condition.conditions[index];
  const nested = nestedOf(condition);
  return index === 0 ? nested : undefined;
}

export function replaceAt(
  condition: DraftCondition,
  path: ConditionPath,
  next: DraftCondition,
): DraftCondition {
  if (path.length === 0) return next;
  const [index, ...rest] = path;
  if (index === undefined) return next;
  if (condition.op === "and" || condition.op === "or") {
    const child = condition.conditions[index];
    if (child === undefined) return condition;
    const replaced = replaceAt(child, rest, next);
    return {
      op: condition.op,
      conditions: condition.conditions.map((c, at) => (at === index ? replaced : c)),
    };
  }
  if (index !== 0) return condition;
  if (condition.op === "not") {
    return { op: "not", condition: replaceAt(condition.condition, rest, next) };
  }
  // Changing a nested child must preserve the groupId; it is not a change of the group being read.
  if (condition.op === "anyInstance" || condition.op === "everyInstance") {
    return {
      op: condition.op,
      groupId: condition.groupId,
      condition: replaceAt(condition.condition, rest, next),
    };
  }
  return condition;
}

export function withGroupId(condition: DraftCondition, groupId: string): DraftCondition {
  if (condition.op === "instanceCount") return { ...condition, groupId };
  if (condition.op === "anyInstance" || condition.op === "everyInstance") {
    return { op: condition.op, groupId, condition: condition.condition };
  }
  return condition;
}

export function withInstanceCount(
  condition: DraftCondition,
  change: { readonly compare?: InstanceCountComparison; readonly value?: number },
): DraftCondition {
  if (condition.op !== "instanceCount") return condition;
  return {
    op: "instanceCount",
    groupId: condition.groupId,
    compare: change.compare ?? condition.compare,
    // Clamp instance counts at zero because negative operands do not parse.
    value: Math.max(0, Math.trunc(change.value ?? condition.value)),
  };
}

export function addBranch(
  condition: DraftCondition,
  path: ConditionPath,
  questionId: string,
): DraftCondition {
  const target = nodeAt(condition, path);
  if (target === undefined || (target.op !== "and" && target.op !== "or")) return condition;
  if (conditionDepth(condition) >= MAX_CONDITION_DEPTH) return condition;
  return replaceAt(condition, path, {
    op: target.op,
    conditions: [...target.conditions, { op: "answered", questionId }],
  });
}

// Do not remove a combinator last branch or collapse its parent: one is malformed and the other silently rewrites authored logic.
export function removeBranch(
  condition: DraftCondition,
  path: ConditionPath,
  index: number,
): DraftCondition {
  const target = nodeAt(condition, path);
  if (target === undefined || (target.op !== "and" && target.op !== "or")) return condition;
  if (target.conditions.length <= 1) return condition;
  return replaceAt(condition, path, {
    op: target.op,
    conditions: target.conditions.filter((_child, at) => at !== index),
  });
}
