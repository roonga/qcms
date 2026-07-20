import { z } from "zod";

import { AnswerValue, compareValues, valuesEqual } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { FormDefinition } from "./form-definition.js";
import { isStepId, QuestionId, StepId } from "./ids.js";
import type { FrozenSnapshot } from "./publish-error.js";
import type { QuestionDefinition } from "./question-definition.js";
import { documentOrder, type ResolveQuestion } from "./rule-graph.js";
import type { Condition, VisibilityRule } from "./visibility-rule.js";

/**
 * The rules evaluator (task 006, ADR-16, invariants I6/I7). A pure, total,
 * deterministic function: same `(snapshot, answers)` → same `FlowState`,
 * forever. Semantics (DOMAIN_SCHEMA §3, frozen as {@link SEMANTICS_VERSION}):
 *
 * 1. **Single forward pass in document order** - never a fixpoint. Steps in
 *    order; within a step, items in order. Untargeted items are visible; a
 *    targeted item is visible iff at least one rule targeting it evaluates
 *    true *at that point in the walk*.
 * 2. Conditions over unanswered questions are `false`, except `answered`
 *    (the explicit existence test - including `notEquals`, which is `false`
 *    on unanswered). A referenced question currently *hidden* is treated as
 *    unanswered - well-defined because a referenced question's visibility was
 *    settled earlier in the walk (forward-only, publish-enforced).
 * 3. `equals`/`notEquals`/`in` compare via `valuesEqual` (set equality for
 *    multiChoice, ADR-21); `contains`/`containsAny` test optionId membership
 *    in the multiChoice answer; `gt/gte/lt/lte` order via `compareValues`.
 *    Incompatible types are unreachable post-publish (checkRuleTypes) but
 *    return a typed `CONDITION_TYPE_MISMATCH` on unvalidated input - never a
 *    throw.
 * 4. A hidden step contributes no visible questions regardless of
 *    per-question rules (step-level visibility is settled at step entry and
 *    ANDs with question-level visibility).
 * 5. `currentStep` = first visible step containing a visible unanswered
 *    required question, else first with any visible unanswered question,
 *    else `null`; `complete` = no visible required question unanswered.
 *
 * Totality extensions for unvalidated input (all deterministic; publish makes
 * them unreachable): a reference whose visibility is not yet settled at the
 * point of evaluation (backward/self reference, or an id not pinned in the
 * form) is treated as unanswered; answer-map keys that are not pinned in the
 * form are ignored entirely.
 */

/**
 * The evaluation-semantics version (ADR-16): stamped into snapshots by
 * `compileDraft` (008). Any change to the numbered semantics above increments
 * this - old snapshots evaluate under their recorded version, never silently
 * under new rules.
 */
export const SEMANTICS_VERSION = 1;

/**
 * The *current* answers, latest-per-question - resolution from the
 * append-only ledger happens in storage (I5), not here. A map, not a ledger:
 * evaluation never depends on insertion order.
 */
export type AnswerMap = ReadonlyMap<QuestionId, AnswerValue>;

/**
 * Closed union of typed error codes for evaluation. All are unreachable on
 * publish-validated input (the totality contract: schema-valid input never
 * throws *and* never errs post-publish); on unvalidated input they return
 * instead of throwing. `INVALID_FORM_DEFINITION` is a shared string with
 * `FormDefinitionErrorCode`. Error messages and paths name ids only - never
 * answer values (SECURITY_DESIGN: answer values are never logged).
 */
export const EvalErrorCode = z.enum([
  "INVALID_FORM_DEFINITION",
  "UNSUPPORTED_SEMANTICS_VERSION",
  "UNRESOLVED_QUESTION_PIN",
  "MALFORMED_ANSWER_VALUE",
  "CONDITION_TYPE_MISMATCH",
]);
export type EvalErrorCode = z.infer<typeof EvalErrorCode>;

