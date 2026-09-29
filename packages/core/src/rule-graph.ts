import { DateAnswerValue } from "./answer-value.js";
import type { FormDefinition } from "./form-definition.js";
import {
  isOptionId,
  isStepId,
  type GroupId,
  type OptionId,
  type QuestionId,
  type StepId,
} from "./ids.js";
import type { PublishErrorOf } from "./publish-error.js";
import { optionIdsOf, type QuestionDefinition } from "./question-definition.js";
import {
  countBounds,
  isRepeatGroup,
  repeatGroups,
  REPEAT_EVALUATION_BUDGET,
  questionGroups,
  type RepeatGroup,
} from "./step.js";
import type { Condition, VisibilityRule } from "./visibility-rule.js";

/**
 * Rule dependency-graph machinery (task 005, ADR-16, invariant I10). Pure
 * functions over a parsed `FormDefinition` - no I/O (R3). `compileDraft`
 * (008) runs these at publish; the admin editor (033) runs them live.
 *
 * ADR-16 makes single-forward-pass evaluation sound by rejecting at publish:
 * - `RULE_BACKWARD_TARGET` - a rule target at or before any question its
 *   condition references, in document order (targets must appear strictly
 *   after every referenced question);
 * - `RULE_CYCLE` - a cycle in the reads→shows digraph.
 *
 * Dangling references (a rule reading or targeting a question/step not in the
 * form, or an optionId a pinned question version does not carry) are publish
 * invariants of 008 (`DANGLING_QUESTION_REF`/`DANGLING_STEP_REF`); the graph
 * functions here skip unresolvable ids rather than double-report them -
 * except `DANGLING_OPTION_REF`, which is this module's to find because only
 * the type check looks inside option references.
 */

/** One question's position in the form: which step it sits in, and which
 * repeating group when it is inside one. Positions are unique per question
 * (parse rejects duplicate pins, inside a group as well as outside). */
export interface DocumentPosition {
  readonly stepId: StepId;
  readonly questionId: QuestionId;
  /** The repeating group whose span this position belongs to, when it is inside
   * one (ADR-42). Absent for a question outside every group. */
  readonly groupId?: GroupId;
}

/**
 * The flat document order of a form: every `(stepId, questionId)` pair, in the
 * order a respondent encounters them (ADR-16 evaluation order).
 *
 * **A repeating group expands into a contiguous span of its member questions,
 * in order** (ADR-16 as amended 2026-09-30). The span is the unit the
 * forward-only rule applies to: a rule targeting inside the group may read
 * questions before the group and questions earlier within the same instance,
 * while a rule reading the **whole** group must target after the whole span.
 * Instances do not multiply the order - the span is static and the roster is a
 * runtime input - which is what keeps `documentOrder` answer-blind.
 */
export function documentOrder(form: FormDefinition): readonly DocumentPosition[] {
  return form.steps.flatMap((step) =>
    step.items.flatMap((item) =>
      isRepeatGroup(item)
        ? item.items.map((member) => ({
            stepId: step.stepId,
            questionId: member.questionId,
            groupId: item.groupId,
          }))
        : [{ stepId: step.stepId, questionId: item.questionId }],
    ),
  );
}

/**
 * Every id a condition reads, split by kind.
 *
 * **The group branches here are the ones this module could not do without.**
 * The default branch reads `condition.questionId`, which none of the three
 * whole-group operators carries, so without these cases a group operator reads
 * nothing at all: `analyzeRuleGraph` and the cycle graph both consume this
 * function, and forward-only rule 2 would silently not apply to the very rule
 * shape it was written for (ADR-03's amendment says so in terms).
 */
function collectReferences(
  condition: Condition,
  out: { readonly questions: QuestionId[]; readonly groups: GroupId[] },
): void {
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((child) => {
        collectReferences(child, out);
      });
      return;
    case "not":
      collectReferences(condition.condition, out);
      return;
    case "anyInstance":
    case "everyInstance":
      out.groups.push(condition.groupId);
      collectReferences(condition.condition, out);
      return;
    case "instanceCount":
      out.groups.push(condition.groupId);
      return;
    default:
      out.questions.push(condition.questionId);
  }
}

/** Every questionId the rule's condition reads (recursive, through the
 * whole-group operators' nested conditions too), deduplicated, in
 * first-encounter order. */
