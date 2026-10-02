import { DEFAULT_LOCALE, localizedDraft, textOf } from "../questions/definition.ts";

import { conditionGroupReferences } from "./condition.ts";
import {
  isDraftGroup,
  type DraftForm,
  type DraftGroup,
  type DraftPin,
  type DraftRepeatCount,
  type DraftRule,
  type DraftStep,
  type DraftStepItem,
  type PinnableQuestion,
  type RepeatPresentation,
} from "./types.ts";

/**
 * Pure draft mutations for the form builder (task 033).
 *
 * Every function here takes a draft and returns a new one. Nothing validates: whether a
 * draft is legal is the kernel's answer, and the kernel runs in the API. The admin reaches
 * it through `POST .../draft/validate`, never by importing it (the import-surface test
 * refuses every `@roonga/qcms-core` value import in this app). What this module owns is the *shape* of an
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

// --- groups -----------------------------------------------------------------

/**
 * Every repeating group id that is spoken for: the ones a group currently carries, plus
 * every id any rule's condition still reads.
 *
 * The second half is {@link reservedStepIds}'s reasoning applied to the other id a rule can
 * be left pointing at. {@link removeGroup} deliberately leaves a condition reading
 * `grp_gone` behind so the author is told about it (`DANGLING_GROUP_REF`, Q24) and decides
 * what the rule should say now; minting against live groups alone, a later group named the
 * way the deleted one was would take `grp_gone` a second time, the orphaned condition would
 * silently re-attach to a group nobody pointed it at, and the issue the author was meant to
 * answer would vanish with no signal.
 */
function reservedGroupIds(draft: DraftForm): readonly string[] {
  return [
    ...draftGroups(draft).map((group) => group.groupId),
    ...draft.rules.flatMap((rule) => conditionGroupReferences(rule.when)),
  ];
}

/** Every repeating group in the draft, in document order. */
export function draftGroups(draft: DraftForm): readonly DraftGroup[] {
  return draft.steps.flatMap((step) => step.items.filter(isDraftGroup));
}

/** One group and the step that holds it, or `undefined` when the draft has no such group. */
export function findGroup(
  draft: DraftForm,
  groupId: string,
): { readonly stepId: string; readonly group: DraftGroup } | undefined {
  for (const step of draft.steps) {
    for (const item of step.items) {
      if (isDraftGroup(item) && item.groupId === groupId) {
        return { stepId: step.stepId, group: item };
      }
    }
  }
  return undefined;
}

/**
 * Which group each pinned question sits in; absent for a question outside every group.
 *
 * Mirrors the kernel's `questionGroups`, and total for the same reason: a question is
 * pinned at most once in a form whether it sits in a step or in a group
 * (`DUPLICATE_QUESTION_IN_FORM` reaches inside groups), so there is never a second answer.
 */
export function questionGroupIds(draft: DraftForm): ReadonlyMap<string, string> {
  const byQuestion = new Map<string, string>();
  for (const group of draftGroups(draft)) {
    for (const pin of group.items) {
      if (!byQuestion.has(pin.questionId)) byQuestion.set(pin.questionId, group.groupId);
    }
  }
  return byQuestion;
}

/**
 * The instance-count bounds a group declares, as one shape for all three sources.
 *
 * Mirrors the kernel's `countBounds`. `max` is `undefined` only for a bounded source whose
 * author has not filled the field in yet, which publish refuses with `REPEAT_MAX_MISSING`; a
 * `fixed` count is its own bound, so both ends are the count.
 */
export function countBounds(count: DraftRepeatCount): {
  readonly min: number;
  readonly max: number | undefined;
} {
  return count.source === "fixed"
    ? { min: count.count, max: count.count }
    : { min: count.min, max: count.max };
}

/**
 * What ONE instance of a group is called, which is the word the scope chip and the rule
 * sentence both need.
 *
 * Derived from the author's own instance-label template rather than from a word of ours:
 * "Passenger {n}" is a sentence they wrote about their own form, so stripping the placeholder
 * off it gives "Passenger" - the noun the airline case reads as "evaluated per Passenger".
 * The group's own label is the fallback ("Passengers", the plural, which is still better than
 * an id), and the id is the last resort.
 *
 * **The author's own casing is kept.** Lower-casing it would read marginally better inside an
 * English frame and would be wrong for a proper noun, wrong for a locale with different
 * capitalisation rules, and a transform this app has no business applying to authored
 * content (ADR-27).
 */
