import { z } from "zod";

import { AnswerValue, compareValues, isBlankAnswerValue, valuesEqual } from "./answer-value.js";
import { QcmsError, err, ok, type Result } from "./errors.js";
import { FormDefinition } from "./form-definition.js";
import {
  answerKey,
  GroupId,
  InstanceId,
  isStepId,
  QuestionId,
  StepId,
  type AnswerKey,
} from "./ids.js";
import type { FrozenSnapshot } from "./publish-error.js";
import type { QuestionDefinition } from "./question-definition.js";
import { documentOrder, type ResolveQuestion } from "./rule-graph.js";
import { isRepeatGroup, questionGroups, repeatGroups } from "./step.js";
import type { Condition, VisibilityRule } from "./visibility-rule.js";

/**
 * Pure, total, deterministic rule evaluation (ADR-16, I6/I7). The normative
 * semantics are DOMAIN_SCHEMA §3, frozen as {@link SEMANTICS_VERSION}.
 */

/**
 * The evaluation-semantics version stamped into snapshots (ADR-16). Any change
 * to the frozen semantics increments it, so an old snapshot never evaluates
 * silently under new rules.
 */
export const SEMANTICS_VERSION = 1;

/**
 * The current answers, latest-per-question. A map rather than a ledger, so
 * evaluation never depends on insertion order.
 */
export type AnswerMap = ReadonlyMap<AnswerKey, AnswerValue>;

/**
 * The live instances of each repeating group, in roster order (ADR-42). The
 * caller derives liveness; this map is contractually live and ordered, and
 * order is meaning here, so a roster is never set-compared.
 *
 * It is passed in rather than derived from the answer keys so that an instance
 * the respondent added but has not answered still exists.
 */
export type RosterMap = ReadonlyMap<GroupId, readonly InstanceId[]>;

/**
 * Typed error codes for evaluation. All are unreachable on publish-validated
 * input, and are returned rather than thrown on unvalidated input. Messages
 * and paths name ids only: answer values are never exposed (SECURITY_DESIGN).
 */
export const EvalErrorCode = z.enum([
  "INVALID_FORM_DEFINITION",
  "UNSUPPORTED_SEMANTICS_VERSION",
  "UNRESOLVED_QUESTION_PIN",
  "MALFORMED_ANSWER_VALUE",
  "CONDITION_TYPE_MISMATCH",
]);
export type EvalErrorCode = z.infer<typeof EvalErrorCode>;

// Lowercase binding avoids shadowing the `EvalError` global error constructor.
const evalError = QcmsError.extend({ code: EvalErrorCode });
export { evalError as EvalError };
export type EvalError = z.infer<typeof evalError>;

/**
 * The evaluator's output (DOMAIN_SCHEMA §3): what is visible, where the
 * respondent should be, and whether the response is submittable. Every array
 * is in document then roster order.
 *
 * A repeated required question is listed once in `answeredRequired` and
 * `missingRequired`, missing when any live instance of it is unanswered; the
 * per-instance detail is in the optional arrays below.
 */
export const FlowState = z.object({
  visible: z.array(
    z.object({ stepId: StepId, questionId: QuestionId, instanceId: InstanceId.optional() }),
  ),
  visibleSteps: z.array(StepId),
  currentStep: StepId.nullable(),
  answeredRequired: z.array(QuestionId),
  missingRequired: z.array(QuestionId),
  complete: z.boolean(),
  // Every field below is optional and absent for a form with no repeating
  // group, so the six fields above keep their exact contents for such a form.
  // Do not collapse these parallel arrays into widened versions of those six:
  // the shape is frozen at this `SEMANTICS_VERSION` and multi-version
  // evaluation owns that change (ADR-16).
  /** One entry per step view. A step paginated by a `perInstanceStep` group
   * contributes one view per live instance; every other visible step
   * contributes one view with a null instance (ADR-28). */
  visibleStepViews: z
    .array(z.object({ stepId: StepId, instanceId: InstanceId.nullable() }))
    .optional(),
  /** The per-instance detail behind `missingRequired`. `instanceId` is null for
   * a question outside every group, so the account is complete. */
  missingRequiredInstances: z
    .array(z.object({ questionId: QuestionId, instanceId: InstanceId.nullable() }))
    .optional(),
  /** The per-instance detail behind `answeredRequired`; same shape. */
  answeredRequiredInstances: z
    .array(z.object({ questionId: QuestionId, instanceId: InstanceId.nullable() }))
    .optional(),
  /** The live roster this evaluation used, per group. */
  rosters: z.array(z.object({ groupId: GroupId, instances: z.array(InstanceId) })).optional(),
});
export type FlowState = z.infer<typeof FlowState>;

