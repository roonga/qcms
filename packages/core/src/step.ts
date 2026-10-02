import { z } from "zod";

import { GroupId, QuestionId, StepId } from "./ids.js";
import { LocalizedText } from "./localized-text.js";

/**
 * A step's item list and the repeating group that may sit in it (task 071,
 * ADR-42, `plan/repeating-groups-and-table-input.md` sections 2 and 3).
 *
 * QCMS could not ask the same question twice: `FormDefinition` refuses a
 * `questionId` pinned more than once, because an answer is keyed by a bare
 * `questionId` in the evaluator, in the ledger's grain and in the reporting
 * view. ADR-42 closes that with exactly one new concept, the **repeating
 * group**: a named, ordered set of pinned question refs that lives inside a
 * step's item list and is answered once per **instance**.
 *
 * A **looping question** is a group with one member; a **looping step** and a
 * **table** are presentations of the same group. No question type is added, no
 * `AnswerValue` member is added, and a question does not know that it is
 * repeated - which is what keeps ADR-02 and R6 clean and lets the same library
 * question be single in one form and repeated in another.
 *
 * **Everything here is additive.** `SEMANTICS_VERSION` stays 1 (ADR-16's
 * amendment: the evaluator implements one version at a time and refuses any
 * other stamp, so a bump would make every published snapshot fail rather than
 * preserve it), and a form with no repeating group parses, evaluates and
 * submits byte-identically to before.
 */

/**
 * A pinned reference to a question version (ADR-02). The pair is the whole
 * point: a snapshot freezes exactly which content each questionId had.
 * Whether the pin resolves (question exists, version published) is a publish
 * invariant (008), not a parse concern.
 */
export const QuestionRef = z.object({
  questionId: QuestionId,
  version: z.number().int().positive(),
});
export type QuestionRef = z.infer<typeof QuestionRef>;

/**
 * Where a group's instance count comes from (ADR-42, Q4 as amended by Q14,
 * ruled 2026-09-29).
 *
 * - **`fixed`** is the degenerate case a looping question with a known count
 *   uses. **A fixed count is its own bound**, so it carries no `max` and no
 *   `min`: the number is both.
 * - **`fromAnswer`** points at a `number` question that must appear strictly
 *   before the group in document order (`REPEAT_COUNT_BACKWARD_REF`) and must
 *   be a `number` question (`REPEAT_COUNT_NOT_A_NUMBER`).
 * - **`open`** is add and remove.
 *
 * **`max` is required on both bounded sources**, and that is a ruling rather
 * than a default: the Code Owner removed every installation-wide instance
 * ceiling on 2026-09-29 (Q14), so a group's own `max` is the only bound that
 * exists. Without one, a `fromAnswer` group lets the respondent's answer to the
 * count question set the size of the loop and an `open` group is an unbounded
 * write path into an append-only ledger (SEC-16).
 *
 * It is **optional in this schema and required at publish**
 * (`REPEAT_MAX_MISSING`), which is deliberate: a draft an author is still
 * filling in has to round-trip through save and reload with the field empty,
 * and the publish gate is where an unpublishable draft is refused with a code
 * that says why. Nothing in core caps the value (there is deliberately no
 * `REPEAT_MAX_ABOVE_CEILING`); an author's `max` is a security-relevant field
 * reviewed at form review, which is what SEC-16 records.
 */
export const RepeatCount = z.discriminatedUnion("source", [
  z.object({ source: z.literal("fixed"), count: z.number().int().min(1) }),
  z.object({
    source: z.literal("fromAnswer"),
    questionId: QuestionId,
    min: z.number().int().min(0),
    max: z.number().int().min(1).optional(),
  }),
  z.object({
    source: z.literal("open"),
    min: z.number().int().min(0),
    max: z.number().int().min(1).optional(),
  }),
]);
export type RepeatCount = z.infer<typeof RepeatCount>;

/** How a group's instances are laid out. All three ship at launch; the kernel
 * carries the field and the renderer (073, 076, 077) reads it. */
export const RepeatPresentation = z.enum(["stacked", "perInstanceStep", "table"]);
export type RepeatPresentation = z.infer<typeof RepeatPresentation>;

