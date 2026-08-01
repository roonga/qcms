import {
  CONDITION_MAX_DEPTH,
  analyzeRuleGraph,
  checkRuleTypes,
  evaluateRules,
  parseFormDefinition,
  parseQuestionDefinition,
  parseQuestionId,
  type FormDefinition,
  type QuestionDefinition,
  type QuestionId,
} from "@qcms/core";

import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "./types.ts";

/**
 * The builder's client-side advisory analysis (task 033) - and the **only** module in the
 * admin app that imports `@qcms/core`.
 *
 * ## Why this is not an R2 violation, and why the exception is exactly one file
 *
 * R2 says a BFF does sessions, credentials and proxying: no business logic. Nothing here
 * is a BFF concern. This module runs in the **browser**, it decides nothing, and every
 * answer it produces is also produced authoritatively by the API - `POST .../draft/validate`
 * runs the same kernel functions server-side and its `PublishError[]` is what the
 * validation panel renders as the verdict. What this adds is latency: `analyzeRuleGraph`
 * tells an author their rule points backwards the instant they pick the target, instead
 * of one debounce and one round trip later. The task asks for exactly that, and 005
 * exports the function for exactly this caller.
 *
 * The narrowness is the control. `r2-import-surface.test.ts` allows `@qcms/core` in this
 * path and nowhere else, so the kernel cannot spread into the screens: a component that
 * wants a kernel answer has to come through a named function here, which is where review
 * can see it. Nothing in this module reaches the network, the database, or a credential,
 * and it is never imported by a server module.
 *
 * ## Everything here is advisory, including the silences
 *
 * A draft the kernel cannot parse yields **no** findings rather than a guess. That is not
 * a gap: an unparseable draft is one the author is still assembling (no steps yet, an
 * empty step), and the panel says so from `unsaveableReason` instead. Once the draft
 * parses, these findings and the API's agree, because they are the same functions.
 */

/** The kernel's condition depth cap, re-exported so the editor has one source for it. */
export { CONDITION_MAX_DEPTH };

/** A draft that the kernel accepted, plus the resolver its checks need. */
interface ParsedDraft {
  readonly form: FormDefinition;
  readonly resolve: (questionId: QuestionId) => QuestionDefinition | undefined;
}

/**
 * Resolve each pin to the definition of the exact version it names.
 *
 * Version-exact on purpose: the whole point of a manual pin (R7) is that a rule is
 * checked against the frozen definition it was written for, not against whatever the
 * question's latest version happens to say today. A pin whose version is missing from the
 * library resolves to `undefined`, which the kernel's checks skip and the API reports as
 * `DANGLING_QUESTION_REF`.
 */
function makeResolver(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
): (questionId: QuestionId) => QuestionDefinition | undefined {
  const byId = new Map(library.map((question) => [question.questionId, question]));
  const pinnedVersion = new Map(
    draft.steps.flatMap((step) => step.items.map((item) => [item.questionId, item.version])),
  );
  const cache = new Map<string, QuestionDefinition | undefined>();
  return (questionId) => {
    const key = String(questionId);
    if (cache.has(key)) return cache.get(key);
    const version = pinnedVersion.get(key);
    const found = byId.get(key)?.versions.find((v) => v.version === version);
    const parsed = found === undefined ? undefined : parseQuestionDefinition(found.definition);
    const definition = parsed !== undefined && parsed.ok ? parsed.value : undefined;
    cache.set(key, definition);
    return definition;
  };
}

/** Parse the working draft as a real `FormDefinition`, or `undefined` if it is not one yet. */
function parseDraft(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
): ParsedDraft | undefined {
  const parsed = parseFormDefinition(draft);
  if (!parsed.ok) return undefined;
  return { form: parsed.value, resolve: makeResolver(draft, library) };
}

/**
 * The findings the kernel can reach without the database: rule-graph and rule-type.
 *
 * Deliberately **not** everything the API reports. Dangling question refs, unpublished
 * pins, deprecated pins and locale completeness all depend on the library as the server
 * sees it, and answering them from a client-side copy would let the panel contradict the
 * authority a moment later. Those stay the round trip's to report; these two are pure
 * functions of the draft itself, which is why they can be instant.
 */
export function analyzeDraft(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
): readonly FormIssue[] {
  const parsed = parseDraft(draft, library);
  if (parsed === undefined) return [];
  return [
    ...analyzeRuleGraph(parsed.form),
    ...checkRuleTypes(parsed.form, parsed.resolve),
  ] as readonly FormIssue[];
}