export function instanceNoun(group: DraftGroup, locale = DEFAULT_LOCALE): string {
  const template = textOf(group.instanceLabel, locale);
  // Every `{...}` token, not only `{n}`: a template carrying an unknown placeholder is
  // refused at publish (`INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`) and until then the noun this
  // returns should still be a word rather than a word with braces in it.
  const stripped = template.replaceAll(/\{[^{}]*\}/g, "").trim();
  if (stripped !== "") return stripped;
  const label = textOf(group.label, locale);
  return label === "" ? group.groupId : label;
}

/**
 * The count a freshly added group starts with.
 *
 * `open` with `min: 1` and NO `max`, which is deliberately the one state publish refuses
 * (`REPEAT_MAX_MISSING`): `max` is a required field on `open` and on `fromAnswer` (Q4 as
 * amended by Q14), and there is no safe number to invent for an author. Seeding one would
 * put a bound nobody chose into a published form, where it is the only limit on how many
 * instances a respondent may create (SEC-16). So the field starts empty, the panel marks it
 * required, and the group is unpublishable until the author answers.
 */
const STARTING_COUNT: DraftRepeatCount = { source: "open", min: 1 };

/**
 * Append a repeating group to a step, with a freshly minted, permanent id.
 *
 * A `groupId` is a permanent name a CONDITION can read, exactly as a `stepId` is a
 * permanent name a rule can target, so renaming a group carries its id through untouched
 * and only this function mints one - against {@link reservedGroupIds}, so a retired name is
 * never handed out a second time.
 *
 * The instance label starts as the author's own name for the group followed by the one
 * placeholder the kernel substitutes (`{n}`, the live one-based ordinal), because a group of
 * several instances whose headings are identical is the one starting state an author would
 * have to fix before it is useful. It is seeded from THEIR text rather than from a word of
 * ours: an instance heading is form content a respondent reads, so inventing English for it
 * would put untranslatable chrome inside an authored document (ADR-27).
 */
export function addGroup(draft: DraftForm, stepId: string, label: string): DraftForm {
  const groupId = mintId("grp_", label, reservedGroupIds(draft), "group");
  const group: DraftGroup = {
    groupId,
    label: localizedDraft(label) ?? {},
    instanceLabel: localizedDraft(label === "" ? "" : `${label} {n}`) ?? {},
    items: [],
    count: STARTING_COUNT,
    presentation: "stacked",
  };
  return {
    ...draft,
    steps: draft.steps.map((step) =>
      step.stepId === stepId ? { ...step, items: [...step.items, group] } : step,
    ),
  };
}

/**
 * Remove a group. Its member pins go with it; the rules that read it do **not** change.
 *
 * The same deliberate silence {@link removeStep} keeps, for the same reason: rewriting an
 * author's conditions while they delete a group loses work without a trace, so the
 * validation panel reports `DANGLING_GROUP_REF` against the rule instead and the author
 * decides what it should say now. The id stays reserved while that condition still names it.
 */
export function removeGroup(draft: DraftForm, groupId: string): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      items: step.items.filter((item) => !(isDraftGroup(item) && item.groupId === groupId)),
    })),
  };
}

/** Replace one group wholesale, which is how every panel edit below lands. */
function withGroup(
  draft: DraftForm,
  groupId: string,
  change: (group: DraftGroup) => DraftGroup,
): DraftForm {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      items: step.items.map((item) =>
        isDraftGroup(item) && item.groupId === groupId ? change(item) : item,
      ),
    })),
  };
}

/** Rename a group, leaving its `groupId` exactly as minted (a condition may read it). */
export function renameGroup(draft: DraftForm, groupId: string, label: string): DraftForm {
  return withGroup(draft, groupId, (group) => ({
    ...group,
    label: localizedDraft(label) ?? {},
  }));
}

/**
 * Set the instance heading template ("Passenger {n}").
 *
 * Stored verbatim, including a template carrying a placeholder the kernel does not
 * substitute: that is `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN` at publish and the panel's live
 * preview shows what a respondent would read, which between them say more than a mutation
 * that silently dropped the author's text would.
 */
export function setGroupInstanceLabel(
  draft: DraftForm,
  groupId: string,
  template: string,
): DraftForm {
  return withGroup(draft, groupId, (group) => ({
    ...group,
    instanceLabel: localizedDraft(template) ?? {},
  }));
}

/**
 * Pin a question into a group at a chosen version and position.
 *
 * `index` is an insert boundary, counted as {@link addPinAt}'s is. A duplicate is refused
 * here as the kernel refuses it: `DUPLICATE_QUESTION_IN_FORM` reaches inside groups, so a
 * question is either repeated or not in a given form and never both.
 */
