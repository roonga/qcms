import { z } from "zod";

import { AnswerValue, Comparable } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { GroupId, OptionId, QuestionId, RuleId, StepId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";

/**
 * The rules DSL (DOMAIN_SCHEMA §3, ADR-03, semantics per ADR-16).
 *
 * Closed is the feature: it makes publish-time validation against pinned
 * question versions possible, keeps evaluation deterministic and auditable, and
 * lets a visual builder emit the format later (ADR-19). A new operator is a
 * versioned core change.
 */

/** Maximum condition nesting depth (DOMAIN_SCHEMA §3). */
export const CONDITION_MAX_DEPTH = 8;

/**
 * The condition tree, declared by hand because the schema is recursive and
 * `z.lazy` needs the annotation. The `z.ZodType<Condition>` annotation on the
 * schema keeps type and schema from drifting.
 *
 * Three operators read a whole repeating group and so carry a `groupId` rather
 * than a `questionId` (ADR-42). The inside-out direction needs no syntax: a
 * rule targeting inside a group is evaluated once per live instance.
 *
 * `everyInstance` over a group with no live instance is FALSE by decision
 * rather than vacuously true (ADR-42). So `everyInstance(G, c)` is not
 * equivalent to `not(anyInstance(G, not c))` on an empty G, and nothing in the
 * evaluator, the admin or a golden scenario may treat one as a rewrite of the
 * other.
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

/** `instanceCount` reuses these names as a field rather than introducing a
 * second comparison vocabulary (ADR-03). */
export const INSTANCE_COUNT_COMPARISONS = ["equals", "gt", "gte", "lt", "lte"] as const;
export const InstanceCountComparison = z.enum(INSTANCE_COUNT_COMPARISONS);
export type InstanceCountComparison = z.infer<typeof InstanceCountComparison>;

/**
 * Typed error codes for rule parsing. `RULE_DEPTH_EXCEEDED` is deliberately the
 * same string as in `PublishErrorCode`, so publish surfaces it verbatim.
 */
export const VisibilityRuleErrorCode = z.enum([
  "INVALID_CONDITION",
  "INVALID_VISIBILITY_RULE",
  "RULE_DEPTH_EXCEEDED",
]);
export type VisibilityRuleErrorCode = z.infer<typeof VisibilityRuleErrorCode>;

export const VisibilityRuleError = QcmsError.extend({ code: VisibilityRuleErrorCode });
export type VisibilityRuleError = z.infer<typeof VisibilityRuleError>;

/** Narrows the shared coded-issue plumbing to this module's codes, so a typo
 * is a compile error. */
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: VisibilityRuleErrorCode,
  message: string,
  path: readonly (string | number)[],
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

/** Carries no depth refinement, so the exported {@link Condition} can check the
 * cap once at the root rather than re-walking every nested node. */
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
    // multiChoice only (ADR-21), enforced by `checkRuleTypes` against the
    // resolved definitions rather than at parse.
    z.object({ op: z.literal("contains"), questionId: QuestionId, value: OptionId }),
    z.object({
      op: z.literal("containsAny"),
      questionId: QuestionId,
      values: z.array(OptionId).min(1),
    }),
    z.object({ op: z.literal("and"), conditions: z.array(ConditionNode).min(1) }),
    z.object({ op: z.literal("or"), conditions: z.array(ConditionNode).min(1) }),
    z.object({ op: z.literal("not"), condition: ConditionNode }),
    // These carry a `groupId` and no `questionId`, so a condition walker whose
    // default branch reads `condition.questionId` silently reads `undefined`.
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

/**
 * Nesting depth of a condition tree, leaves counting as 1. Exported for the
 * admin editor's live validation.
 */
export function conditionDepth(condition: Condition): number {
  switch (condition.op) {
    case "and":
    case "or":
      return 1 + Math.max(...condition.conditions.map(conditionDepth));
    // A nested condition under a whole-group operator counts toward the cap;
    // `instanceCount` carries none and is a leaf.
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
 * A visibility rule (DOMAIN_SCHEMA §3). A targeted item is hidden by default
 * and shown when at least one targeting rule matches (ADR-16); an item no rule
 * targets is unconditionally visible. Whether targets resolve, sit forward of
 * the condition's references and type-check are publish invariants rather than
 * parse concerns.
 */
export const VisibilityRule = z.object({
  ruleId: RuleId,
  when: Condition,
  show: z.array(z.union([QuestionId, StepId])).min(1),
});
export type VisibilityRule = z.infer<typeof VisibilityRule>;

/**
 * Parse an unknown value as a Condition, reporting every issue with its typed
 * code and path rather than only the first.
 */
export function parseCondition(value: unknown): Result<Condition, readonly VisibilityRuleError[]> {
  const result = Condition.safeParse(value);
  return result.success
    ? ok(result.data)
    : err(toCodedErrors(VisibilityRuleErrorCode, result.error, "INVALID_CONDITION"));
}

export function isCondition(value: unknown): value is Condition {
  return Condition.safeParse(value).success;
}

/**
 * Parse an unknown value as a VisibilityRule. A depth violation inside `when`
 * keeps its own code and path.
 */
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