/**
 * Whether the draft is a legal `FormDefinition` at all.
 *
 * Used to explain a paused autosave, never to permit one: `PUT .../draft` re-parses and
 * has the final say. See `draft.ts`'s `unsaveableReason` for the sentence the panel shows.
 */
export function draftParses(draft: DraftForm): boolean {
  return parseFormDefinition(draft).ok;
}

/** The kernel's verdict on one condition tree, for the editor's per-rule inline error. */
export function conditionIssues(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
  ruleId: string,
): readonly FormIssue[] {
  return analyzeDraft(draft, library).filter(
    (issue) => issue.path?.rule === ruleId || issue.path?.rules?.includes(ruleId) === true,
  );
}

// --- rule test bench --------------------------------------------------------

/** What the test bench can say about a rule, given a set of hypothetical answers. */
export type BenchVerdict =
  | { readonly kind: "match" }
  | { readonly kind: "noMatch" }
  | { readonly kind: "unavailable"; readonly reason: "noTarget" | "unresolved" };

/**
 * Evaluate one rule against hypothetical answers, on a **synthetic** snapshot.
 *
 * The synthetic form is two steps: everything the condition reads, then one target. That
 * layout is not a convenience, it is what makes the answer meaningful. ADR-16 evaluation
 * is a single forward pass, so a target's visibility is only well-defined when it sits
 * after every question the condition reads - and the real draft may not yet satisfy that
 * (a backward target is precisely one of the things the author comes here to understand).
 * Laying the synthetic snapshot out forward isolates the question the bench is actually
 * asking: *does this condition match these answers?* Whether the rule is legally placed
 * is `analyzeRuleGraph`'s answer, reported separately and at the rule.
 *
 * Read-only in the strongest sense: nothing here touches the draft, the answers never
 * leave the browser, and the result is labelled a preview in the UI.
 */
export function evaluateRuleBench(
  draft: DraftForm,
  library: readonly PinnableQuestion[],
  rule: DraftRule,
  answers: ReadonlyMap<string, unknown>,
  references: readonly string[],
): BenchVerdict {
  const target = firstResolvableTarget(draft, rule);
  if (target === undefined) return { kind: "unavailable", reason: "noTarget" };

  const versionOf = new Map(
    draft.steps.flatMap((step) => step.items.map((item) => [item.questionId, item.version])),
  );
  const referencePins = references
    .filter((questionId) => versionOf.has(questionId) && questionId !== target)
    .map((questionId) => ({ questionId, version: versionOf.get(questionId) ?? 1 }));
  if (referencePins.length === 0) return { kind: "unavailable", reason: "unresolved" };

  const synthetic = {
    formId: draft.formId,
    defaultLocale: draft.defaultLocale,
    title: draft.title,
    steps: [
      { stepId: "stp_bench_reads", title: { [draft.defaultLocale]: "Reads" }, items: referencePins },
      {
        stepId: "stp_bench_target",
        title: { [draft.defaultLocale]: "Target" },
        items: [{ questionId: target, version: versionOf.get(target) ?? 1 }],
      },
    ],
    rules: [{ ruleId: rule.ruleId, when: rule.when, show: [target] }],
  };

  const parsed = parseFormDefinition(synthetic);
  if (!parsed.ok) return { kind: "unavailable", reason: "unresolved" };

  const answerMap = new Map<QuestionId, never>();
  for (const [questionId, value] of answers) {
    const id = parseQuestionId(questionId);
    if (!id.ok || value === undefined) continue;
    answerMap.set(id.value, value as never);
  }

  const flow = evaluateRules(parsed.value, answerMap, makeResolver(draft, library));
  if (!flow.ok) return { kind: "unavailable", reason: "unresolved" };
  const visible = flow.value.visible.some((entry) => String(entry.questionId) === target);
  return visible ? { kind: "match" } : { kind: "noMatch" };
}

/** The first `show` entry that names a question the draft actually pins. */
function firstResolvableTarget(draft: DraftForm, rule: DraftRule): string | undefined {
  const byStep = new Map(
    draft.steps.map((step) => [step.stepId, step.items.map((item) => item.questionId)]),
  );
  const pinned = new Set(draft.steps.flatMap((s) => s.items.map((i) => i.questionId)));
  for (const target of rule.show) {
    if (pinned.has(target)) return target;
    const expanded = byStep.get(target) ?? [];
    if (expanded[0] !== undefined) return expanded[0];
  }
  return undefined;
}
