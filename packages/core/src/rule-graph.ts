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
 * Rule dependency-graph machinery (ADR-16, I10). Pure functions over a parsed
 * `FormDefinition`, so the kernel stays I/O-free (R3).
 *
 * Unresolvable ids are skipped here rather than double-reported: dangling
 * references are `compileDraft`'s findings. `DANGLING_OPTION_REF` is the
 * exception, because only the type check below looks inside an option
 * reference.
 */

/** One question's position in the form. Unique per question, since parse
 * rejects duplicate pins inside a group as well as outside. */
export interface DocumentPosition {
  readonly stepId: StepId;
  readonly questionId: QuestionId;
  /** The repeating group this position belongs to, absent outside one. */
  readonly groupId?: GroupId;
}

/**
 * The flat document order of a form: every `(stepId, questionId)` pair in the
 * order a respondent encounters them (ADR-16 evaluation order).
 *
 * A repeating group expands into a contiguous span of its members, and the span
 * is the unit the forward-only rule applies to. Instances do not multiply the
 * order, because the span is static and the roster is a runtime input, which is
 * what keeps this function answer-blind.
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
 * Every id a condition reads, split by kind. The whole-group operators need
 * their own branches: none carries a `questionId`, so without them a group
 * operator would read nothing and the forward-only rule would silently not
 * apply to it.
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

/** Every questionId the rule's condition reads, deduplicated, in
 * first-encounter order. */
export function ruleReferences(rule: VisibilityRule): readonly QuestionId[] {
  const raw = { questions: [] as QuestionId[], groups: [] as GroupId[] };
  collectReferences(rule.when, raw);
  return [...new Set(raw.questions)];
}

/** Every repeating group the rule's condition reads as a whole, deduplicated,
 * in first-encounter order. */
export function ruleGroupReferences(rule: VisibilityRule): readonly GroupId[] {
  const raw = { questions: [] as QuestionId[], groups: [] as GroupId[] };
  collectReferences(rule.when, raw);
  return [...new Set(raw.groups)];
}

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
 * The rule's expanded targets, deduplicated, in declaration order. A `StepId`
 * absent from the form expands to nothing, since `compileDraft` reports it.
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
  | "REPEAT_COUNT_INSIDE_GROUP"
  | "REPEAT_OPERATOR_NESTING_NOT_ALLOWED"
  | "RULE_READS_GROUP_WITHOUT_OPERATOR"
>;

/** The inclusive span a group occupies, as indices into {@link documentOrder}. */
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
 * Publish-time graph analysis (ADR-16, I10). Returns all findings rather than
 * stopping at the first. Ids that do not resolve within the form are skipped,
 * since `compileDraft`'s dangling checks own those.
 */
