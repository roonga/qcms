import { DEFAULT_LOCALE, localizedDraft } from "../questions/definition.ts";

import type { DraftForm, DraftPin, DraftRule, DraftStep, PinnableQuestion } from "./types.ts";

/**
 * Pure draft mutations for the form builder (task 033).
 *
 * Every function here takes a draft and returns a new one. Nothing validates: whether a
 * draft is legal is the kernel's answer, and the kernel runs in the API. The admin reaches
 * it through `POST .../draft/validate`, never by importing it (the import-surface test
 * bans `@qcms/core` in this app outright). What this module owns is the *shape* of an
 * edit, and two shapes in particular are load-bearing.
 *
 * **A pin is manual, always (R7).** `movePin` is the only function that changes a
 * `version`, it changes exactly one pin, and it is only ever called from a per-ref menu.
 * There is no bulk move and no auto-upgrade anywhere in this module, and that absence is
 * the feature: an author who published question v3 last week must still see v2 in every
 * form that pinned it, because the alternative is a form whose meaning changed without
 * anyone deciding it should.
 *
 * **A step id is minted once.** Like an `optionId` (032), a `stepId` is a permanent name
 * a rule can target, so renaming a step carries its id through untouched. Only
 * {@link addStep} mints one, and it mints against {@link reservedStepIds} so a retired
 * name is never handed out a second time.
 */

/** Steps and rules both need a stable, human-meaningful id minted from a title. */
function identifierCore(text: string): string {
  const collapsed = text.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "_") start += 1;
  while (end > start && collapsed[end - 1] === "_") end -= 1;
  return collapsed.slice(start, end);
}

/** Mint a prefixed id from a title, unique against `taken`. Counts from 2, like 032's. */
function mintId(prefix: string, text: string, taken: readonly string[], fallback: string): string {
  const core = identifierCore(text);
  const base = `${prefix}${core === "" ? fallback : core}`;
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** The `frm_`-prefixed id a slug proposes, shown live beside the slug field. */
export function formIdFromSlug(slug: string): string {
  const core = identifierCore(slug);
  return core === "" ? "" : `frm_${core}`;
}

/** An empty draft, matching the one the API seeds on create. */
export function blankDraft(formId: string, defaultLocale = DEFAULT_LOCALE): DraftForm {
  return { formId, defaultLocale, title: {}, steps: [], rules: [] };
}

// --- steps ------------------------------------------------------------------

/**
 * Every step id that is spoken for: the ones a step currently carries, plus every id any
 * rule still names in `show`.
 *
 * The second half is the load-bearing one. {@link removeStep} deliberately leaves a
 * dangling `show: ["stp_gone"]` behind so the author is told about it (`DANGLING_STEP_REF`)
 * and decides what the rule should say now. That only works while the retired name stays
 * retired: minting against live steps alone, a later step titled the way the deleted one
 * was gets `stp_gone` minted a second time, the orphaned rule silently re-attaches to a
 * step nobody pointed it at, and the issue the author was meant to answer disappears with
 * no signal. Reserving referenced ids keeps the deletion visible until it is dealt with.
 *
 * `show` also holds question ids, which are `q_`-prefixed and so can never collide with a
 * `stp_` candidate. They are included rather than filtered out because the union is the
 * honest statement of "names a rule is still using", and narrowing it would be a filter
 * that has to stay in step with the id prefixes forever.
 */
function reservedStepIds(draft: DraftForm): readonly string[] {
  return [...draft.steps.map((step) => step.stepId), ...draft.rules.flatMap((rule) => rule.show)];
}

/** Append a step with a freshly minted, permanent id. */
export function addStep(draft: DraftForm, title: string): DraftForm {
  const stepId = mintId("stp_", title, reservedStepIds(draft), "step");
  const step: DraftStep = { stepId, title: localizedDraft(title) ?? {}, items: [] };
  return { ...draft, steps: [...draft.steps, step] };
}

/** Retitle a step, leaving its `stepId` exactly as minted (a rule may target it). */
export function renameStep(draft: DraftForm, stepId: string, title: string): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) =>
      step.stepId === stepId ? { ...step, title: localizedDraft(title) ?? {} } : step,
    ),
  };
}

/**
 * Move a step up (`-1`) or down (`+1`).
 *
 * Reorder is a swap of whole step records, so there is no expression here that could
 * attach a step's questions to another step's id. It changes document order, which is
 * exactly what ADR-16 reads, so every caller re-runs the analysis afterwards.
 */
export function moveStep(draft: DraftForm, stepId: string, delta: -1 | 1): DraftForm {
  const index = draft.steps.findIndex((step) => step.stepId === stepId);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= draft.steps.length) return draft;
  const steps = [...draft.steps];
  const moved = steps[index];
  const displaced = steps[target];
  if (moved === undefined || displaced === undefined) return draft;
  steps[index] = displaced;
  steps[target] = moved;
  return { ...draft, steps };
}