export function ruleReferences(rule: VisibilityRule): readonly QuestionId[] {
  const raw = { questions: [] as QuestionId[], groups: [] as GroupId[] };
  collectReferences(rule.when, raw);
  return [...new Set(raw.questions)];
}

/** Every repeating group the rule's condition reads **as a whole** through
 * `anyInstance`, `everyInstance` or `instanceCount`, deduplicated, in
 * first-encounter order (ADR-42). */
export function ruleGroupReferences(rule: VisibilityRule): readonly GroupId[] {
  const raw = { questions: [] as QuestionId[], groups: [] as GroupId[] };
  collectReferences(rule.when, raw);
  return [...new Set(raw.groups)];
}

/** Every question a step holds, group members included, in document order. */
function questionsByStep(form: FormDefinition): Map<StepId, readonly QuestionId[]> {
  const byStep = new Map<StepId, QuestionId[]>();
  for (const { stepId, questionId } of documentOrder(form)) {
    byStep.set(stepId, [...(byStep.get(stepId) ?? []), questionId]);
  }
  for (const step of form.steps) {
    if (!byStep.has(step.stepId)) {
      byStep.set(step.stepId, []);
    }
  }
  return byStep;
}

/**
 * The rule's expanded targets, deduplicated, in declaration order: a
 * `QuestionId` target stands for itself, a `StepId` target expands to all of
 * that step's questions. A `StepId` not present in the form expands to
 * nothing (008 reports it as `DANGLING_STEP_REF`).
 */
export function ruleTargets(form: FormDefinition, rule: VisibilityRule): readonly QuestionId[] {
  const byStep = questionsByStep(form);
  const expanded: QuestionId[] = [];
  for (const target of rule.show) {
    if (isStepId(target)) {
      expanded.push(...(byStep.get(target) ?? []));
    } else {
      expanded.push(target);
    }
  }
  return [...new Set(expanded)];
}

export type RuleGraphFinding = PublishErrorOf<
  | "RULE_BACKWARD_TARGET"
  | "RULE_CYCLE"
  | "RULE_TARGETS_SPAN_SCOPES"
  | "REPEAT_EVALUATION_BUDGET_EXCEEDED"
  | "REPEAT_COUNT_BACKWARD_REF"
>;

/** The half-open span a repeating group occupies in document order: `[from,
 * to]`, inclusive, as indices into {@link documentOrder}. */
interface GroupSpan {
  readonly group: RepeatGroup;
  readonly from: number;
  readonly to: number;
}

function groupSpans(form: FormDefinition): ReadonlyMap<GroupId, GroupSpan> {
  const order = documentOrder(form);
  const spans = new Map<GroupId, GroupSpan>();
  for (const group of repeatGroups(form.steps)) {
    const indices = order
      .map((entry, index) => (entry.groupId === group.groupId ? index : -1))
      .filter((index) => index >= 0);
    /* v8 ignore next 3 -- a group's items are `.min(1)`, so its span is never empty */
    if (indices.length === 0) {
      continue;
    }
    spans.set(group.groupId, {
      group,
      from: Math.min(...indices),
      to: Math.max(...indices),
    });
  }
  return spans;
}

/** reads→shows edge: `from` is read by a rule that shows `to`. */
interface Edge {
  readonly to: QuestionId;
  readonly rule: VisibilityRule;
}

/**
 * Publish-time graph analysis (ADR-16, I10). Returns **all** findings, never
 * first-only:
 *
 * - `RULE_BACKWARD_TARGET` - one finding per offending `show` entry (the raw
 *   target, a step target being backward when any of its questions is at or
 *   before any referenced question);
 * - `RULE_CYCLE` - one finding per strongly connected component of the
 *   reads→shows digraph containing a cycle, listing the rules on it in
 *   declaration order.
 *
 * Ids that do not resolve within the form are skipped here (008's dangling
 * checks own those).
 */
