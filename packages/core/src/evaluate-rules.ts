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
 * The rules evaluator (task 006, ADR-16, invariants I6/I7). A pure, total,
 * deterministic function: same `(snapshot, answers, rosters)` → same
 * `FlowState`, forever. Semantics (DOMAIN_SCHEMA §3, frozen as {@link SEMANTICS_VERSION}):
 *
 * 1. **Single forward pass in document order** - never a fixpoint. Steps in
 *    order; within a step, items in order. Untargeted items are visible; a
 *    targeted item is visible iff at least one rule targeting it evaluates
 *    true *at that point in the walk*.
 * 2. Conditions over unanswered questions are `false`, except `answered`
 *    (the explicit existence test - including `notEquals`, which is `false`
 *    on unanswered). A referenced question currently *hidden* is treated as
 *    unanswered - well-defined because a referenced question's visibility was
 *    settled earlier in the walk (forward-only, publish-enforced). A **blank**
 *    text answer (empty or whitespace-only, {@link isBlankAnswerValue}) is
 *    unanswered here too: required means non-blank (issue #128), so one
 *    definition of presence serves the `answered` operator, every other
 *    operator, and the required accounting alike.
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
 * 6. **A repeating group's span is walked once per live instance** (ADR-42,
 *    ADR-16 as amended 2026-09-29), within this same `SEMANTICS_VERSION`. A
 *    rule whose `show` target sits inside group G is evaluated once per live
 *    instance of G, and a reference to a question inside G resolves to that
 *    instance's answer; three operators read a whole group from outside it, and
 *    `everyInstance` over a group with no live instance is FALSE by decision.
 *    A form with no repeating group evaluates byte-identically, which every
 *    committed golden scenario asserts with no `expected` block edited.
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
export type AnswerMap = ReadonlyMap<AnswerKey, AnswerValue>;

/**
 * The **live** instances of each repeating group, in roster order (ADR-42).
 *
 * The evaluator does not derive liveness and never reads a count answer to do
 * it: what it receives is the roster the API already derived from the
 * append-only roster table and the group's count source, and this function's
 * contract is that the map it is handed is live and ordered. Omitted, it is the
 * empty map, so every existing caller compiles and every existing form
 * evaluates identically.
 *
 * Passing the roster in rather than deriving it from the answer keys is the
 * choice that makes "Add passenger" visible: derived from answers, an instance
 * the respondent added and has not yet answered would not exist, so the button
 * would do nothing and a reload would lose the empty card.
 *
 * **Order is meaning here**, which is a first for the kernel: `multiChoice` is
 * the only other array value and ADR-21 compares it as a set precisely because
 * its order is not meaning. A roster is never set-compared. Determinism (I7)
 * widens with it, from "same `(snapshot, answers)`" to "same
 * `(snapshot, answers, rosters)`".
 */
export type RosterMap = ReadonlyMap<GroupId, readonly InstanceId[]>;

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

// The declared binding is lowercase to avoid shadowing the `EvalError` global
// error constructor; the schema and its inferred type are still exported under
// the domain name `EvalError` (public API unchanged).
const evalError = QcmsError.extend({ code: EvalErrorCode });
export { evalError as EvalError };
export type EvalError = z.infer<typeof evalError>;