export function addPinToGroup(
  draft: DraftForm,
  groupId: string,
  questionId: string,
  version: number,
  index?: number,
): DraftForm {
  if (isPinned(draft, questionId)) return draft;
  const pin: DraftPin = { questionId, version };
  return withGroup(draft, groupId, (group) => {
    const at = Math.min(Math.max(index ?? group.items.length, 0), group.items.length);
    return { ...group, items: [...group.items.slice(0, at), pin, ...group.items.slice(at)] };
  });
}

/** Move a member pin up or down within its group. Out of range is a no-op. */
export function movePinWithinGroup(
  draft: DraftForm,
  groupId: string,
  questionId: string,
  delta: -1 | 1,
): DraftForm {
  return withGroup(draft, groupId, (group) => {
    const index = group.items.findIndex((item) => item.questionId === questionId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= group.items.length) return group;
    const items = [...group.items];
    const moved = items[index];
    const displaced = items[target];
    if (moved === undefined || displaced === undefined) return group;
    items[index] = displaced;
    items[target] = moved;
    return { ...group, items };
  });
}

/**
 * Change a group's count source.
 *
 * Whole-value rather than a patch, because the three sources carry different fields: a
 * `fixed` count has a `count` and no bounds, and both bounded sources have a `min` and an
 * optional `max`. A spread would leave `count` beside `min` on the same object, which is a
 * shape the kernel's discriminated union has no member for - the same reason
 * `withOperand` rebuilds a condition node per `op` rather than patching it.
 */
export function setGroupCount(
  draft: DraftForm,
  groupId: string,
  count: DraftRepeatCount,
): DraftForm {
  return withGroup(draft, groupId, (group) => ({ ...group, count }));
}

/**
 * Change a group's presentation.
 *
 * One field, and that is the whole argument of ADR-42 stated as a mutation: a stacked
 * group, a per-instance step walk and a table are the same object with this value
 * different, so switching between them changes no answer, no key and no id.
 */
export function setGroupPresentation(
  draft: DraftForm,
  groupId: string,
  presentation: RepeatPresentation,
): DraftForm {
  return withGroup(draft, groupId, (group) => ({ ...group, presentation }));
}

// --- pins -------------------------------------------------------------------

/**
 * Every pin a step holds, in document order, with each repeating group expanded into its
 * member pins.
 *
 * What a caller that used to iterate `step.items` for pins wants now that the item list is
 * a union, and the kernel's `stepQuestionRefs` by another name: a question does not know it
 * is repeated, so a group member resolves, compiles and validates exactly like a step's own
 * pin. A caller that needs to know a question sits in a group reads
 * {@link questionGroupIds} or {@link draftDocumentOrder}'s `groupId` instead.
 */
export function stepPins(step: DraftStep): readonly DraftPin[] {
  return step.items.flatMap((item) => (isDraftGroup(item) ? item.items : [item]));
}

