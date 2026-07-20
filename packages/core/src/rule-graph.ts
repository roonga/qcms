import { DateAnswerValue } from "./answer-value.js";
import type { FormDefinition } from "./form-definition.js";
import { isOptionId, isStepId, type OptionId, type QuestionId, type StepId } from "./ids.js";
import type { PublishErrorOf } from "./publish-error.js";
import { optionIdsOf, type QuestionDefinition } from "./question-definition.js";
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

/** One question's position in the form: which step it sits in. Positions are
 * unique per question (parse rejects duplicate pins). */
export interface DocumentPosition {
  readonly stepId: StepId;
  readonly questionId: QuestionId;
}

/** The flat document order of a form: every `(stepId, questionId)` pair, in
 * the order a respondent encounters them (ADR-16 evaluation order). */
export function documentOrder(form: FormDefinition): readonly DocumentPosition[] {
  return form.steps.flatMap((step) =>
    step.items.map((item) => ({ stepId: step.stepId, questionId: item.questionId })),
  );
}

function collectReferences(condition: Condition, out: QuestionId[]): void {
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
    default:
      out.push(condition.questionId);
  }
}

/** Every questionId the rule's condition reads (recursive), deduplicated,
 * in first-encounter order. */
export function ruleReferences(rule: VisibilityRule): readonly QuestionId[] {
  const raw: QuestionId[] = [];
  collectReferences(rule.when, raw);
  return [...new Set(raw)];
}

function questionsByStep(form: FormDefinition): Map<StepId, readonly QuestionId[]> {
  return new Map(
    form.steps.map((step) => [step.stepId, step.items.map((item) => item.questionId)]),
  );
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

export type RuleGraphFinding = PublishErrorOf<"RULE_BACKWARD_TARGET" | "RULE_CYCLE">;

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

  // Backward targets: every target must sit strictly after every referenced
  // question in document order.
  for (const rule of form.rules) {
    const referencePositions = ruleReferences(rule)
      .map((questionId) => position.get(questionId))
      .filter((p): p is number => p !== undefined);
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
    const reads = ruleReferences(rule).filter((questionId) => position.has(questionId));
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
    findings.push({
      code: "RULE_CYCLE",
      message: `Rules ${rules.map((ruleId) => `"${ruleId}"`).join(", ")} form a cycle in the reads→shows graph (ADR-16)`,
      path: { rules },
    });
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
      case "not":
        checkCondition(rule, condition.condition);
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