export const EvalError = QcmsError.extend({ code: EvalErrorCode });
export type EvalError = z.infer<typeof EvalError>;

/**
 * The evaluator's output (DOMAIN_SCHEMA §3): what is visible, where the
 * respondent should be, and whether the response is submittable. All arrays
 * are in document order.
 *
 * - `visible` - every visible `(stepId, questionId)` pair.
 * - `visibleSteps` - the steps contributing at least one visible question
 *   (derived from `visible`; a step-visible step whose questions are all
 *   rule-hidden renders nothing and is therefore not listed).
 * - `currentStep` - semantic 5 above; `null` when nothing is unanswered.
 * - `answeredRequired` / `missingRequired` - visible required questions with
 *   and without an answer (required-ness comes from the resolved
 *   `QuestionDefinition`, task 003).
 * - `complete` - `missingRequired` is empty (I9's precondition; the
 *   submission sweep itself is task 009).
 */
export const FlowState = z.object({
  visible: z.array(z.object({ stepId: StepId, questionId: QuestionId })),
  visibleSteps: z.array(StepId),
  currentStep: StepId.nullable(),
  answeredRequired: z.array(QuestionId),
  missingRequired: z.array(QuestionId),
  complete: z.boolean(),
});
export type FlowState = z.infer<typeof FlowState>;

/** Typed eval error for an operator applied over incompatible runtime types.
 * Names the rule, operator, and question - never the compared values. */
function typeMismatch(rule: VisibilityRule, op: string, questionId: QuestionId): EvalError {
  return {
    code: "CONDITION_TYPE_MISMATCH",
    message: `Rule "${rule.ruleId}": ${op} on question "${questionId}" compared incompatible types (unreachable post-publish; values never shown)`,
    path: [rule.ruleId, questionId],
  };
}

/**
 * Accept either a `FrozenSnapshot` (008) or a bare `FormDefinition`, verify
 * the recorded semantics version, and re-validate the definition so malformed
 * input becomes a typed error instead of undefined behavior downstream.
 */
function unwrapDefinition(
  snapshot: FrozenSnapshot | FormDefinition,
): Result<FormDefinition, EvalError> {
  const candidate: unknown = snapshot;
  let raw: unknown = candidate;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "definition" in candidate &&
    "semanticsVersion" in candidate
  ) {
    if (candidate.semanticsVersion !== SEMANTICS_VERSION) {
      return err({
        code: "UNSUPPORTED_SEMANTICS_VERSION",
        message: `Snapshot records a semanticsVersion this evaluator does not implement (supported: ${String(SEMANTICS_VERSION)})`,
      });
    }
    raw = candidate.definition;
  }
  const parsed = FormDefinition.safeParse(raw);
  if (!parsed.success) {
    return err({
      code: "INVALID_FORM_DEFINITION",
      message:
        "Input is not a parseable FormDefinition (run parseFormDefinition for the detailed report)",
    });
  }
  return ok(parsed.data);
}

/* v8 ignore next 3 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverCondition(condition: never): never {
  throw new Error(`Unhandled condition op: ${String((condition as { op?: unknown }).op)}`);
}

/**
 * Evaluate a snapshot's visibility rules against the current answers
 * (ADR-16 forward pass; semantics in the module doc above, frozen as
 * `SEMANTICS_VERSION`).
 *
 * `resolveQuestion` maps each pinned `questionId` to the definition its pin
 * resolves to - the same injected-lookup pattern as `checkRuleTypes` (005),
 * keeping the kernel I/O-free (R3). It supplies the `required` flags that
 * live on `QuestionDefinition`, not on the form; the caller (008's publish
 * check, 009's submission sweep, the serving slices) owns loading the pinned
 * versions. It must be a pure lookup: determinism (I7) is over
 * `(snapshot, answers, resolved definitions)`.
 *
 * Total: never throws; malformed or unresolvable input returns a typed
 * `EvalError` (every code unreachable on publish-validated input).
 */