/**
 * A repeating group inside a step's item list (ADR-42).
 *
 * `instanceLabel` carries a single `{n}` placeholder, "Passenger {n}", where
 * `{n}` is the **live ordinal**, one-based, recomputed after a removal. A
 * template with no `{n}` is legal (a group of one); a template carrying any
 * other placeholder is refused at publish
 * (`INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`).
 *
 * **A group may not contain a group** (Q13, ruled 2026-09-29): `items` is an
 * array of `QuestionRef` and nothing else, so nesting is refused at parse. The
 * reasons are cost and comprehensibility in that order - a nested group makes
 * an instance address a path rather than a pair, makes the per-instance walk
 * quadratic in instances, makes the no-JS field name a path and makes the CSV
 * grain a tree. Lifting the cap later is a change to addressing and export, not
 * a constant.
 */
export const RepeatGroup = z.object({
  groupId: GroupId,
  label: LocalizedText,
  instanceLabel: LocalizedText,
  items: z.array(QuestionRef).min(1),
  count: RepeatCount,
  presentation: RepeatPresentation.default("stacked"),
});
export type RepeatGroup = z.infer<typeof RepeatGroup>;

/**
 * The message both members of the step-item union carry when an item claims to
 * be a pinned question and a repeating group at once.
 */
const ITEM_IS_ONE_OR_THE_OTHER =
  "A step item is either a pinned question or a repeating group, never both";

/** A key this member of the union may not carry at all. Optional, so an absent
 * key and an explicitly undefined one are the same absence, and `never`, so any
 * present value is refused by name. */
const forbiddenKey = z.never({ error: ITEM_IS_ONE_OR_THE_OTHER }).optional();

/**
 * The two members of the step-item union, each refusing the other's keys.
 *
 * The union is discriminated by disjoint required keys and carries no tag, and
 * **disjointness has to be enforced rather than assumed**: without these guards
 * an item carrying both `questionId` and `groupId` matches whichever member
 * comes first, has the other's keys stripped as unknown, and silently becomes
 * something its author did not write. Which way round it failed is not the
 * point; that it failed in silence is.
 */
const StepQuestionRef = QuestionRef.extend({ groupId: forbiddenKey });
const StepRepeatGroup = RepeatGroup.extend({
  questionId: forbiddenKey,
  version: forbiddenKey,
});

/**
 * One entry of a step's item list: a pinned question, or a repeating group.
 *
 * The union is discriminable **without a tag**, because the two shapes have
 * disjoint required keys (`questionId` against `groupId`). No explicit `kind`
 * discriminator is carried, and that is the one choice in this schema that
 * additivity depends on: adding a tag would make every form definition that
 * parses today fail to parse.
 */
export const StepItem = z.union([StepQuestionRef, StepRepeatGroup]);
export type StepItem = z.infer<typeof StepItem>;

export const Step = z.object({
  stepId: StepId,
  title: LocalizedText,
  items: z.array(StepItem).min(1),
});
export type Step = z.infer<typeof Step>;

/**
 * The evaluator's cost budget for one cross-group rule, in instance pairs
 * (ADR-16 as amended 2026-09-29; **confirmed at 10,000 by the Code Owner on
 * 2026-09-29**).
 *
 * **What it bounds.** Forward-only rule 2 lets a rule using `anyInstance`,
 * `everyInstance` or `instanceCount` over group G target anything after G's
 * whole span, and that includes a question inside a **later group H**. Such a
 * rule is evaluated once per live instance of H and each of those evaluations
 * walks the whole of G, so its cost is `max_H x max_G`. With no
 * installation-wide instance ceiling (Q14) two groups at `max: 5000` would put
 * twenty-five million leaf evaluations behind one rule, on every answer write,
 * every step read and every submit, triggered by a respondent.
 *
 * **Why 10,000.** One leaf evaluation is a comparison against a resolved
 * answer and `CONDITION_MAX_DEPTH` is 8, so one condition evaluation is at most
 * a few dozen leaf comparisons; 10,000 instance pairs is therefore of the order
 * of 10^5 comparisons for the worst rule in the worst form, which is
 * sub-millisecond to low-millisecond work on the request path and comparable to
 * what a single step's validation already costs. It admits every shape either
 * sample use case wants by a wide margin - nine passengers against twenty
 * income sources is 180, and a hundred against a hundred is 10,000 exactly -
 * and refuses 5000 by 5000 by three and a half orders of magnitude, which is
 * the case it exists for.
 *
 * **What it is not.** It is a **cost bound and not an instance ceiling**. It
 * caps no group's `max`; two large groups with **no** cross-group rule between
 * them publish. It is checked at publish against declared maxima, never at
 * runtime against live counts, which is the property ADR-16 exists to protect:
 * the cost of serving a published version is known before it is published. And
 * it is per rule, so two cross-group rules each within budget are both allowed.
 *
 * Cheap to set and expensive to move once a form has published against it, so a
 * change to it is a decision rather than a tuning.
 */
