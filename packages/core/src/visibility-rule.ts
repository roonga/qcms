import { z } from "zod";

import { AnswerValue, Comparable } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { OptionId, QuestionId, RuleId, StepId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";

/**
 * The rules DSL (task 005, DOMAIN_SCHEMA §3, ADR-03, semantics per ADR-16).
 *
 * A closed, typed condition language. Closed is the feature: it makes
 * publish-time validation against pinned question versions possible, keeps
 * evaluation deterministic and auditable, and lets a visual builder emit the
 * format later (ADR-19). New operators are versioned core changes.
 *
 * Visibility semantics (ADR-16): targets listed in *any* rule are
 * **conditional** — hidden by default, shown when at least one targeting rule
 * matches. Items never targeted by a rule are unconditionally visible. A
 * `StepId` target expands to all its questions. Evaluation itself is task
 * 006; the publish-time graph checks live in `rule-graph.ts`.
 */

/** Maximum condition nesting depth (DOMAIN_SCHEMA §3). A leaf condition has
 * depth 1; each `and`/`or`/`not` wrapper adds one level. */
export const CONDITION_MAX_DEPTH = 8;

/**
 * The condition tree. Declared explicitly because the schema is recursive —
 * `z.lazy` needs the annotation (the one place `z.infer` cannot be the
 * source); the `z.ZodType<Condition>` annotation on the schema keeps the two
 * from drifting.
 *
 * Leaf operators reference a `questionId`; `equals`/`notEquals`/`in` compare
 * canonical `AnswerValue` encodings (§2.4, ADR-21 — multiChoice `equals` is
 * whole-answer set equality, never containment), `gt/gte/lt/lte` order
 * `Comparable` values (number | date), `answered` is the explicit existence
 * test, and `contains`/`containsAny` are multiChoice membership (ADR-21).
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
  | { op: "not"; condition: Condition };

/**
 * Closed union of typed error codes for rule parsing. `RULE_DEPTH_EXCEEDED`
 * is a shared string with `PublishErrorCode` — `compileDraft` (008) surfaces
 * the same violation verbatim in its publish report.
 */
export const VisibilityRuleErrorCode = z.enum([
  "INVALID_CONDITION",
  "INVALID_VISIBILITY_RULE",
  "RULE_DEPTH_EXCEEDED",
]);
export type VisibilityRuleErrorCode = z.infer<typeof VisibilityRuleErrorCode>;

export const VisibilityRuleError = QcmsError.extend({ code: VisibilityRuleErrorCode });
export type VisibilityRuleError = z.infer<typeof VisibilityRuleError>;

/** Module-typed wrapper over the shared coded-issue plumbing: only members of
 * VisibilityRuleErrorCode can be attached here (typos are compile errors). */
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: VisibilityRuleErrorCode,
  message: string,
  path: readonly (string | number)[],
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

/** Recursive structure without the depth refinement; the exported
 * {@link Condition} schema wraps it so the depth cap is checked once at the
 * root of a tree, not re-walked at every nested node. */
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
    // multiChoice only (ADR-21) — enforced against resolved question
    // definitions by checkRuleTypes (rule-graph.ts), not at parse.
    z.object({ op: z.literal("contains"), questionId: QuestionId, value: OptionId }),
    z.object({
      op: z.literal("containsAny"),
      questionId: QuestionId,
      values: z.array(OptionId).min(1),
    }),
    z.object({ op: z.literal("and"), conditions: z.array(ConditionNode).min(1) }),
    z.object({ op: z.literal("or"), conditions: z.array(ConditionNode).min(1) }),
    z.object({ op: z.literal("not"), condition: ConditionNode }),
  ]),
);

/**
 * Nesting depth of a condition tree: leaves are depth 1, each `and`/`or`/
 * `not` adds one level. Exported for the admin editor's live validation
 * (033).
 */
export function conditionDepth(condition: Condition): number {
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

/**
 * The condition schema (DOMAIN_SCHEMA §3): the closed discriminated union
 * with the depth cap validated at parse (`RULE_DEPTH_EXCEEDED`).
 */
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
 * A visibility rule (DOMAIN_SCHEMA §3): when the condition matches, the
 * listed targets are shown. Targets are conditional — hidden by default,
 * shown when at least one targeting rule matches (ADR-16); a `StepId` target
 * expands to all of the step's questions. Whether targets resolve, sit
 * forward of the condition's references, and type-check against pinned
 * question versions are publish invariants (rule-graph.ts here, wired up by
 * 008) — not parse concerns.
 */
export const VisibilityRule = z.object({
  ruleId: RuleId,
  when: Condition,
  show: z.array(z.union([QuestionId, StepId])).min(1),
});
export type VisibilityRule = z.infer<typeof VisibilityRule>;

/**
 * Parse an unknown value as a Condition. All-errors-not-first: every issue is
 * reported with its typed code and path. Structural failures carry
 * INVALID_CONDITION; a too-deep tree carries RULE_DEPTH_EXCEEDED.
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
 * Parse an unknown value as a VisibilityRule. Structural failures carry
 * INVALID_VISIBILITY_RULE; depth violations inside `when` keep
 * RULE_DEPTH_EXCEEDED with their path.
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