export function evaluateRules(
  snapshot: FrozenSnapshot | FormDefinition,
  answers: AnswerMap,
  resolveQuestion: ResolveQuestion,
): Result<FlowState, EvalError> {
  const unwrapped = unwrapDefinition(snapshot);
  if (!unwrapped.ok) {
    return unwrapped;
  }
  const form = unwrapped.value;
  const order = documentOrder(form);

  // Resolve every pin up front (I2 makes failures unreachable post-publish).
  // Reported all-at-once and in document order, so the error never depends on
  // answer-map iteration order.
  const definitions = new Map<QuestionId, QuestionDefinition>();
  const unresolved: QuestionId[] = [];
  for (const { questionId } of order) {
    const definition = resolveQuestion(questionId);
    if (definition === undefined) {
      unresolved.push(questionId);
    } else {
      definitions.set(questionId, definition);
    }
  }
  if (unresolved.length > 0) {
    return err({
      code: "UNRESOLVED_QUESTION_PIN",
      message: "resolveQuestion returned no definition for the pinned question(s) in path",
      path: [...unresolved],
    });
  }

  // Canonicalize answers for pinned questions (NFC text, deduplicated
  // multiChoice); unknown keys are ignored. Malformed values are reported
  // all-at-once, in document order - again independent of map order.
  const canonical = new Map<QuestionId, AnswerValue>();
  const malformed: QuestionId[] = [];
  for (const { questionId } of order) {
    if (!answers.has(questionId)) {
      continue;
    }
    const parsed = AnswerValue.safeParse(answers.get(questionId));
    if (parsed.success) {
      canonical.set(questionId, parsed.data);
    } else {
      malformed.push(questionId);
    }
  }
  if (malformed.length > 0) {
    return err({
      code: "MALFORMED_ANSWER_VALUE",
      message:
        "Answers for the question(s) in path are not canonical AnswerValue encodings (values never shown)",
      path: [...malformed],
    });
  }

  // Which rules target each step / each question directly. A StepId target
  // conditions the *step* (semantic 4); it does not make the step's questions
  // individually targeted - step-level and question-level visibility are
  // separate layers that AND together.
  const stepRules = new Map<StepId, VisibilityRule[]>();
  const questionRules = new Map<QuestionId, VisibilityRule[]>();
  for (const rule of form.rules) {
    for (const target of new Set(rule.show)) {
      if (isStepId(target)) {
        stepRules.set(target, [...(stepRules.get(target) ?? []), rule]);
      } else {
        questionRules.set(target, [...(questionRules.get(target) ?? []), rule]);
      }
    }
  }

  // The forward walk. `settled` holds questions already walked and visible;
  // an answer participates in condition evaluation only once its question is
  // settled visible (semantic 2 / I6 - hidden answers are excluded, and
  // not-yet-walked references read as unanswered).
  const settled = new Set<QuestionId>();
  const effective = (questionId: QuestionId): AnswerValue | undefined =>
    settled.has(questionId) ? canonical.get(questionId) : undefined;

  const evalCondition = (
    rule: VisibilityRule,
    condition: Condition,
  ): Result<boolean, EvalError> => {
    switch (condition.op) {
      case "and": {
        for (const child of condition.conditions) {
          const outcome = evalCondition(rule, child);
          if (!outcome.ok || !outcome.value) {
            return outcome;
          }
        }
        return ok(true);
      }
      case "or": {
        for (const child of condition.conditions) {
          const outcome = evalCondition(rule, child);
          if (!outcome.ok || outcome.value) {
            return outcome;
          }
        }
        return ok(false);
      }
      case "not": {
        const outcome = evalCondition(rule, condition.condition);
        return outcome.ok ? ok(!outcome.value) : outcome;
      }
      case "answered":
        return ok(effective(condition.questionId) !== undefined);
      case "equals": {
        const answer = effective(condition.questionId);
        return ok(answer !== undefined && valuesEqual(answer, condition.value));
      }
      case "notEquals": {
        const answer = effective(condition.questionId);
        return ok(answer !== undefined && !valuesEqual(answer, condition.value));
      }
      case "in": {
        const answer = effective(condition.questionId);
        return ok(
          answer !== undefined && condition.values.some((value) => valuesEqual(answer, value)),
        );
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const answer = effective(condition.questionId);
        if (answer === undefined) {
          return ok(false);
        }
        const ordering = compareValues(answer, condition.value);
        if (!ordering.ok) {
          return err(typeMismatch(rule, condition.op, condition.questionId));
        }
        if (condition.op === "gt") {
          return ok(ordering.value > 0);
        }
        if (condition.op === "gte") {
          return ok(ordering.value >= 0);
        }
        return ok(condition.op === "lt" ? ordering.value < 0 : ordering.value <= 0);
      }
      case "contains":
      case "containsAny": {
        const answer = effective(condition.questionId);
        if (answer === undefined) {
          return ok(false);
        }
        if (!Array.isArray(answer)) {
          return err(typeMismatch(rule, condition.op, condition.questionId));
        }
        const options = condition.op === "contains" ? [condition.value] : condition.values;
        return ok(options.some((option) => answer.includes(option)));
      }
      /* v8 ignore next 2 -- unreachable by construction */
      default:
        return assertNeverCondition(condition);
    }
  };

  /** True when at least one of the targeting rules matches, in declaration
   * order ("at that point in the walk" - evaluated against `settled`). */
  const anyRuleTrue = (rules: readonly VisibilityRule[]): Result<boolean, EvalError> => {
    for (const rule of rules) {
      const outcome = evalCondition(rule, rule.when);
      if (!outcome.ok || outcome.value) {
        return outcome;
      }
    }
    return ok(false);
  };

  const visible: FlowState["visible"] = [];
  for (const step of form.steps) {
    const targetingStep = stepRules.get(step.stepId);
    if (targetingStep !== undefined) {
      const shown = anyRuleTrue(targetingStep);
      if (!shown.ok) {
        return shown;
      }
      if (!shown.value) {
        // Semantic 4: a hidden step contributes no visible questions
        // regardless of per-question rules; none of its questions settle
        // visible, so their answers stay excluded downstream.
        continue;
      }
    }
    for (const item of step.items) {
      const targetingQuestion = questionRules.get(item.questionId);
      if (targetingQuestion !== undefined) {
        const shown = anyRuleTrue(targetingQuestion);
        if (!shown.ok) {
          return shown;
        }
        if (!shown.value) {
          continue;
        }
      }
      settled.add(item.questionId);
      visible.push({ stepId: step.stepId, questionId: item.questionId });
    }
  }

  // Accounting over the visible set (semantic 5). A visible question is
  // answered iff the (canonicalized) answer map has an entry for it.
  const visibleSteps = [...new Set(visible.map((entry) => entry.stepId))];
  const answeredRequired: QuestionId[] = [];
  const missingRequired: QuestionId[] = [];
  let firstMissingRequiredStep: StepId | null = null;
  let firstUnansweredStep: StepId | null = null;
  for (const entry of visible) {
    const definition = definitions.get(entry.questionId);
    /* v8 ignore next 3 -- every pinned question was resolved above */
    if (definition === undefined) {
      continue;
    }
    const answered = canonical.has(entry.questionId);
    if (!answered && firstUnansweredStep === null) {
      firstUnansweredStep = entry.stepId;
    }
    if (definition.required) {
      (answered ? answeredRequired : missingRequired).push(entry.questionId);
      if (!answered && firstMissingRequiredStep === null) {
        firstMissingRequiredStep = entry.stepId;
      }
    }
  }

  return ok({
    visible,
    visibleSteps,
    currentStep: firstMissingRequiredStep ?? firstUnansweredStep,
    answeredRequired,
    missingRequired,
    complete: missingRequired.length === 0,
  });
}