export const REPEAT_EVALUATION_BUDGET = 10_000;

/**
 * The five question types a `table` presentation admits as columns (Q12, second
 * half, ruled 2026-09-29; task 077, ADR-43).
 *
 * `longText` and `multiChoice` are refused at publish with
 * `TABLE_COLUMN_TYPE_NOT_ALLOWED`, because neither fits a cell and the phone card
 * reflow makes both worse: a textarea in a cell is taller than the row it sits in,
 * and a checkbox group in a cell is a column of unknown height whose own options
 * have to be read before it can be answered.
 *
 * **The refusal names the stacked presentation**, which allows all seven types
 * (plan section 4.4), so an author refused here has somewhere to go. That is the
 * deliberate asymmetry between the two presentations rather than an accident of
 * this list: a stacked card gives a control a full row.
 *
 * It is a constant here rather than a literal at the check, because the admin's
 * library picker filters the library to the same five (plan section 6.3), and two
 * lists that have to agree should be one list.
 */
export const TABLE_COLUMN_TYPES = [
  "shortText",
  "number",
  "date",
  "boolean",
  "singleChoice",
] as const;

/** Whether a question type may be a column of a `table`-presented group. */
export function isTableColumnType(type: string): boolean {
  return (TABLE_COLUMN_TYPES as readonly string[]).includes(type);
}

/** The one placeholder an `instanceLabel` template may carry: the live,
 * one-based ordinal of the instance in the roster. */
export const INSTANCE_LABEL_PLACEHOLDER = "n";

/** Every `{...}` placeholder token in a template, in first-encounter order. */
export function labelPlaceholders(template: string): readonly string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? "");
}

/** Whether a step item is a repeating group rather than a pinned question.
 *
 * The value test rather than the key test alone: a pinned question written with
 * an explicit `groupId: undefined` carries the key, and `StepQuestionRef` above
 * accepts it because an absent key and an undefined one are the same absence. */
export function isRepeatGroup(item: StepItem | QuestionRef): item is RepeatGroup {
  return "groupId" in item && item.groupId !== undefined;
}

/**
 * Every pinned question ref a step holds, in document order, with each
 * repeating group expanded into its member refs.
 *
 * This is what a caller that used to iterate `step.items` for pins wants now
 * that the item list is a union: a question does not know it is repeated, so a
 * group's member pin resolves, compiles and validates exactly like a step's own
 * (ADR-42). A caller that needs to know a question sits in a group reads
 * {@link questionGroups} or `documentOrder`'s `groupId` instead.
 */
export function stepQuestionRefs(step: Step): readonly QuestionRef[] {
  return step.items.flatMap((item) => (isRepeatGroup(item) ? item.items : [item]));
}

/** Every repeating group in these steps, in document order. */
export function repeatGroups(steps: readonly Step[]): readonly RepeatGroup[] {
  return steps.flatMap((step) => step.items.filter((item) => isRepeatGroup(item)));
}

/** Which repeating group each pinned question sits in; absent for a question
 * outside every group. Positions are unique per question, so this is total
 * (`DUPLICATE_QUESTION_IN_FORM` reaches inside groups). */
export function questionGroups(steps: readonly Step[]): ReadonlyMap<QuestionId, GroupId> {
  const byQuestion = new Map<QuestionId, GroupId>();
  for (const group of repeatGroups(steps)) {
    for (const item of group.items) {
      if (!byQuestion.has(item.questionId)) {
        byQuestion.set(item.questionId, group.groupId);
      }
    }
  }
  return byQuestion;
}

/**
 * The instance-count bounds a group declares, as one shape for all three
 * sources. `max` is `undefined` only for a bounded source that omitted it,
 * which publish refuses with `REPEAT_MAX_MISSING`; a `fixed` count is its own
 * bound, so both ends are the count.
 */
export function countBounds(count: RepeatCount): {
  readonly min: number;
  readonly max: number | undefined;
} {
  return count.source === "fixed"
    ? { min: count.count, max: count.count }
    : { min: count.min, max: count.max };
}