/**
 * Remove a step. Its pins go with it; the rules that named it do **not** change.
 *
 * Leaving a now-dangling `show: ["stp_gone"]` in place is deliberate. Silently rewriting
 * an author's rules while they delete a step is the kind of helpfulness that loses work
 * without a trace; the validation panel instead reports `DANGLING_STEP_REF` against the
 * rule, anchored to it, and the author decides what the rule should say now.
 *
 * The id itself stays reserved while that rule still names it - see {@link reservedStepIds}
 * - so re-adding a step under the old title cannot quietly adopt the orphaned rule.
 */
export function removeStep(draft: DraftForm, stepId: string): DraftForm {
  return { ...draft, steps: draft.steps.filter((step) => step.stepId !== stepId) };
}

// --- pins -------------------------------------------------------------------

/** Every question id pinned anywhere in the draft. */
export function pinnedQuestionIds(draft: DraftForm): readonly string[] {
  return draft.steps.flatMap((step) => step.items.map((item) => item.questionId));
}

/**
 * Whether this question is already pinned somewhere in the form.
 *
 * The kernel rejects a second pin as `DUPLICATE_QUESTION_IN_FORM` at parse, so the
 * picker greys it out rather than letting an author add it and then reading an error
 * about a row they just created (004's refinement, mirrored in the UI).
 */
export function isPinned(draft: DraftForm, questionId: string): boolean {
  return pinnedQuestionIds(draft).includes(questionId);
}

/**
 * Pin a question into a step at a chosen version and at a chosen position.
 *
 * `index` is a boundary, counted the way an insert point is: 0 puts the pin before the
 * first item, `items.length` appends. It exists because the pin list's row grip menu
 * offers insert-above and insert-below (issue 517), and those two are what let a
 * row-boundary insert affordance meet WCAG 2.2 SC 2.5.8 at all - so "add" has to be
 * able to land somewhere other than the end. Out-of-range values clamp rather than
 * throw: the caller is a menu whose row may have moved under it.
 *
 * A duplicate is refused here as the kernel refuses it (`DUPLICATE_QUESTION_IN_FORM`).
 */
export function addPinAt(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  version: number,
  index: number,
): DraftForm {
  if (isPinned(draft, questionId)) return draft;
  const pin: DraftPin = { questionId, version };
  return {
    ...draft,
    steps: draft.steps.map((step) => {
      if (step.stepId !== stepId) return step;
      const at = Math.min(Math.max(index, 0), step.items.length);
      return { ...step, items: [...step.items.slice(0, at), pin, ...step.items.slice(at)] };
    }),
  };
}

/** Pin a question at the end of a step, which is what the library picker's own button does. */
export function addPin(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  version: number,
): DraftForm {
  const step = draft.steps.find((entry) => entry.stepId === stepId);
  return addPinAt(draft, stepId, questionId, version, step?.items.length ?? 0);
}

/**
 * Repoint one pin at another published version. The only version change in the builder.
 *
 * Scoped to a single `questionId` on purpose: "move every pin of this question to v3"
 * would be one click that changes several forms' meaning at once, which is the bulk
 * operation R7 rules out before Phase 4.
 */
export function movePin(draft: DraftForm, questionId: string, version: number): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      items: step.items.map((item) =>
        item.questionId === questionId ? { questionId, version } : item,
      ),
    })),
  };
}

/** Unpin a question. Rules that read or target it are left alone, as `removeStep` does. */
export function removePin(draft: DraftForm, questionId: string): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      items: step.items.filter((item) => item.questionId !== questionId),
    })),
  };
}

/** Move a pin up or down within its step. */
export function movePinWithinStep(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  delta: -1 | 1,
): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => {
      if (step.stepId !== stepId) return step;
      const index = step.items.findIndex((item) => item.questionId === questionId);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= step.items.length) return step;
      const items = [...step.items];
      const moved = items[index];
      const displaced = items[target];
      if (moved === undefined || displaced === undefined) return step;
      items[index] = displaced;
      items[target] = moved;
      return { ...step, items };
    }),
  };
}

// --- rules ------------------------------------------------------------------

/** Append a rule. A new rule starts as `answered`, the one op that needs no operand. */
export function addRule(draft: DraftForm, questionId: string): DraftForm {
  const ruleId = mintId(
    "rul_",
    questionId.replace(/^q_/, ""),
    draft.rules.map((rule) => rule.ruleId),
    "rule",
  );
  const rule: DraftRule = { ruleId, when: { op: "answered", questionId }, show: [] };
  return { ...draft, rules: [...draft.rules, rule] };
}

/** Replace one rule wholesale, which is how every condition and target edit lands. */
export function updateRule(draft: DraftForm, ruleId: string, next: DraftRule): DraftForm {
  return { ...draft, rules: draft.rules.map((rule) => (rule.ruleId === ruleId ? next : rule)) };
}

export function removeRule(draft: DraftForm, ruleId: string): DraftForm {
  return { ...draft, rules: draft.rules.filter((rule) => rule.ruleId !== ruleId) };
}