/** Every question id pinned anywhere in the draft, inside a group or beside one. */
export function pinnedQuestionIds(draft: DraftForm): readonly string[] {
  return draft.steps.flatMap((step) => stepPins(step).map((pin) => pin.questionId));
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
 *
 * It reaches inside groups, and that is the ADR-42 property stated as code: a question does
 * not know it is repeated, so a group member's pin is moved by the same gesture, through the
 * same function, as a step's own.
 */
export function movePin(draft: DraftForm, questionId: string, version: number): DraftForm {
  const repoint = (pin: DraftPin): DraftPin =>
    pin.questionId === questionId ? { questionId, version } : pin;
  return mapPins(draft, (step) => ({
    ...step,
    items: step.items.map((item) =>
      isDraftGroup(item) ? { ...item, items: item.items.map(repoint) } : repoint(item),
    ),
  }));
}

/** Unpin a question, wherever it sits. Rules that read or target it are left alone. */
export function removePin(draft: DraftForm, questionId: string): DraftForm {
  const keep = (pin: DraftPin): boolean => pin.questionId !== questionId;
  return mapPins(draft, (step) => ({
    ...step,
    items: step.items
      .map((item) => (isDraftGroup(item) ? { ...item, items: item.items.filter(keep) } : item))
      .filter((item) => isDraftGroup(item) || keep(item)),
  }));
}

/** `draft.steps.map`, named, so the two walks above read as the one shape they are. */
function mapPins(draft: DraftForm, change: (step: DraftStep) => DraftStep): DraftForm {
  return { ...draft, steps: draft.steps.map(change) };
}

/**
 * Move a step's own item up or down: a top-level pin, past whatever is beside it.
 *
 * A group counts as ONE neighbour, which is what the step-level reorder has to mean now that
 * the item list is a union: moving a pin past a six-member group puts it before or after the
 * whole span rather than inside it. A member's position inside its group is
 * {@link movePinWithinGroup}, and the two never reach each other's items.
 */
export function movePinWithinStep(
  draft: DraftForm,
  stepId: string,
  questionId: string,
  delta: -1 | 1,
): DraftForm {
  return moveStepItem(
    draft,
    stepId,
    (item) => !isDraftGroup(item) && item.questionId === questionId,
    delta,
  );
}

/**
 * Move a whole group up or down within its step.
 *
 * Reorder changes document order, which is exactly what ADR-16's forward-only pass reads, and
 * a group's position decides where its whole SPAN sits - so this is the control an author
 * needs when a rule reading the group has to target something after it. There is no gesture
 * here that moves a pin into or out of a group: that is {@link addPinToGroup} and
 * {@link removePin}, so a reorder can never silently change whether a question is repeated.
 */
export function moveGroupWithinStep(
  draft: DraftForm,
  stepId: string,
  groupId: string,
  delta: -1 | 1,
): DraftForm {
  return moveStepItem(
    draft,
    stepId,
    (item) => isDraftGroup(item) && item.groupId === groupId,
    delta,
  );
}

/** Swap the item `matches` picks with its neighbour. Out of range is a no-op. */
function moveStepItem(
  draft: DraftForm,
  stepId: string,
  matches: (item: DraftStepItem) => boolean,
  delta: -1 | 1,
): DraftForm {
  return mapPins(draft, (step) => {
    if (step.stepId !== stepId) return step;
    const index = step.items.findIndex(matches);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= step.items.length) return step;
    const items = [...step.items];
    const moved = items[index];
    const displaced = items[target];
    if (moved === undefined || displaced === undefined) return step;
    items[index] = displaced;
    items[target] = moved;
    return { ...step, items };
  });
}

// --- rules ------------------------------------------------------------------

/**
 * A rule this draft does not have yet, with an id minted against the ones it does.
 *
 * MINTED WITHOUT BEING ADDED, and that separation is what the rule editor's Cancel is
 * built on. `plan/admin-design-contracts.md` §6 (amendment of 2026-08-30) gives that
 * dialog an explicit Save, which means the rule an author is building must be able to
 * exist without being in the draft: it is held by the dialog, and {@link upsertRule} puts
 * it in when Save is pressed. A rule that reached the draft on "Add rule" would leave a
 * targetless rule behind on Cancel - and `unsaveableReason` treats that as an unsaveable
 * draft, so the pressed Cancel would pause the whole screen's autosave instead of
 * discarding anything.
 *
 * An id minted here and then discarded is simply never taken, so the next add mints the
 * same one. That is different from a STEP id, which stays reserved once a rule names it
 * (see {@link reservedStepIds}), because nothing can be left pointing at a rule that was
 * never added.
 *
 * A new rule starts as `answered`, the one op that needs no operand.
 */
export function newRule(draft: DraftForm, questionId: string): DraftRule {
  const ruleId = mintId(
    "rul_",
    questionId.replace(/^q_/, ""),
    draft.rules.map((rule) => rule.ruleId),
    "rule",
  );
  return { ruleId, when: { op: "answered", questionId }, show: [] };
}

/**
 * Put a rule into the draft: replacing the one with its id, or appending it if there is
 * none. The one commit the rule editor makes, whether the author was adding or editing.
 *
 * One function rather than two call sites choosing between {@link updateRule} and an
 * append, because the dialog genuinely does not care which it is doing - it holds a rule
 * and is asked to store it - and a caller that had to know would be a caller that could
 * get it wrong.
 */
export function upsertRule(draft: DraftForm, rule: DraftRule): DraftForm {
  const exists = draft.rules.some((candidate) => candidate.ruleId === rule.ruleId);
  return exists
    ? updateRule(draft, rule.ruleId, rule)
    : { ...draft, rules: [...draft.rules, rule] };
}

/** Mint a rule and append it in one gesture, which is what the draft's own tests build with. */
export function addRule(draft: DraftForm, questionId: string): DraftForm {
  return upsertRule(draft, newRule(draft, questionId));
}