export function analyzeRuleGraph(form: FormDefinition): readonly RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  const order = documentOrder(form);
  const position = new Map<QuestionId, number>(order.map((entry, i) => [entry.questionId, i]));
  const byStep = questionsByStep(form);
  const spans = groupSpans(form);
  const groupOf = questionGroups(form.steps);

  findings.push(...checkRepeatCountOrder(form, position, spans));
  findings.push(...checkTargetScopes(form, groupOf));
  findings.push(...checkCrossGroupBudget(form, groupOf, spans));

  // Backward targets: every target must sit strictly after every referenced
  // question in document order.
  //
  // With a repeating group the same arithmetic covers all three readings of
  // ADR-16's amendment, which is why there is no second check here. A rule
  // targeting inside group G reads the whole of G when it uses a whole-group
  // operator, so a referenced GROUP contributes the last index of its span
  // rather than a single position; a reference to a question inside G
  // contributes that question's own index, so "a later position inside the
  // instance" is backward by exactly the comparison that was already here.
  for (const rule of form.rules) {
    const referencePositions = [
      ...ruleReferences(rule).map((questionId) => position.get(questionId)),
      ...ruleGroupReferences(rule).map((groupId) => spans.get(groupId)?.to),
    ].filter((p): p is number => p !== undefined);
    if (referencePositions.length === 0) {
      continue;
    }
    const lastReference = Math.max(...referencePositions);
    for (const target of rule.show) {
      const expanded = isStepId(target) ? (byStep.get(target) ?? []) : [target];
      const targetPositions = expanded
        .map((questionId) => position.get(questionId))
        .filter((p): p is number => p !== undefined);
      if (targetPositions.length === 0) {
        continue;
      }
      if (Math.min(...targetPositions) <= lastReference) {
        findings.push({
          code: "RULE_BACKWARD_TARGET",
          message: `Rule "${rule.ruleId}" shows "${target}" at or before a question its condition references; targets must appear strictly later in document order (ADR-16)`,
          path: { rule: rule.ruleId, target },
        });
      }
    }
  }

  // Cycles in the reads→shows digraph (questions as nodes; an edge per
  // (referenced question, expanded target) pair, labeled with its rule).
  const adjacency = new Map<QuestionId, Edge[]>();
  for (const rule of form.rules) {
    // A whole-group operator reads every question in that group's span, so each
    // of them is a node the rule reads - otherwise a cycle running through a
    // group operator would be invisible to Tarjan's.
    const groupReads = ruleGroupReferences(rule).flatMap((groupId) => {
      const span = spans.get(groupId);
      return span === undefined ? [] : span.group.items.map((item) => item.questionId);
    });
    const reads = [...new Set([...ruleReferences(rule), ...groupReads])].filter((questionId) =>
      position.has(questionId),
    );
    const shows = ruleTargets(form, rule).filter((questionId) => position.has(questionId));
    for (const from of reads) {
      const edges = adjacency.get(from) ?? [];
      for (const to of shows) {
        edges.push({ to, rule });
      }
      adjacency.set(from, edges);
    }
  }
  for (const component of cyclicComponents(adjacency)) {
    const members = new Set(component);
    const onCycle = form.rules.filter((rule) =>
      [...adjacency.entries()].some(
        ([from, edges]) =>
          members.has(from) && edges.some((edge) => edge.rule === rule && members.has(edge.to)),
      ),
    );
    /* v8 ignore next -- a cyclic component always has at least one edge/rule */
    const rules = onCycle.length > 0 ? onCycle.map((rule) => rule.ruleId) : [];
    const quotedRules = rules.map((ruleId) => `"${ruleId}"`).join(", ");
    findings.push({
      code: "RULE_CYCLE",
      message: `Rules ${quotedRules} form a cycle in the reads→shows graph (ADR-16)`,
      path: { rules },
    });
  }

  return findings;
}

/**
 * Forward-only rule 3 (ADR-16 as amended 2026-09-30): a `fromAnswer` count
 * source is a read of its count question **by the whole group**, so that
 * question must precede the group's whole span. A count question inside the
 * group it sizes, or after it, is `REPEAT_COUNT_BACKWARD_REF`.
 *
 * A count question that is not pinned in the form at all is skipped here, the
 * way every other dangling reference is: `compileDraft` reports it.
 */
function checkRepeatCountOrder(
  form: FormDefinition,
  position: ReadonlyMap<QuestionId, number>,
  spans: ReadonlyMap<GroupId, GroupSpan>,
): RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  for (const group of repeatGroups(form.steps)) {
    if (group.count.source !== "fromAnswer") {
      continue;
    }
    const countAt = position.get(group.count.questionId);
    const span = spans.get(group.groupId);
    if (countAt === undefined || span === undefined) {
      continue;
    }
    if (countAt >= span.from) {
      findings.push({
        code: "REPEAT_COUNT_BACKWARD_REF",
        message: `Group "${group.groupId}" takes its instance count from question "${group.count.questionId}", which does not appear strictly before the group's span in document order (ADR-16)`,
        path: { group: group.groupId, question: group.count.questionId },
      });
    }
  }
  return findings;
}