/** Names the rule, operator and question, never the compared values. */
function typeMismatch(rule: VisibilityRule, op: string, questionId: QuestionId): EvalError {
  return {
    code: "CONDITION_TYPE_MISMATCH",
    message: `Rule "${rule.ruleId}": ${op} on question "${questionId}" compared incompatible types (unreachable post-publish; values never shown)`,
    path: [rule.ruleId, questionId],
  };
}

// Re-validates the definition so malformed input becomes a typed error rather
// than undefined behaviour downstream.
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
 * Evaluate a snapshot's visibility rules against the current answers.
 *
 * @param resolveQuestion Pure lookup from pinned `questionId` to its resolved
 * definition, injected to keep the kernel I/O-free (R3). Determinism (I7) is
 * over the resolved definitions, so it must not vary per call.
 * @param rosters The already-derived live roster ({@link RosterMap}). Omitted,
 * it is the empty map.
 *
 * Never throws: malformed or unresolvable input returns a typed `EvalError`.
 */
export function evaluateRules(
  snapshot: FrozenSnapshot | FormDefinition,
  answers: AnswerMap,
  resolveQuestion: ResolveQuestion,
  rosters?: RosterMap,
): Result<FlowState, EvalError> {
  const unwrapped = unwrapDefinition(snapshot);
  if (!unwrapped.ok) {
    return unwrapped;
  }
  const form = unwrapped.value;
  const order = documentOrder(form);

  const groups = repeatGroups(form.steps);
  const hasGroups = groups.length > 0;
  const groupOf = questionGroups(form.steps);
  const rosterOf = (groupId: GroupId): readonly InstanceId[] => rosters?.get(groupId) ?? [];

  // Reported all-at-once in document order, so the error never depends on
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

  // No key is built for an instance the roster does not list, which is the
  // removal semantic at this layer: a removed instance's answers never settle,
  // so they leave every condition and the required accounting (I6).
  const keys: { readonly key: AnswerKey; readonly questionId: QuestionId }[] = [];
  for (const entry of order) {
    if (entry.groupId === undefined) {
      keys.push({ key: entry.questionId, questionId: entry.questionId });
      continue;
    }
    for (const instanceId of rosterOf(entry.groupId)) {
      keys.push({ key: answerKey(entry.questionId, instanceId), questionId: entry.questionId });
    }
  }

  // A blank text answer is dropped here rather than special-cased downstream,
  // so `answered`, every value operator and the required accounting share one
  // definition of presence. The ledger value itself is untouched.
  const canonical = new Map<AnswerKey, AnswerValue>();
  const malformed: QuestionId[] = [];
  for (const { key, questionId } of keys) {
    if (!answers.has(key)) {
      continue;
    }
    const parsed = AnswerValue.safeParse(answers.get(key));
    if (!parsed.success) {
      malformed.push(questionId);
      continue;
    }
    if (!isBlankAnswerValue(parsed.data)) {
      canonical.set(key, parsed.data);
    }
  }
  if (malformed.length > 0) {
    return err({
      code: "MALFORMED_ANSWER_VALUE",
      message:
        "Answers for the question(s) in path are not canonical AnswerValue encodings (values never shown)",
      path: [...new Set(malformed)],
    });
  }

  // A StepId target conditions the step, never its questions individually:
  // step-level and question-level visibility are separate layers that AND
  // together, so a StepId target is whole-form scope and never per-instance.
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

  // An answer participates in condition evaluation only once its key is
  // settled visible (I6): a hidden or not-yet-walked reference reads as
  // unanswered.
  const settled = new Set<AnswerKey>();

  // Scope is implicit and by position (ADR-42). A reference into a group that
  // is not in scope has no forward-only reading, so it resolves to `undefined`
  // and reads as unanswered rather than throwing.
  type InstanceScope = ReadonlyMap<GroupId, InstanceId>;
  const NO_SCOPE: InstanceScope = new Map();
  const withInstance = (
    scope: InstanceScope,
    groupId: GroupId,
    instanceId: InstanceId,
  ): InstanceScope => new Map([...scope, [groupId, instanceId]]);

  const keyOf = (questionId: QuestionId, scope: InstanceScope): AnswerKey | undefined => {
    const groupId = groupOf.get(questionId);
    if (groupId === undefined) {
      return questionId;
    }
    const instanceId = scope.get(groupId);
    return instanceId === undefined ? undefined : answerKey(questionId, instanceId);
  };

  const effective = (questionId: QuestionId, scope: InstanceScope): AnswerValue | undefined => {
    const key = keyOf(questionId, scope);
    if (key === undefined) {
      return undefined;
    }
    return settled.has(key) ? canonical.get(key) : undefined;
  };

  const compareCount = (
    compare: "equals" | "gt" | "gte" | "lt" | "lte",
    count: number,
    value: number,
  ): boolean => {
    switch (compare) {
      case "equals":
        return count === value;
      case "gt":
        return count > value;
      case "gte":
        return count >= value;
      case "lt":
        return count < value;
      case "lte":
        return count <= value;
    }
  };

  const evalCondition = (
    rule: VisibilityRule,
    condition: Condition,
    scope: InstanceScope,
  ): Result<boolean, EvalError> => {
    switch (condition.op) {
      case "and": {
        for (const child of condition.conditions) {
          const outcome = evalCondition(rule, child, scope);
          if (!outcome.ok || !outcome.value) {
            return outcome;
          }
        }
        return ok(true);
      }
      case "or": {
        for (const child of condition.conditions) {
          const outcome = evalCondition(rule, child, scope);
          if (!outcome.ok || outcome.value) {
            return outcome;
          }
        }
        return ok(false);
      }
      case "not": {
        const outcome = evalCondition(rule, condition.condition, scope);
        return outcome.ok ? ok(!outcome.value) : outcome;
      }
      case "anyInstance": {
        for (const instanceId of rosterOf(condition.groupId)) {
          const outcome = evalCondition(
            rule,
            condition.condition,
            withInstance(scope, condition.groupId, instanceId),
          );
          if (!outcome.ok || outcome.value) {
            return outcome;
          }
        }
        return ok(false);
      }
      case "everyInstance": {
        const live = rosterOf(condition.groupId);
        // An empty roster is FALSE by decision, not by a fold's identity
        // (ADR-42). So `everyInstance(G, c)` is not equivalent to
        // `not(anyInstance(G, not c))`, which is true over an empty G, and
        // neither may be implemented as a rewrite of the other.
        if (live.length === 0) {
          return ok(false);
        }
        for (const instanceId of live) {
          const outcome = evalCondition(
            rule,
            condition.condition,
            withInstance(scope, condition.groupId, instanceId),
          );
          if (!outcome.ok || !outcome.value) {
            return outcome;
          }
        }
        return ok(true);
      }
      case "instanceCount":
        return ok(
          compareCount(condition.compare, rosterOf(condition.groupId).length, condition.value),
        );
      case "answered":
        return ok(effective(condition.questionId, scope) !== undefined);
      case "equals": {
        const answer = effective(condition.questionId, scope);
        return ok(answer !== undefined && valuesEqual(answer, condition.value));
      }
      case "notEquals": {
        const answer = effective(condition.questionId, scope);
        return ok(answer !== undefined && !valuesEqual(answer, condition.value));
      }
      case "in": {
        const answer = effective(condition.questionId, scope);
        return ok(
          answer !== undefined && condition.values.some((value) => valuesEqual(answer, value)),
        );
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const answer = effective(condition.questionId, scope);
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
        const answer = effective(condition.questionId, scope);
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

  const anyRuleTrue = (
    rules: readonly VisibilityRule[],
    scope: InstanceScope,
  ): Result<boolean, EvalError> => {
    for (const rule of rules) {
      const outcome = evalCondition(rule, rule.when, scope);
      if (!outcome.ok || outcome.value) {
        return outcome;
      }
    }
    return ok(false);
  };

  const visible: FlowState["visible"] = [];
  const walkQuestion = (
    stepId: StepId,
    questionId: QuestionId,
    instanceId: InstanceId | undefined,
    scope: InstanceScope,
  ): EvalError | undefined => {
    const targeting = questionRules.get(questionId);
    if (targeting !== undefined) {
      const shown = anyRuleTrue(targeting, scope);
      if (!shown.ok) {
        return shown.error;
      }
      if (!shown.value) {
        return undefined;
      }
    }
    settled.add(answerKey(questionId, instanceId));
    // The `instanceId` key is absent rather than undefined outside a group, so
    // a form with no repeating group stays deep-equal to its frozen output.
    visible.push(
      instanceId === undefined ? { stepId, questionId } : { stepId, questionId, instanceId },
    );
    return undefined;
  };

  // Collected after the step-level gate below, so a step rule still hides a
  // group-bearing step: a group's chrome is content, not an exemption.
  const groupBearingShown = new Set<StepId>();
  for (const step of form.steps) {
    const targetingStep = stepRules.get(step.stepId);
    if (targetingStep !== undefined) {
      const shown = anyRuleTrue(targetingStep, NO_SCOPE);
      if (!shown.ok) {
        return shown;
      }
      if (!shown.value) {
        // A hidden step settles none of its questions, so their answers stay
        // excluded downstream whatever the per-question rules say.
        continue;
      }
    }
    if (step.items.some(isRepeatGroup)) groupBearingShown.add(step.stepId);
    for (const item of step.items) {
      if (!isRepeatGroup(item)) {
        const failure = walkQuestion(step.stepId, item.questionId, undefined, NO_SCOPE);
        if (failure !== undefined) {
          return err(failure);
        }
        continue;
      }
      // Member-major, so the whole walk stays in document then roster order.
      const live = rosterOf(item.groupId);
      for (const member of item.items) {
        for (const instanceId of live) {
          const failure = walkQuestion(
            step.stepId,
            member.questionId,
            instanceId,
            withInstance(NO_SCOPE, item.groupId, instanceId),
          );
          if (failure !== undefined) {
            return err(failure);
          }
        }
      }
    }
  }

  // A repeated question is listed once and counts as missing when any live
  // instance of it is unanswered, which is what makes `complete` the
  // precondition submit needs: I9 requires every instance.
  const withVisibleQuestion = new Set(visible.map((entry) => entry.stepId));
  // Order comes from the form rather than from the walk, because the union of
  // two sets has none of its own.
  const visibleSteps = form.steps
    .map((step) => step.stepId)
    .filter((stepId) => withVisibleQuestion.has(stepId) || groupBearingShown.has(stepId));
  const requiredOrder: QuestionId[] = [];
  const requiredMissing = new Set<QuestionId>();
  const requiredSeen = new Set<QuestionId>();
  const answeredRequiredInstances: NonNullable<FlowState["answeredRequiredInstances"]> = [];
  const missingRequiredInstances: NonNullable<FlowState["missingRequiredInstances"]> = [];
  let firstMissingRequiredStep: StepId | null = null;
  const unansweredSteps = new Set<StepId>();
  for (const entry of visible) {
    const definition = definitions.get(entry.questionId);
    /* v8 ignore next 3 -- every pinned question was resolved above */
    if (definition === undefined) {
      continue;
    }
    const answered = canonical.has(answerKey(entry.questionId, entry.instanceId));
    if (!answered) {
      unansweredSteps.add(entry.stepId);
    }
    if (!definition.required) {
      continue;
    }
    if (!requiredSeen.has(entry.questionId)) {
      requiredSeen.add(entry.questionId);
      requiredOrder.push(entry.questionId);
    }
    const instanceId = entry.instanceId ?? null;
    (answered ? answeredRequiredInstances : missingRequiredInstances).push({
      questionId: entry.questionId,
      instanceId,
    });
    if (!answered) {
      requiredMissing.add(entry.questionId);
      if (firstMissingRequiredStep === null) {
        firstMissingRequiredStep = entry.stepId;
      }
    }
  }
  const answeredRequired = requiredOrder.filter((questionId) => !requiredMissing.has(questionId));
  const missingRequired = requiredOrder.filter((questionId) => requiredMissing.has(questionId));

  // A step holding a group with an empty roster has no visible question, so it
  // must still count as incomplete: landing on it is what mints the roster.
  // Document position decides, or a later step's unanswered question would win
  // over an earlier empty group.
  const firstIncompleteStep =
    visibleSteps.find(
      (stepId) =>
        unansweredSteps.has(stepId) ||
        (!withVisibleQuestion.has(stepId) && groupBearingShown.has(stepId)),
    ) ?? null;
  const base: FlowState = {
    visible,
    visibleSteps,
    currentStep: firstMissingRequiredStep ?? firstIncompleteStep,
    answeredRequired,
    missingRequired,
    complete: missingRequired.length === 0,
  };
  if (!hasGroups) {
    return ok(base);
  }
  return ok({
    ...base,
    visibleStepViews: stepViews(form, visibleSteps, rosterOf),
    missingRequiredInstances,
    answeredRequiredInstances,
    rosters: groups.map((group) => ({
      groupId: group.groupId,
      instances: [...rosterOf(group.groupId)],
    })),
  });
}

/**
 * The cursor's page list (ADR-28): one entry per view, which is a step except
 * where a `perInstanceStep` group paginates it into one view per live instance.
 *
 * Per-instance visibility never prunes the list. The cursor is an index into
 * it, so a view that vanished because an answer hid a member would renumber a
 * later instance's page and slide the respondent onto it, breaking ADR-28's
 * rule that answering never moves the rendered page by itself.
 *
 * Only the first `perInstanceStep` group in a step paginates it;
 * `paginatingGroup` in the serve-step handler reads the same way.
 */
function stepViews(
  form: FormDefinition,
  visibleSteps: readonly StepId[],
  rosterOf: (groupId: GroupId) => readonly InstanceId[],
): NonNullable<FlowState["visibleStepViews"]> {
  const views: NonNullable<FlowState["visibleStepViews"]> = [];
  const shown = new Set(visibleSteps);
  for (const step of form.steps) {
    if (!shown.has(step.stepId)) {
      continue;
    }
    const paginating = step.items.find(
      (item) => isRepeatGroup(item) && item.presentation === "perInstanceStep",
    );
    const live =
      paginating !== undefined && isRepeatGroup(paginating) ? rosterOf(paginating.groupId) : [];
    if (live.length === 0) {
      views.push({ stepId: step.stepId, instanceId: null });
      continue;
    }
    for (const instanceId of live) {
      views.push({ stepId: step.stepId, instanceId });
    }
  }
  return views;
}
