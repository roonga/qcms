import type { QuestionType } from "../questions/types.ts";

import type {
  ConditionOp,
  DraftAnswerValue,
  DraftCondition,
  LeafConditionOp,
  PinnableQuestion,
} from "./types.ts";

/**
 * The structured condition editor's schema knowledge (task 033, ADR-19).
 *
 * ADR-19 fixes structured JSON editing with live validation as the default, and the task
 * spells out what "structured" means: schema-aware editing with pickers and inline
 * errors, not a bare textarea. This module is the schema-awareness. It answers three
 * questions for every node of the tree, and the editor renders whatever it says:
 *
 * 1. which `op`s are offered at all, given the referenced question's type;
 * 2. what operand control the chosen `op` needs, given that type;
 * 3. what a well-formed node of that `op` looks like, so a picker change never lands the
 *    tree in a half-built state.
 *
 * Answering (3) here rather than in the components is what makes exit criterion 4 -
 * "the editor never emits DSL the schema rejects" - a property of the code rather than a
 * hope. There is no edit path that produces a node this module did not construct, and
 * `condition.test.ts` fuzzes every op against every question type and parses the result
 * with the kernel's own `Condition` schema.
 *
 * ## The one place the pickers are narrower than the DSL
 *
 * `in` is offered for single-valued question types only. On a multiChoice question an
 * `in` value is a whole answer (an `OptionId[]`, compared by set equality - ADR-21), so
 * authoring one means building a list of lists, and the thing an author almost always
 * means by "one of these" is `containsAny`, which ADR-21 exists to steer them to. The DSL
 * still accepts multiChoice `in`; the picker simply does not offer a control that would
 * be easier to get wrong than right.
 */

/**
 * The kernel's `CONDITION_MAX_DEPTH` (`visibility-rule.ts`), restated rather than imported:
 * `@roonga/qcms-core` is not importable from this app. `condition.test.ts` pins the two together,
 * and it may import the kernel because a `.test.ts` is outside the import-surface scan.
 */
export const MAX_CONDITION_DEPTH = 8;

/** The three combinators, which read no question of their own. */
const COMBINATORS = ["and", "or", "not"] as const;

export function isCombinator(op: ConditionOp): op is "and" | "or" | "not" {
  return (COMBINATORS as readonly string[]).includes(op);
}

/**
 * What operand control a leaf op needs against a question of this type.
 *
 * `none` means the op is complete on its own (`answered`); `unsupported` means the pair
 * is not offered, which the editor renders as an unselectable option rather than silently
 * dropping it from the list, so an author sees that the operator exists and why it does
 * not apply here.
 */
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

/** The value control an `equals`/`notEquals` comparison needs for each question type. */
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
      // Whole-answer set equality, never containment (ADR-21).
      return "optionList";
  }
}

/** The `in` list control for a single-valued type, or `unsupported`. */
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
      // boolean: `in [true,false]` is a tautology. multiChoice: see the module note.
      return "unsupported";
  }
}

/**
 * The operand control for one `(op, questionType)` pair.
 *
 * A `undefined` type means the referenced question could not be resolved (an unpinned or
 * missing id): the editor then shows the operator picker and nothing else, because it
 * genuinely cannot know what a legal value would look like.
 */
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
      // Ordering is number/date only, and cross-type comparison is unreachable (§2.4).
      if (type === "number") return "number";
      if (type === "date") return "date";
      return "unsupported";
    case "contains":
      return type === "multiChoice" ? "option" : "unsupported";
    case "containsAny":
      return type === "multiChoice" ? "optionList" : "unsupported";
  }
}

/** Whether the operator picker offers this op against a question of this type. */
export function isOpSupported(op: LeafConditionOp, type: QuestionType | undefined): boolean {
  return operandKind(op, type) !== "unsupported";
}

/** The option ids a question's pinned version declares, in declaration order. */
export function optionIdsOfVersion(
  question: PinnableQuestion | undefined,
  version: number,
): readonly string[] {
  const found = question?.versions.find((v) => v.version === version);
  return (found?.definition.options ?? []).map((option) => option.optionId);
}

/** The type of the version a pin points at, which is what every operand decision reads. */
export function typeOfPinnedVersion(
  question: PinnableQuestion | undefined,
  version: number,
): QuestionType | undefined {
  const found = question?.versions.find((v) => v.version === version);
  return found?.definition.type;
}

/**
 * The placeholder a fresh date operand carries.
 *
 * A date operand cannot start empty: the kernel's `DateAnswerValue` is a canonical
 * `YYYY-MM-DD` pattern, so `""` is not an unfinished date, it is a malformed one. A fixed
 * placeholder keeps the node parseable from the instant it is created (exit criterion 4)
 * and is obviously a value to replace. Fixed rather than "today" so the same picker
 * sequence produces the same draft on any day, which the fuzz test depends on.
 */
export const DATE_OPERAND_PLACEHOLDER = "2000-01-01";

/**
 * A well-formed starting operand for a control kind.
 *
 * "Starting" is not "absent" and not "empty". The kernel's schema has no optional
 * operands and several of them are pattern-constrained, so a node under construction
 * still has to carry a value of the right *shape*: an empty option list would fail
 * `.min(1)` on `in`/`containsAny`, `""` would fail the date pattern, and `""` is not an
 * `opt_`-prefixed option id. Every value produced here parses.
 */
