import { z } from "zod";

import { GroupId, QuestionId, StepId } from "./ids.js";
import { LocalizedText } from "./localized-text.js";

/**
 * A step's item list and the repeating group that may sit in it (ADR-42): a
 * named, ordered set of pinned question refs answered once per instance.
 *
 * A question does not know that it is repeated, which is what keeps ADR-02 and
 * R6 clean and lets the same library question be single in one form and
 * repeated in another. A looping question is a group with one member; a looping
 * step and a table are presentations of the same group.
 */

/**
 * A pinned reference to a question version (ADR-02): a snapshot freezes exactly
 * which content each questionId had. Whether the pin resolves is a publish
 * invariant rather than a parse concern.
 */
export const QuestionRef = z.object({
  questionId: QuestionId,
  version: z.number().int().positive(),
});
export type QuestionRef = z.infer<typeof QuestionRef>;

/**
 * Where a group's instance count comes from (ADR-42). A `fixed` count is its
 * own bound, so it carries neither `min` nor `max`.
 *
 * `max` is required on both bounded sources, because there is no
 * installation-wide instance ceiling: without it, a `fromAnswer` group lets the
 * respondent size the loop and an `open` group is an unbounded write path into
 * an append-only ledger (SEC-16).
 *
 * It is optional here and required at publish, so that a half-filled draft can
 * still round-trip through save and reload. Nothing in core caps the value; an
 * author's `max` is a security-relevant field reviewed at form review (SEC-16).
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

/** How a group's instances are laid out; the kernel carries the field and the
 * renderer reads it. */
export const RepeatPresentation = z.enum(["stacked", "perInstanceStep", "table"]);
export type RepeatPresentation = z.infer<typeof RepeatPresentation>;

/**
 * A repeating group inside a step's item list (ADR-42).
 *
 * `instanceLabel` carries a single `{n}`, the live one-based ordinal,
 * recomputed after a removal. No placeholder is legal; any other one is refused
 * at publish.
 *
 * A group may not contain a group: `items` holds `QuestionRef` and nothing
 * else, so nesting is refused at parse. Nesting would make an instance address
 * a path rather than a pair, the per-instance walk quadratic, the no-JS field
 * name a path and the CSV grain a tree, so lifting the cap is a change to
 * addressing and export rather than to a constant.
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

const ITEM_IS_ONE_OR_THE_OTHER =
  "A step item is either a pinned question or a repeating group, never both";

/** A key this member of the union may not carry at all. Optional, so an absent
 * key and an explicitly undefined one are the same absence, and `never`, so any
 * present value is refused by name. */
const forbiddenKey = z.never({ error: ITEM_IS_ONE_OR_THE_OTHER }).optional();

/**
 * Each member refuses the other's keys. Disjointness has to be enforced rather
 * than assumed: without these guards an item carrying both `questionId` and
 * `groupId` matches whichever member comes first, has the other's keys stripped
 * as unknown, and silently becomes something its author did not write.
 */
const StepQuestionRef = QuestionRef.extend({ groupId: forbiddenKey });
const StepRepeatGroup = RepeatGroup.extend({
  questionId: forbiddenKey,
  version: forbiddenKey,
});

/**
 * One entry of a step's item list. The union carries no `kind` tag because the
 * two shapes have disjoint required keys, and adding one would stop every form
 * definition that parses today from parsing.
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
 * (ADR-16, SEC-16). A rule targeting inside one group while reading the whole
 * of another costs the product of their maxima, on every answer write, step
 * read and submit, with a respondent setting the live counts.
 *
 * It is a cost bound rather than an instance ceiling: it caps no group's `max`,
 * it is per rule, and it is checked at publish against declared maxima rather
 * than at runtime, so the cost of serving a published version is known before
 * it is published.
 *
 * Moving it is a decision rather than a tuning, because forms publish against
 * it.
 */
export const REPEAT_EVALUATION_BUDGET = 10_000;

/**
 * The question types a `table` presentation admits as columns (ADR-43).
 *
 * `longText` and `multiChoice` are refused at publish because neither fits a
 * cell: a textarea is taller than its row, and a checkbox group is a cell of
 * unknown height whose options have to be read before it can be answered. The
 * stacked presentation allows every type, so a refused author has somewhere to
 * go.
 *
 * A constant rather than a literal at the check, because the admin's library
 * picker filters to the same list and the two have to agree.
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

/** Tests the value and not the key alone, because a pinned question written
 * with an explicit `groupId: undefined` carries the key. */
export function isRepeatGroup(item: StepItem | QuestionRef): item is RepeatGroup {
  return "groupId" in item && item.groupId !== undefined;
}

/**
 * Every pinned question ref a step holds, in document order, each group
 * expanded into its members, since a group's member pin resolves, compiles and
 * validates exactly like a step's own. A caller that needs to know a question
 * sits in a group reads {@link questionGroups} instead.
 */
export function stepQuestionRefs(step: Step): readonly QuestionRef[] {
  return step.items.flatMap((item) => (isRepeatGroup(item) ? item.items : [item]));
}

/** Every repeating group in these steps, in document order. */
export function repeatGroups(steps: readonly Step[]): readonly RepeatGroup[] {
  return steps.flatMap((step) => step.items.filter((item) => isRepeatGroup(item)));
}

/** Which repeating group each pinned question sits in; absent for a question
 * outside every group. Total, because positions are unique per question. */
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
 * which publish refuses; a `fixed` count is both ends.
 */
export function countBounds(count: RepeatCount): {
  readonly min: number;
  readonly max: number | undefined;
} {
  return count.source === "fixed"
    ? { min: count.count, max: count.count }
    : { min: count.min, max: count.max };
}