/**
 * One rule, one scope (ADR-03 as amended 2026-09-30).
 *
 * `VisibilityRule.show` is an array, so a rule listing one target inside a
 * group and another outside it would be per-instance and whole-form at once,
 * and there is no reading that makes it one thing. Evaluating it per target
 * would make one rule mean two things and make the admin's scope chip a lie, so
 * **every `show` target of one rule must share one scope** and a mixed list is
 * refused with `RULE_TARGETS_SPAN_SCOPES` naming both scopes. Splitting it into
 * two rules is always possible, because the condition is copyable and the split
 * changes nothing about what either rule means.
 *
 * A `StepId` target is whole-form scope by construction and never per-instance:
 * a step target conditions the **step** (evaluator semantic 4) rather than its
 * questions individually, which is the same reading the evaluator has always
 * had of it.
 */
function checkTargetScopes(
  form: FormDefinition,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
): RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  for (const rule of form.rules) {
    const scopes: (GroupId | "form")[] = [];
    for (const target of rule.show) {
      const scope = isStepId(target) ? "form" : (groupOf.get(target) ?? "form");
      if (!scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
    if (scopes.length > 1) {
      const named = scopes.map((scope) => (scope === "form" ? "the form" : `group "${scope}"`));
      findings.push({
        code: "RULE_TARGETS_SPAN_SCOPES",
        message: `Rule "${rule.ruleId}" shows targets in more than one scope (${named.join(" and ")}); one rule is evaluated in one scope, so split it into one rule per scope (ADR-42)`,
        path: { rule: rule.ruleId, scopes },
      });
    }
  }
  return findings;
}

/**
 * The cross-group cost budget (ADR-16 as amended 2026-09-30, and
 * {@link REPEAT_EVALUATION_BUDGET}).
 *
 * A rule whose target sits inside group H and whose condition applies a
 * whole-group operator over a **different** group G is evaluated once per live
 * instance of H, and each of those evaluations walks the whole of G, so its
 * cost is `max_H x max_G`. Above the budget it is refused with
 * `REPEAT_EVALUATION_BUDGET_EXCEEDED` naming both groups, both maxima and the
 * product.
 *
 * It is a **cost bound and not an instance ceiling**: it caps no group's `max`,
 * and two groups whose product exceeds it publish happily when no rule joins
 * them. A group whose bounded source omitted `max` is skipped here, because
 * `REPEAT_MAX_MISSING` is already refusing that draft and a second finding
 * about an absent number would say nothing more.
 */
function checkCrossGroupBudget(
  form: FormDefinition,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
  spans: ReadonlyMap<GroupId, GroupSpan>,
): RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  const maxOf = (groupId: GroupId): number | undefined => {
    const span = spans.get(groupId);
    return span === undefined ? undefined : countBounds(span.group.count).max;
  };
  for (const rule of form.rules) {
    const targetGroups = new Set(
      rule.show.map((target) => (isStepId(target) ? undefined : groupOf.get(target))),
    );
    for (const targetGroup of targetGroups) {
      if (targetGroup === undefined) {
        continue;
      }
      const targetMax = maxOf(targetGroup);
      if (targetMax === undefined) {
        continue;
      }
      for (const readGroup of ruleGroupReferences(rule)) {
        const readMax = readGroup === targetGroup ? undefined : maxOf(readGroup);
        if (readMax === undefined) {
          continue;
        }
        const product = targetMax * readMax;
        if (product > REPEAT_EVALUATION_BUDGET) {
          findings.push({
            code: "REPEAT_EVALUATION_BUDGET_EXCEEDED",
            message: `Rule "${rule.ruleId}" targets inside group "${targetGroup}" (max ${String(targetMax)}) and reads the whole of group "${readGroup}" (max ${String(readMax)}), which costs ${String(product)} instance pairs on every evaluation and exceeds the evaluator budget of ${String(REPEAT_EVALUATION_BUDGET)} (ADR-16)`,
            path: { rule: rule.ruleId, targetGroup, readGroup },
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Tarjan's strongly-connected-components, returning only components that
 * contain a cycle: size > 1, or a single node with a self-loop.
 */
function cyclicComponents(
  adjacency: ReadonlyMap<QuestionId, readonly Edge[]>,
): readonly (readonly QuestionId[])[] {
  const nodes = new Set<QuestionId>();
  for (const [from, edges] of adjacency) {
    nodes.add(from);
    for (const edge of edges) {
      nodes.add(edge.to);
    }
  }

  const index = new Map<QuestionId, number>();
  const lowLink = new Map<QuestionId, number>();
  const onStack = new Set<QuestionId>();
  const stack: QuestionId[] = [];
  const result: (readonly QuestionId[])[] = [];
  let counter = 0;

  const strongConnect = (node: QuestionId): void => {
    index.set(node, counter);
    lowLink.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const edge of adjacency.get(node) ?? []) {
      if (!index.has(edge.to)) {
        strongConnect(edge.to);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(edge.to) ?? 0));
      } else if (onStack.has(edge.to)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, index.get(edge.to) ?? 0));
      }
    }

    if (lowLink.get(node) === index.get(node)) {
      const component: QuestionId[] = [];
      for (;;) {
        const member = stack.pop();
        /* v8 ignore next 3 -- the stack cannot run dry before reaching the root */
        if (member === undefined) {
          break;
        }
        onStack.delete(member);
        component.push(member);
        if (member === node) {
          break;
        }
      }
      const selfLoop = (adjacency.get(node) ?? []).some((edge) => edge.to === node);
      if (component.length > 1 || selfLoop) {
        result.push(component);
      }
    }
  };

  for (const node of nodes) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }
  return result;
}

export type RuleTypeFinding = PublishErrorOf<"RULE_TYPE_MISMATCH" | "DANGLING_OPTION_REF">;

/** Lookup from questionId to the definition its pin resolves to. Passed in so
 * this package stays I/O-free (R3): the caller (008's compileDraft, 033's
 * editor) owns resolving pins against its question store. Return `undefined`
 * for an unresolvable id - the reference is skipped here and reported as
 * `DANGLING_QUESTION_REF` by 008. */
export type ResolveQuestion = (questionId: QuestionId) => QuestionDefinition | undefined;

/**
 * Type-compatibility check of every condition against the resolved question
 * definitions (DOMAIN_SCHEMA §3, ADR-21). Returns all findings, deduplicated:
 *
 * - `gt/gte/lt/lte` only against `number`/`date` questions, with a value of
 *   the question's type (cross-type ordering is unreachable post-publish -
 *   §2.4);
 * - `equals`/`notEquals`/`in` values must match the referenced question's
 *   canonical `AnswerValue` type; on choice questions the value(s) must be
 *   declared `optionId`s (multiChoice `equals` compares whole answers - an
 *   `OptionId[]` - by set equality, never containment);
 * - `contains`/`containsAny` only against `multiChoice` questions and only
 *   with declared `optionId`s (ADR-21).
 *
 * Messages name ids, operators, and types - never the compared values.
 */
export function checkRuleTypes(
  form: FormDefinition,
  resolveQuestion: ResolveQuestion,
): readonly RuleTypeFinding[] {
  const findings = new Map<string, RuleTypeFinding>();

  const addMismatch = (rule: VisibilityRule, questionId: QuestionId, message: string): void => {
    const key = JSON.stringify(["RULE_TYPE_MISMATCH", rule.ruleId, questionId, message]);
    findings.set(key, {
      code: "RULE_TYPE_MISMATCH",
      message,
      path: { rule: rule.ruleId, question: questionId },
    });
  };

  const addDanglingOption = (
    rule: VisibilityRule,
    questionId: QuestionId,
    option: OptionId,
  ): void => {
    const key = JSON.stringify(["DANGLING_OPTION_REF", rule.ruleId, questionId, option]);
    findings.set(key, {
      code: "DANGLING_OPTION_REF",
      message: `Rule "${rule.ruleId}" references optionId "${option}" which question "${questionId}" does not declare`,
      path: { rule: rule.ruleId, question: questionId, option },
    });
  };

  /** equals/notEquals/in value against the question's canonical encoding. */
  const checkValue = (
    rule: VisibilityRule,
    question: QuestionDefinition,
    value: unknown,
    op: string,
  ): void => {
    const mismatch = (expected: string): void => {
      addMismatch(
        rule,
        question.questionId,
        `Rule "${rule.ruleId}": ${op} value for ${question.type} question "${question.questionId}" must be ${expected}`,
      );
    };
    switch (question.type) {
      case "shortText":
      case "longText":
        if (typeof value !== "string") {
          mismatch("a string");
        }
        return;
      case "number":
        if (typeof value !== "number") {
          mismatch("a number");
        }
        return;
      case "date":
        if (!DateAnswerValue.safeParse(value).success) {
          mismatch("a canonical YYYY-MM-DD date");
        }
        return;
      case "boolean":
        if (typeof value !== "boolean") {
          mismatch("a boolean");
        }
        return;
      case "singleChoice":
        if (!isOptionId(value)) {
          mismatch("a declared optionId");
        } else if (!optionIdsOf(question).includes(value)) {
          addDanglingOption(rule, question.questionId, value);
        }
        return;
      case "multiChoice": {
        // Whole-answer set equality (ADR-21): the value is an OptionId[];
        // membership tests use contains/containsAny instead.
        if (!Array.isArray(value) || !value.every((entry) => isOptionId(entry))) {
          mismatch(
            "an array of declared optionIds (set equality; use contains/containsAny for membership)",
          );
          return;
        }
        const declared = new Set<OptionId>(optionIdsOf(question));
        for (const entry of value as readonly OptionId[]) {
          if (!declared.has(entry)) {
            addDanglingOption(rule, question.questionId, entry);
          }
        }
        return;
      }
    }
  };

  const checkCondition = (rule: VisibilityRule, condition: Condition): void => {
    switch (condition.op) {
      case "and":
      case "or":
        condition.conditions.forEach((child) => {
          checkCondition(rule, child);
        });
        return;
      // The two whole-group operators that carry a nested condition recurse
      // exactly as `not` does. They must branch here rather than fall through:
      // neither carries a `questionId`, so the default branch below would
      // resolve `undefined` and check nothing. `instanceCount` carries no
      // nested condition and reads no question at all, so it is a leaf with
      // nothing to type-check (ADR-42).
      case "not":
      case "anyInstance":
      case "everyInstance":
        checkCondition(rule, condition.condition);
        return;
      case "instanceCount":
        return;
      default:
        break;
    }
    const question = resolveQuestion(condition.questionId);
    if (question === undefined) {
      return; // DANGLING_QUESTION_REF is 008's finding.
    }
    switch (condition.op) {
      case "equals":
      case "notEquals":
        checkValue(rule, question, condition.value, condition.op);
        return;
      case "in":
        condition.values.forEach((value) => {
          checkValue(rule, question, value, "in");
        });
        return;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        if (question.type !== "number" && question.type !== "date") {
          addMismatch(
            rule,
            question.questionId,
            `Rule "${rule.ruleId}": ${condition.op} is only valid against number or date questions, and "${question.questionId}" is ${question.type}`,
          );
          return;
        }
        const valueMatches =
          question.type === "number"
            ? typeof condition.value === "number"
            : DateAnswerValue.safeParse(condition.value).success;
        if (!valueMatches) {
          addMismatch(
            rule,
            question.questionId,
            `Rule "${rule.ruleId}": ${condition.op} value must match the ${question.type} type of question "${question.questionId}" (cross-type comparison, §2.4)`,
          );
        }
        return;
      }
      case "answered":
        return; // Valid against every question type.
      case "contains":
      case "containsAny": {
        if (question.type !== "multiChoice") {
          addMismatch(
            rule,
            question.questionId,
            `Rule "${rule.ruleId}": ${condition.op} is only valid against multiChoice questions (ADR-21), and "${question.questionId}" is ${question.type}`,
          );
          return;
        }
        const declared = new Set<OptionId>(optionIdsOf(question));
        const options = condition.op === "contains" ? [condition.value] : condition.values;
        for (const option of options) {
          if (!declared.has(option)) {
            addDanglingOption(rule, question.questionId, option);
          }
        }
        return;
      }
    }
  };

  for (const rule of form.rules) {
    checkCondition(rule, rule.when);
  }
  return [...findings.values()];
}