export function analyzeRuleGraph(form: FormDefinition): readonly RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  const order = documentOrder(form);
  const position = new Map<QuestionId, number>(order.map((entry, i) => [entry.questionId, i]));
  const byStep = questionsByStep(form);
  const spans = groupSpans(form);
  const groupOf = questionGroups(form.steps);

  findings.push(...checkRepeatCountOrder(form, position, spans, groupOf));
  findings.push(...checkTargetScopes(form, groupOf));
  findings.push(...checkOperatorNesting(form));
  findings.push(...checkScopedReferences(form, groupOf));
  findings.push(...checkCrossGroupBudget(form, groupOf, spans));

  // Every target must sit strictly after every referenced question in document
  // order. A referenced group contributes the last index of its span, so one
  // comparison covers the group readings too and no second check is needed.
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

  const adjacency = new Map<QuestionId, Edge[]>();
  for (const rule of form.rules) {
    // A whole-group operator reads every question in that group's span, so each
    // is a node the rule reads; otherwise a cycle running through a group
    // operator would be invisible to Tarjan's.
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
 * A `fromAnswer` count source is a read of its count question by the whole
 * group, so the question must precede the group's whole span (ADR-16). A count
 * question not pinned in the form is skipped here, like every other dangling
 * reference, and reported by `compileDraft`.
 */
function checkRepeatCountOrder(
  form: FormDefinition,
  position: ReadonlyMap<QuestionId, number>,
  spans: ReadonlyMap<GroupId, GroupSpan>,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
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
    // A count question inside any group has one answer per instance, so there
    // is no single count for the group it sizes to read.
    const countGroup = groupOf.get(group.count.questionId);
    if (countGroup !== undefined) {
      findings.push({
        code: "REPEAT_COUNT_INSIDE_GROUP",
        message: `Group "${group.groupId}" takes its instance count from question "${group.count.questionId}", which sits inside group "${countGroup}" and is therefore answered once per instance; move the count question out of every repeating group`,
        path: { group: group.groupId, question: group.count.questionId },
      });
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
 * One rule, one scope (ADR-03). A rule listing one target inside a group and
 * another outside it would be per-instance and whole-form at once, with no
 * reading that makes it one thing, so a mixed list is refused. Splitting it in
 * two is always possible, since the condition is copyable.
 *
 * A `StepId` target is whole-form scope by construction: a step target
 * conditions the step rather than its questions individually.
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
 * A whole-group operator may not sit inside another one's condition.
 *
 * The condition schema is recursive, so a nested pair parses, and it costs the
 * product of the two maxima whatever the rule targets. The evaluation budget
 * charges a rule's target group against each group it reads, so a nested pair
 * escapes it entirely (SEC-16). Refusing nesting makes every whole-group read
 * in a rule a sibling rather than a multiplier, which is what makes that
 * pairwise budget a real bound.
 *
 * The refusal covers nesting through `and`, `or` and `not`, a group nested in
 * itself, and `instanceCount` despite its constant cost, so that an author
 * never has to redo the cost calculation.
 */
function checkOperatorNesting(form: FormDefinition): RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  const walk = (rule: VisibilityRule, condition: Condition, outer: GroupId | undefined): void => {
    switch (condition.op) {
      case "and":
      case "or":
        condition.conditions.forEach((child) => {
          walk(rule, child, outer);
        });
        return;
      case "not":
        walk(rule, condition.condition, outer);
        return;
      case "anyInstance":
      case "everyInstance":
      case "instanceCount": {
        if (outer !== undefined) {
          findings.push({
            code: "REPEAT_OPERATOR_NESTING_NOT_ALLOWED",
            message: `Rule "${rule.ruleId}" reads group "${condition.groupId}" inside a condition that already reads group "${outer}"; a whole-group operator may not sit inside another, because the nested pair costs the product of their maxima whatever the rule targets (ADR-16)`,
            path: { rule: rule.ruleId, outerGroup: outer, innerGroup: condition.groupId },
          });
        }
        if (condition.op !== "instanceCount") {
          walk(rule, condition.condition, condition.groupId);
        }
        return;
      }
      default:
        return;
    }
  };
  for (const rule of form.rules) {
    walk(rule, rule.when, undefined);
  }
  return findings;
}

/**
 * Every reference to a question inside a repeating group is made from inside
 * that group. Such a question has one answer per instance, so a bare reference
 * is meaningful only where an instance is in scope: either the rule's own
 * targets sit inside that group, or the reference sits inside an `anyInstance`
 * or `everyInstance` over it.
 *
 * Anything else is dead rather than merely odd: the evaluator resolves it to no
 * key and reads it as unanswered forever, so the rule publishes cleanly and the
 * question never appears. A rule targeting inside one group while reading a
 * member of another is the same defect.
 *
 * A rule whose targets straddle two scopes is skipped, since
 * `RULE_TARGETS_SPAN_SCOPES` already refuses it and there is no single scope to
 * judge its references against.
 */
function checkScopedReferences(
  form: FormDefinition,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
): RuleGraphFinding[] {
  const findings: RuleGraphFinding[] = [];
  const walk = (
    rule: VisibilityRule,
    condition: Condition,
    inScope: ReadonlySet<GroupId>,
  ): void => {
    switch (condition.op) {
      case "and":
      case "or":
        condition.conditions.forEach((child) => {
          walk(rule, child, inScope);
        });
        return;
      case "not":
        walk(rule, condition.condition, inScope);
        return;
      case "anyInstance":
      case "everyInstance":
        walk(rule, condition.condition, new Set([...inScope, condition.groupId]));
        return;
      case "instanceCount":
        return;
      default: {
        const group = groupOf.get(condition.questionId);
        if (group === undefined || inScope.has(group)) {
          return;
        }
        findings.push({
          code: "RULE_READS_GROUP_WITHOUT_OPERATOR",
          message: `Rule "${rule.ruleId}" reads question "${condition.questionId}", which is inside group "${group}" and so has one answer per instance rather than one value; wrap the condition in "anyInstance" or "everyInstance" over "${group}", or target the rule inside that group`,
          path: { rule: rule.ruleId, question: condition.questionId, group },
        });
      }
    }
  };
  for (const rule of form.rules) {
    const scopes = new Set(
      rule.show.map((target) => (isStepId(target) ? undefined : groupOf.get(target))),
    );
    if (scopes.size !== 1) {
      continue; // RULE_TARGETS_SPAN_SCOPES owns this rule.
    }
    const [scope] = [...scopes];
    walk(rule, rule.when, scope === undefined ? new Set() : new Set([scope]));
  }
  return findings;
}

/**
 * The cross-group cost budget ({@link REPEAT_EVALUATION_BUDGET}, SEC-16). A
 * rule targeting inside one group while reading the whole of another costs the
 * product of their maxima on every evaluation.
 *
 * It is a cost bound rather than an instance ceiling: it caps no group's `max`,
 * and two large groups publish when no rule joins them. A group whose bounded
 * source omitted `max` is skipped, since `REPEAT_MAX_MISSING` already refuses
 * that draft.
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
 * contain a cycle: size above one, or a single node with a self-loop.
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

/** Lookup from questionId to the definition its pin resolves to, injected so
 * this package stays I/O-free (R3). Return `undefined` for an unresolvable id:
 * the reference is skipped here and reported by `compileDraft`. */
export type ResolveQuestion = (questionId: QuestionId) => QuestionDefinition | undefined;

/**
 * Type-compatibility check of every condition against the resolved question
 * definitions (DOMAIN_SCHEMA §3, ADR-21). Returns all findings, deduplicated.
 * Messages name ids, operators and types, never the compared values.
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
        // Whole-answer set equality (ADR-21); membership tests use
        // contains/containsAny instead.
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
      // These must branch rather than fall through: neither carries a
      // `questionId`, so the default branch would resolve nothing.
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
      return; // DANGLING_QUESTION_REF is compileDraft's finding.
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
