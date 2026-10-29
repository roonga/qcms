import { z } from "zod";

import { AnswerValue, Comparable } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { GroupId, OptionId, QuestionId, RuleId, StepId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";

// The operator set is closed so that publish-time validation against pinned
// versions is possible and evaluation stays auditable (ADR-03); a new operator
// is a versioned core change.

/** Maximum condition nesting depth (DOMAIN_SCHEMA §3). */
export const CONDITION_MAX_DEPTH = 8;

/**
 * The condition tree, declared by hand because `z.lazy` needs the annotation. Three operators
 * read a whole group and carry a `groupId` (ADR-42). `everyInstance` over an empty group is
 * FALSE by decision, so it is not `not(anyInstance(not c))`.
 */
export type Condition =
  | { op: "equals"; questionId: QuestionId; value: AnswerValue }
  | { op: "notEquals"; questionId: QuestionId; value: AnswerValue }
  | { op: "in"; questionId: QuestionId; values: AnswerValue[] }
  | { op: "gt"; questionId: QuestionId; value: Comparable }
  | { op: "gte"; questionId: QuestionId; value: Comparable }
  | { op: "lt"; questionId: QuestionId; value: Comparable }
  | { op: "lte"; questionId: QuestionId; value: Comparable }
  | { op: "answered"; questionId: QuestionId }
  | { op: "contains"; questionId: QuestionId; value: OptionId }
  | { op: "containsAny"; questionId: QuestionId; values: OptionId[] }
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "not"; condition: Condition }
  | { op: "anyInstance"; groupId: GroupId; condition: Condition }
  | { op: "everyInstance"; groupId: GroupId; condition: Condition }
  | {
      op: "instanceCount";
      groupId: GroupId;
      compare: "equals" | "gt" | "gte" | "lt" | "lte";
      value: number;
    };

/** Reused as a field, rather than a second comparison vocabulary (ADR-03). */
export const INSTANCE_COUNT_COMPARISONS = ["equals", "gt", "gte", "lt", "lte"] as const;
export const InstanceCountComparison = z.enum(INSTANCE_COUNT_COMPARISONS);
export type InstanceCountComparison = z.infer<typeof InstanceCountComparison>;

/** The depth code is deliberately the same string publish uses. */
export const VisibilityRuleErrorCode = z.enum([
  "INVALID_CONDITION",
  "INVALID_VISIBILITY_RULE",
  "RULE_DEPTH_EXCEEDED",
]);
export type VisibilityRuleErrorCode = z.infer<typeof VisibilityRuleErrorCode>;

export const VisibilityRuleError = QcmsError.extend({ code: VisibilityRuleErrorCode });
export type VisibilityRuleError = z.infer<typeof VisibilityRuleError>;

// Narrowed to this module's codes, so a typo is a compile error.
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: VisibilityRuleErrorCode,
  message: string,
  path: readonly (string | number)[],
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

// No depth refinement here, so the cap is checked once at the root rather than
// re-walked at every nested node.
const ConditionNode: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("equals"), questionId: QuestionId, value: AnswerValue }),
    z.object({ op: z.literal("notEquals"), questionId: QuestionId, value: AnswerValue }),
    z.object({ op: z.literal("in"), questionId: QuestionId, values: z.array(AnswerValue).min(1) }),
    z.object({ op: z.literal("gt"), questionId: QuestionId, value: Comparable }),
    z.object({ op: z.literal("gte"), questionId: QuestionId, value: Comparable }),
    z.object({ op: z.literal("lt"), questionId: QuestionId, value: Comparable }),
    z.object({ op: z.literal("lte"), questionId: QuestionId, value: Comparable }),
    z.object({ op: z.literal("answered"), questionId: QuestionId }),
    // multiChoice only (ADR-21), enforced against the resolved definitions
    // rather than at parse.
    z.object({ op: z.literal("contains"), questionId: QuestionId, value: OptionId }),
    z.object({
      op: z.literal("containsAny"),
      questionId: QuestionId,
      values: z.array(OptionId).min(1),
    }),
    z.object({ op: z.literal("and"), conditions: z.array(ConditionNode).min(1) }),
    z.object({ op: z.literal("or"), conditions: z.array(ConditionNode).min(1) }),
    z.object({ op: z.literal("not"), condition: ConditionNode }),
    // A `groupId` and no `questionId`, so a walker whose default branch reads
    // `condition.questionId` silently reads `undefined`.
    z.object({ op: z.literal("anyInstance"), groupId: GroupId, condition: ConditionNode }),
    z.object({ op: z.literal("everyInstance"), groupId: GroupId, condition: ConditionNode }),
    z.object({
      op: z.literal("instanceCount"),
      groupId: GroupId,
      compare: InstanceCountComparison,
      value: z.number().int().min(0),
    }),
  ]),
);

/** Leaves count as one. Exported for the admin editor's live validation. */
export function conditionDepth(condition: Condition): number {
  switch (condition.op) {
    case "and":
    case "or":
      return 1 + Math.max(...condition.conditions.map(conditionDepth));
    // A nested condition counts toward the cap; `instanceCount` is a leaf.
    case "not":
      return 1 + conditionDepth(condition.condition);
    case "anyInstance":
    case "everyInstance":
      return 1 + conditionDepth(condition.condition);
    default:
      return 1;
  }
}

/** The condition schema, with the depth cap validated at parse. */
export const Condition: z.ZodType<Condition> = ConditionNode.superRefine((condition, ctx) => {
  const depth = conditionDepth(condition);
  if (depth > CONDITION_MAX_DEPTH) {
    addCodedIssue(
      ctx,
      "RULE_DEPTH_EXCEEDED",
      `Condition nesting depth ${String(depth)} exceeds the cap of ${String(CONDITION_MAX_DEPTH)}`,
      [],
    );
  }
});

/**
 * A targeted item is hidden by default and shown when a targeting rule matches;
 * an untargeted item is unconditionally visible (ADR-16). Whether targets
 * resolve, sit forward and type-check are publish invariants.
 */
export const VisibilityRule = z.object({
  ruleId: RuleId,
  when: Condition,
  show: z.array(z.union([QuestionId, StepId])).min(1),
});
export type VisibilityRule = z.infer<typeof VisibilityRule>;

/** Reports every issue rather than only the first. */
export function parseCondition(value: unknown): Result<Condition, readonly VisibilityRuleError[]> {
  const result = Condition.safeParse(value);
  return result.success
    ? ok(result.data)
    : err(toCodedErrors(VisibilityRuleErrorCode, result.error, "INVALID_CONDITION"));
}

export function isCondition(value: unknown): value is Condition {
  return Condition.safeParse(value).success;
}

/** A depth violation inside `when` keeps its own code and path. */
export function parseVisibilityRule(
  value: unknown,
): Result<VisibilityRule, readonly VisibilityRuleError[]> {
  const result = VisibilityRule.safeParse(value);
  return result.success
    ? ok(result.data)
    : err(toCodedErrors(VisibilityRuleErrorCode, result.error, "INVALID_VISIBILITY_RULE"));
}

export function isVisibilityRule(value: unknown): value is VisibilityRule {
  return VisibilityRule.safeParse(value).success;
}