// The heterogeneous return is the point of this function, not an accident of it: an
// operand's runtime type IS the thing being decided, and `DraftAnswerValue` is the closed
// union the kernel's schema accepts. Splitting it per type would push the same switch up
// into every caller, which is strictly worse.
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
      // Guarded by the caller: a choice question always declares at least one option.
      return options[0] ?? "";
    case "optionList":
      return options[0] === undefined ? [] : [options[0]];
    // The three scalar list kinds return their ELEMENT, not a one-element array.
    // `DraftAnswerValue` is a single answer, and its only array member is the
    // `readonly string[]` a multiChoice answer is - so `[0]` is not one, and typing it as
    // one was the defect here. `asList` wraps these for `in`/`containsAny`, which take
    // `readonly DraftAnswerValue[]`: a list OF answers, which is a different type.
    // `optionList` stays an array because there it genuinely IS a whole answer (ADR-21
    // set equality), and `asList` passes an array through untouched.
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

/**
 * Build a complete condition node for `op`, carrying over what still applies.
 *
 * Called on every operator and question change, which is what stops a picker from ever
 * leaving a partially-built node behind: switching `equals` to `containsAny` cannot leave
 * a stray `value` alongside the new `values`, because the node is rebuilt rather than
 * patched.
 *
 * **The invariant this function exists to hold:** what it returns always parses as a
 * kernel `Condition`. When it cannot build a legal node for the requested op - the op
 * does not apply to this question's type, or a choice operand is needed and the pinned
 * version declares no options - it falls back to `answered`, which is legal against every
 * type and needs no operand. That is why exit criterion 4 is structural: there is no edit
 * path in the editor that constructs a node any other way.
 */
export function conditionForOp(
  op: ConditionOp,
  questionId: string,
  type: QuestionType | undefined,
  options: readonly string[],
  previous?: DraftCondition,
): DraftCondition {
  if (op === "not") {
    return { op, condition: firstChildOf(previous) ?? { op: "answered", questionId } };
  }
  if (op === "and" || op === "or") {
    return { op, conditions: childrenOf(previous, questionId) };
  }
  const kind = operandKind(op, type);
  const answered = { op: "answered", questionId } as const;
  if (kind === "unsupported") return answered;
  // Every choice operand needs a real `opt_` id; without one there is no legal node.
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

/**
 * A starting operand as the non-empty list `in`/`containsAny` require (`.min(1)`).
 *
 * Narrowed with `typeof === "object"` rather than `Array.isArray`, which is not merely a
 * style choice: `Array.isArray` is typed to narrow to the mutable `any[]`, so against a
 * union whose only array member is `readonly string[]` it widens the result to `any` and
 * the lint gate rejects the unsafe return. A `readonly string[]` is the one object member
 * of {@link DraftAnswerValue}, so the `typeof` test is exact.
 */
function asList(starting: DraftAnswerValue): readonly DraftAnswerValue[] {
  return typeof starting === "object" ? starting : [starting];
}

/** The children a combinator keeps when the author switches between `and`/`or`/`not`. */
function childrenOf(previous: DraftCondition | undefined, questionId: string): DraftCondition[] {
  if (previous === undefined) return [{ op: "answered", questionId }];
  if (previous.op === "and" || previous.op === "or") return [...previous.conditions];
  if (previous.op === "not") return [previous.condition];
  return [previous];
}

/** The single child `not` keeps, when there is one to keep. */
function firstChildOf(previous: DraftCondition | undefined): DraftCondition | undefined {
  if (previous === undefined) return undefined;
  if (previous.op === "and" || previous.op === "or") return previous.conditions[0];
  if (previous.op === "not") return previous.condition;
  return previous;
}

/** Nesting depth: a leaf is 1, each combinator adds one. Mirrors the kernel's own. */
export function conditionDepth(condition: DraftCondition): number {
  switch (condition.op) {
    case "and":
    case "or":
      return 1 + Math.max(...condition.conditions.map(conditionDepth));
    case "not":
      return 1 + conditionDepth(condition.condition);
    default:
      return 1;
  }
}

/** Every questionId the condition reads, deduplicated, in first-encounter order. */
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
      collect(condition.condition, out);
      return;
    default:
      out.push(condition.questionId);
  }
}

/**
 * Address one node inside a tree.
 *
 * A path of child indices, root being `[]`. Positional rather than by id because a
 * condition node has no id in the DSL - only the rule does - and the editor needs to say
 * "the second branch of the first `and`" when a value changes.
 */
export type ConditionPath = readonly number[];

/** Read the node at `path`, or `undefined` when the path does not resolve. */
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
  if (condition.op === "not") return index === 0 ? condition.condition : undefined;
  return undefined;
}

/** Replace the node at `path`, returning a new tree. An unresolvable path is a no-op. */
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
  if (condition.op === "not" && index === 0) {
    return { op: "not", condition: replaceAt(condition.condition, rest, next) };
  }
  return condition;
}

/**
 * Append a branch to the combinator at `path`.
 *
 * Refused past the depth cap: the kernel rejects a tree deeper than
 * {@link MAX_CONDITION_DEPTH} with `RULE_DEPTH_EXCEEDED`, so the control that would
 * create one is disabled rather than the error being explained afterwards.
 */
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

/**
 * Remove one branch of the combinator at `path`.
 *
 * A combinator's last branch cannot be removed: `and`/`or` are `.min(1)` in the kernel,
 * so an empty one is malformed rather than merely empty. Collapsing to the surviving
 * child instead would silently rewrite the author's logic, so the control is simply
 * unavailable and the author changes the operator if they want the branch gone.
 */
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