// --- document order ---------------------------------------------------------

/** One question's place in the flat order a respondent meets it in (ADR-16). */
export interface DraftPosition {
  readonly stepId: string;
  readonly questionId: string;
  readonly version: number;
}

/**
 * The draft's document order.
 *
 * This mirrors the kernel's `documentOrder` and exists because the builder needs it on a
 * draft the kernel cannot parse yet (an empty step, a step with no pins), and because the
 * kernel is not importable here at all. It is pure draft geometry, so it is instant: it is
 * what gives {@link eligibleTargets} its answer before any round trip. The authority is
 * still the validate endpoint, which reports `RULE_BACKWARD_TARGET` from the kernel's own
 * `analyzeRuleGraph`; this only lets the picker teach the rule a debounce earlier.
 */
export function draftDocumentOrder(draft: DraftForm): readonly DraftPosition[] {
  return draft.steps.flatMap((step) =>
    step.items.map((item) => ({
      stepId: step.stepId,
      questionId: item.questionId,
      version: item.version,
    })),
  );
}

/**
 * The `show` targets that are legal for a rule, given what its condition reads.
 *
 * ADR-16: a target must sit strictly **after** every question the condition references,
 * in document order, because evaluation is a single forward pass. Pre-filtering the
 * picker with this teaches the rule at the moment of authoring rather than at publish -
 * and the ineligible targets are still listed, separately and labelled, so the backward
 * attempt exit criterion 2 asks for stays reachable.
 *
 * A step is eligible when **all** of its questions are, matching the kernel's expansion
 * of a step target to every question in it.
 */
export function eligibleTargets(
  draft: DraftForm,
  references: readonly string[],
): { readonly questions: readonly string[]; readonly steps: readonly string[] } {
  const order = draftDocumentOrder(draft);
  const positionOf = new Map(order.map((entry, index) => [entry.questionId, index]));
  const referencePositions = references
    .map((questionId) => positionOf.get(questionId))
    .filter((position): position is number => position !== undefined);
  // A condition that reads nothing pinned yet constrains nothing.
  const lastReference = referencePositions.length === 0 ? -1 : Math.max(...referencePositions);

  const questions = order
    .filter((entry) => (positionOf.get(entry.questionId) ?? -1) > lastReference)
    .map((entry) => entry.questionId);
  const eligible = new Set(questions);
  const steps = draft.steps
    .filter((step) => step.items.length > 0 && step.items.every((i) => eligible.has(i.questionId)))
    .map((step) => step.stepId);
  return { questions, steps };
}

// --- saveability ------------------------------------------------------------

/**
 * Why a draft cannot be sent to `PUT .../draft` yet, or `undefined` when it can.
 *
 * The API saves an *inconsistent* draft happily (022's advisory semantics: dangling refs
 * and backward targets are issues, not save failures), but it cannot save an
 * **unparseable** one: `FormDefinition` requires at least one step, at least one pin per
 * step, and at least one target per rule, so those three states 422 rather than
 * round-tripping. Mirroring that here is presentation, not authority - it tells the author
 * why autosave is paused instead of letting a red error appear every few seconds while
 * they build the first step.
 *
 * The third one is the least obvious and cost a browser run to find: a rule the author has
 * just added has an empty `show`, because who it shows is the next decision they make.
 * `VisibilityRule.show` is `.min(1)` in the kernel, so that entirely ordinary intermediate
 * state is an unparseable draft rather than an inconsistent one, and without this the
 * builder shows "the last save failed" for as long as it takes to pick a target.
 */
export type UnsaveableReason = "noSteps" | "emptyStep" | "ruleWithoutTarget";

export function unsaveableReason(draft: DraftForm): UnsaveableReason | undefined {
  if (draft.steps.length === 0) return "noSteps";
  if (draft.steps.some((step) => step.items.length === 0)) return "emptyStep";
  if (draft.rules.some((rule) => rule.show.length === 0)) return "ruleWithoutTarget";
  return undefined;
}

// --- library helpers --------------------------------------------------------

/**
 * The versions of a question a **new** pin may point at: published only.
 *
 * Deprecated versions are excluded here and drafts never appear, which is 022's rule
 * restated at the picker. A version already pinned is a different question entirely: it
 * keeps working, deprecated or not (R6), which is why {@link pinnedVersionLabel} reads
 * the pin rather than this list.
 */
export function pinnableVersions(question: PinnableQuestion): readonly number[] {
  return question.versions.filter((v) => v.status === "published").map((v) => v.version);
}

/** Whether a question has any version a new pin could point at. */
export function isPinnable(question: PinnableQuestion): boolean {
  return pinnableVersions(question).length > 0;
}

/** The status of the exact version a pin points at, or `undefined` if it is gone. */
export function pinnedVersionStatus(
  question: PinnableQuestion | undefined,
  version: number,
): string | undefined {
  return question?.versions.find((v) => v.version === version)?.status;
}