/**
 * The evaluator's output (DOMAIN_SCHEMA §3): what is visible, where the
 * respondent should be, and whether the response is submittable. All arrays
 * are in document order.
 *
 * - `visible` - every visible `(stepId, questionId)` pair, carrying an
 *   `instanceId` on a repeated entry and no such key otherwise.
 * - `visibleSteps` - the steps contributing at least one visible question,
 *   **plus every step-visible step that holds a repeating group** (Q30, ruled
 *   2026-10-03). A step-visible step with no group whose questions are all
 *   rule-hidden renders nothing and is still not listed; a step holding a group
 *   always renders the group's own chrome, its heading and its Add control,
 *   which is content a respondent can act on. Before that ruling such a step
 *   was unreachable: it had nothing visible while its roster was empty, its
 *   roster was empty because the mint is due on the first serve of the group's
 *   own step, and that step was never served because it was not listed here.
 * - `currentStep` - semantic 5 above; `null` when nothing is unanswered.
 * - `answeredRequired` / `missingRequired` - visible required questions with
 *   and without an answer (required-ness comes from the resolved
 *   `QuestionDefinition`, task 003). A **repeated** question is listed **once**:
 *   it is missing when any live instance of it is unanswered, and the
 *   per-instance detail is in the parallel arrays below.
 * - `complete` - `missingRequired` is empty (I9's precondition; the
 *   submission sweep itself is task 009).
 *
 * **Order with a repeating group in the form.** A group expands into a
 * contiguous span of its member questions, and each member is walked once per
 * live instance, so every array here is in **document then roster order**: the
 * span's first question for every instance, then its second for every instance,
 * and so on. Nothing about a form with no group changes, because a form with no
 * group has one instance of nothing.
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
  // --- Repetition (ADR-42, ADR-16 as amended 2026-09-29). ---
  //
  // Every field below is OPTIONAL and is omitted entirely for a form with no
  // repeating group, and the six above keep their exact shapes and their exact
  // contents for such a form. That is the whole of the additivity contract:
  // `FlowState` is what every golden scenario asserts with `toEqual`, so
  // widening `visibleSteps` to `{stepId, instanceId}[]` or `missingRequired` to
  // `{questionId, instanceId}[]` would fail every committed scenario and would
  // need the `SEMANTICS_VERSION` bump that cannot be taken.
  //
  // **These parallel arrays are deliberate and they are the ugly part of the
  // design.** Two of them mean nearly the same thing as one of the originals,
  // because the original cannot change shape. Do not tidy them and do not add a
  // shim that makes them look like one field: collapsing them into the widened
  // originals is recorded as the FIRST JOB OF MULTI-VERSION EVALUATION
  // (ADR-16's amendment, Q8), which is somebody else's task and is what gives
  // this debt a named creditor rather than a hope.
  /** The ADR-28 cursor's real page list: one entry per step view. A step
   * paginated by a `perInstanceStep` group contributes one view per live
   * instance; every other visible step contributes one view with a null
   * instance. Task 076 owns the cursor that walks it. */
  visibleStepViews: z
    .array(z.object({ stepId: StepId, instanceId: InstanceId.nullable() }))
    .optional(),
  /** The per-instance detail behind `missingRequired`, in document then roster
   * order. `instanceId` is null for a visible required question outside every
   * group, so the array is a complete account rather than a group-only one. */
  missingRequiredInstances: z
    .array(z.object({ questionId: QuestionId, instanceId: InstanceId.nullable() }))
    .optional(),
  /** The per-instance detail behind `answeredRequired`; same shape. */
  answeredRequiredInstances: z
    .array(z.object({ questionId: QuestionId, instanceId: InstanceId.nullable() }))
    .optional(),
  /** The live roster this evaluation used, per group, in document order of the
   * groups and roster order within each. */
  rosters: z.array(z.object({ groupId: GroupId, instances: z.array(InstanceId) })).optional(),
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
 * `rosters` is the fourth input and it is **the live roster, already derived**
 * (ADR-42). Omitted, it is the empty map: every existing caller compiles and
 * every existing form evaluates identically, which is the whole of the
 * additivity contract on this signature. See {@link RosterMap} for why it is
 * passed in rather than read out of the answer keys.
 *
 * Total: never throws; malformed or unresolvable input returns a typed
 * `EvalError` (every code unreachable on publish-validated input).
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

  // The repeating groups this form declares, and the live roster of each. A
  // form with no group leaves both empty and every branch below that reads them
  // is skipped, which is how the six original FlowState fields keep their exact
  // contents and the four new ones stay absent.
  const groups = repeatGroups(form.steps);
  const hasGroups = groups.length > 0;
  const groupOf = questionGroups(form.steps);
  const rosterOf = (groupId: GroupId): readonly InstanceId[] => rosters?.get(groupId) ?? [];

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

  /**
   * Every answer key this form can hold, in document then roster order: the
   * bare `questionId` outside a group, and one `instanceId/questionId` per
   * **live** instance inside one.
   *
   * A key for an instance the roster does not list is simply not built, which
   * is the whole of the removal semantic at this layer: a removed instance's
   * answers stay in the ledger the caller read from, are never canonicalized,
   * never settle, and so are excluded from every later condition, from the
   * required accounting and from the locked set - exactly as a hidden
   * question's answers are (I6).
   */
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

  // Canonicalize answers for pinned questions (NFC text, deduplicated
  // multiChoice); unknown keys are ignored. Malformed values are reported
  // all-at-once, in document order - again independent of map order.
  //
  // A BLANK text answer is dropped here rather than special-cased downstream
  // (issue #128): `canonical` is the evaluator's single definition of "this
  // question has an answer", so dropping the entry gives `answered`, every
  // value operator, and the required accounting the same answer without three
  // chances to disagree. The value is not rewritten - it stays untouched in the
  // ledger the caller read it from; it simply does not confer presence.
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

  // Which rules target each step / each question directly. A StepId target
  // conditions the *step* (semantic 4); it does not make the step's questions
  // individually targeted - step-level and question-level visibility are
  // separate layers that AND together. A StepId target is therefore whole-form
  // scope and never per-instance, which is the reading `RULE_TARGETS_SPAN_SCOPES`
  // is written against.
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

  // The forward walk. `settled` holds answer keys already walked and visible;
  // an answer participates in condition evaluation only once its key is
  // settled visible (semantic 2 / I6 - hidden answers are excluded, and
  // not-yet-walked references read as unanswered).
  const settled = new Set<AnswerKey>();

  /**
   * Which instance of each group the current evaluation is inside.
   *
   * Scope is implicit and by position (ADR-42): a rule whose `show` target sits
   * inside group G is evaluated once per live instance of G with `{G -> that
   * instance}` in scope, and a `anyInstance`/`everyInstance` walk adds its own
   * group's instance the same way. A reference to a question in a group that is
   * in scope resolves to **that instance's** answer; a reference to a question
   * outside every group resolves normally.
   *
   * A reference to a question in a group that is **not** in scope has no
   * forward-only reading at all, so it resolves to `undefined` and reads as
   * unanswered - the same totality extension every other unresolvable reference
   * gets, never a throw.
   */
  type InstanceScope = ReadonlyMap<GroupId, InstanceId>;
  const NO_SCOPE: InstanceScope = new Map();
  const withInstance = (
    scope: InstanceScope,
    groupId: GroupId,
    instanceId: InstanceId,
  ): InstanceScope => new Map([...scope, [groupId, instanceId]]);

  /** The key a question resolves to under this scope, or `undefined` when it
   * sits in a group no instance of which is in scope. */
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
        // THE BASE CASE, and it is a decision rather than a fold's identity
        // (ADR-42's Note, Q7 ruled 2026-09-29). An empty roster short-circuits
        // to FALSE before the per-instance walk begins, because "every
        // passenger holds a passport" is not a true statement about a booking
        // with no passengers. It follows that `everyInstance(G, c)` is NOT
        // equivalent to `not(anyInstance(G, not c))` over an empty G - that
        // expression is true here - and nothing in this evaluator may
        // implement one as a rewrite of the other.
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

  /** True when at least one of the targeting rules matches, in declaration
   * order ("at that point in the walk" - evaluated against `settled`). */
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
  /** Walk one pinned question at one scope, settling it when it is shown. */
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
    // The `instanceId` KEY is absent, not undefined, on an entry outside every
    // group: a form with no repeating group must produce a byte-identical
    // FlowState, and that is asserted by deep equality rather than by review.
    visible.push(
      instanceId === undefined ? { stepId, questionId } : { stepId, questionId, instanceId },
    );
    return undefined;
  };

  /**
   * Steps whose own gate passed and which hold a repeating group (Q30).
   *
   * Collected inside this walk, after the step-level gate below, so a group-bearing step
   * a step rule hides stays hidden: the ruling makes a group's chrome content, not an
   * exemption from semantic 4.
   */
  const groupBearingShown = new Set<StepId>();
  for (const step of form.steps) {
    const targetingStep = stepRules.get(step.stepId);
    if (targetingStep !== undefined) {
      const shown = anyRuleTrue(targetingStep, NO_SCOPE);
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
    if (step.items.some(isRepeatGroup)) groupBearingShown.add(step.stepId);
    for (const item of step.items) {
      if (!isRepeatGroup(item)) {
        const failure = walkQuestion(step.stepId, item.questionId, undefined, NO_SCOPE);
        if (failure !== undefined) {
          return err(failure);
        }
        continue;
      }
      // A group's span is walked once per live instance, member-major so the
      // whole walk stays in document then roster order. A rule targeting a
      // member is evaluated once per instance with that instance in scope,
      // which is the entire inside-out story: no new syntax, the author writes
      // "this passenger is an infant, show this passenger's fare basis"
      // exactly as they write an ordinary rule.
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

  // Accounting over the visible set (semantic 5). A visible entry is answered
  // iff the (canonicalized) answer map has an entry for its key. A repeated
  // question is listed ONCE in `answeredRequired`/`missingRequired` and counts
  // as missing when ANY live instance of it is unanswered, which is what keeps
  // `complete` the precondition submit needs: I9 requires every instance.
  const withVisibleQuestion = new Set(visible.map((entry) => entry.stepId));
  // Document order, from the form rather than from the walk, because the union of two
  // sets has none of its own. For a form with no repeating group `groupBearingShown` is
  // empty and this is `visible`'s own step set in document order, which is byte-identical
  // to what the de-duplicated walk produced.
  const visibleSteps = form.steps
    .map((step) => step.stepId)
    .filter((stepId) => withVisibleQuestion.has(stepId) || groupBearingShown.has(stepId));
  const requiredOrder: QuestionId[] = [];
  const requiredMissing = new Set<QuestionId>();
  const requiredSeen = new Set<QuestionId>();
  const answeredRequiredInstances: NonNullable<FlowState["answeredRequiredInstances"]> = [];
  const missingRequiredInstances: NonNullable<FlowState["missingRequiredInstances"]> = [];
  let firstMissingRequiredStep: StepId | null = null;
  /** Steps with a visible question the ledger has no answer for. */
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

  /**
   * The first visible step with work left in it, in document order (Q30).
   *
   * A step holding a repeating group whose roster is empty has no visible question, so
   * the walk above can never nominate it; counting it as incomplete is what makes the
   * cursor-less serve land on it, which is what mints the roster. Ordering it by document
   * position rather than as a last resort is the half that is easy to get wrong: a later
   * step's unanswered question would otherwise win over an EARLIER empty group.
   *
   * For a form with no repeating group this is the first unanswered visible question's
   * step, which is exactly what the previous single-pass `firstUnansweredStep` found,
   * because `visibleSteps` and `visible` are both in document order.
   */
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
 * The ADR-28 cursor's page list (Q22): one entry per **view**, which is a step
 * for everything except a step paginated by a `perInstanceStep` group, where it
 * is one view per live instance.
 *
 * A step carrying such a group with an empty roster contributes one view with a
 * null instance, so a visible step is never absent from the list.
 *
 * ## The two edges task 071 left open, decided by task 076
 *
 * Both were left to the cursor's owner on the review of PR #1016 (2026-09-29),
 * because the cursor is what gives a view its meaning. Both are **kept exactly as
 * 071 wrote them**, and the reasons belong here rather than in a commit message.
 *
 * 1. **The list is derived from the roster, and per-instance visibility never
 *    prunes it.** A live instance contributes a view whether or not a rule has
 *    hidden some of its members. The decisive reason is ADR-28's own rule that
 *    **answering never moves the rendered page by itself**: the cursor is a
 *    0-based index into this list, so if a view could vanish because an answer
 *    hid a member, answering vehicle 2's question could renumber vehicle 3's page
 *    and slide the respondent onto it. Pruning would buy one empty page avoided
 *    and sell the one property the cursor exists to hold.
 * 2. **Only the FIRST `perInstanceStep` group in a step paginates it.** A step
 *    holding two of them is not a shape any presentation has defined, and picking
 *    the first is a reading the cursor can agree with. `paginatingGroup` in
 *    `apps/api/src/features/responses/serve-step/handler.ts` reads the same way,
 *    and a test pins the two together rather than a comment.
 *
 * The step's own visibility is still the outer gate: a step a STEP RULE hides
 * contributes no view, with a live roster or without one. What changed under Q30
 * (2026-10-03) is that holding a repeating group is itself enough to make a
 * step-visible step listed in `visibleSteps`, so a group-bearing step always has
 * at least one view - with a null instance while its roster is empty - and the
 * two fields agree. Before that ruling such a step had no view, was never
 * served, and so never minted the roster that would have given it one.
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