/** Replace one rule wholesale, which is how every condition and target edit lands. */
export function updateRule(draft: DraftForm, ruleId: string, next: DraftRule): DraftForm {
  return { ...draft, rules: draft.rules.map((rule) => (rule.ruleId === ruleId ? next : rule)) };
}

export function removeRule(draft: DraftForm, ruleId: string): DraftForm {
  return { ...draft, rules: draft.rules.filter((rule) => rule.ruleId !== ruleId) };
}

// --- document order ---------------------------------------------------------

/**
 * One question's place in the flat order a respondent meets it in (ADR-16).
 *
 * `groupId` is present exactly when the question sits inside a repeating group, which is
 * what makes the forward-only rule expressible over a SPAN rather than over a position:
 * a group expands into a contiguous run of its member questions, and a whole-group read
 * is a read of all of them.
 */
export interface DraftPosition {
  readonly stepId: string;
  readonly questionId: string;
  readonly version: number;
  readonly groupId?: string | undefined;
}

/**
 * The draft's document order, with every repeating group expanded into its member span.
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
    step.items.flatMap((item) =>
      isDraftGroup(item)
        ? item.items.map((pin) => ({
            stepId: step.stepId,
            questionId: pin.questionId,
            version: pin.version,
            groupId: item.groupId,
          }))
        : [{ stepId: step.stepId, questionId: item.questionId, version: item.version }],
    ),
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
 *
 * ## The cut is over a SPAN, not only a position (ADR-42, section 3.4)
 *
 * `groupReferences` is what the three whole-group operators contribute, and it is a
 * different kind of read from a bare question reference. A rule using `anyInstance`,
 * `everyInstance` or `instanceCount` over group G reads **the whole of G**, so its targets
 * must appear strictly after G's whole span - which is this same forward-only rule applied
 * to the span's end rather than to any one member's position.
 *
 * A BARE reference to an in-group question keeps the ordinary position cut, and that is not
 * an inconsistency. Such a rule is evaluated inside that group, once per live instance, and
 * what it may read is what comes earlier **within the same instance** - so a later member of
 * the same group is a legal target and the span's end is the wrong bound. A bare in-group
 * reference from a rule that is NOT evaluated inside that group has no single value at all
 * and is refused at publish (`RULE_READS_GROUP_WITHOUT_OPERATOR`, Q26), which is the case
 * this geometry deliberately does not try to answer.
 */
export function eligibleTargets(
  draft: DraftForm,
  references: readonly string[],
  groupReferences: readonly string[] = [],
): { readonly questions: readonly string[]; readonly steps: readonly string[] } {
  const order = draftDocumentOrder(draft);
  const positionOf = new Map(order.map((entry, index) => [entry.questionId, index]));
  // The last index of each group's span, which is where a whole-group read's cut lands.
  const spanEndOf = new Map<string, number>();
  order.forEach((entry, index) => {
    if (entry.groupId !== undefined) spanEndOf.set(entry.groupId, index);
  });

  const cuts = [
    ...references.map((questionId) => positionOf.get(questionId)),
    ...groupReferences.map((groupId) => spanEndOf.get(groupId)),
  ].filter((position): position is number => position !== undefined);
  // A condition that reads nothing pinned yet, and a group the draft does not declare,
  // constrain nothing: the second is `DANGLING_GROUP_REF` at publish rather than a cut here.
  const lastReference = cuts.length === 0 ? -1 : Math.max(...cuts);

  const questions = order
    .filter((entry) => (positionOf.get(entry.questionId) ?? -1) > lastReference)
    .map((entry) => entry.questionId);
  const eligible = new Set(questions);
  const steps = draft.steps
    .filter((step) => {
      const pins = stepPins(step);
      return pins.length > 0 && pins.every((pin) => eligible.has(pin.questionId));
    })
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
export type UnsaveableReason = "noSteps" | "emptyStep" | "emptyGroup" | "ruleWithoutTarget";

export function unsaveableReason(draft: DraftForm): UnsaveableReason | undefined {
  if (draft.steps.length === 0) return "noSteps";
  if (draft.steps.some((step) => step.items.length === 0)) return "emptyStep";
  // A FOURTH one arrived with the repeating group (ADR-42), and it is the same shape as
  // `emptyStep`: `RepeatGroup.items` is `.min(1)` in the kernel, so a group an author has
  // just added and not yet filled is an UNPARSEABLE draft rather than an inconsistent one.
  // Without this the builder would show "the last save failed" for as long as it takes to
  // pin the first member question, which is exactly the state issue 569 named for a step.
  if (draftGroups(draft).some((group) => group.items.length === 0)) return "emptyGroup";
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
