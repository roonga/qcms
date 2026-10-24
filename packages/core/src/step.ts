import { z } from "zod";

import { GroupId, QuestionId, StepId } from "./ids.js";
import { LocalizedText } from "./localized-text.js";

/**
 * A pinned reference to a question version (ADR-02), so a snapshot freezes which
 * content each questionId had. Whether the pin resolves is a publish invariant.
 */
export const QuestionRef = z.object({
  questionId: QuestionId,
  version: z.number().int().positive(),
});
export type QuestionRef = z.infer<typeof QuestionRef>;

/**
 * Where a group's instance count comes from (ADR-42). `max` is optional here and
 * required at publish, so a half-filled draft still round-trips; nothing caps
 * its value, an author's `max` being reviewed at form review (SEC-16).
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

/** How a group's instances are laid out; the renderer reads this. */
export const RepeatPresentation = z.enum(["stacked", "perInstanceStep", "table"]);
export type RepeatPresentation = z.infer<typeof RepeatPresentation>;

/**
 * A repeating group inside a step's item list (ADR-42). `instanceLabel` carries
 * at most a `{n}`, the live ordinal. A group may not contain a group: nesting
 * would make an instance address a path, the per-instance walk quadratic and the
 * CSV grain a tree, so lifting that is a change to addressing and export.
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

// Optional, so an absent key and an undefined one are the same absence, and
// `never`, so any present value is refused by name.
const forbiddenKey = z.never({ error: ITEM_IS_ONE_OR_THE_OTHER }).optional();

// Each member refuses the other's keys: without that an item carrying both
// matches whichever comes first, has the rest stripped as unknown, and silently
// becomes something its author did not write.
const StepQuestionRef = QuestionRef.extend({ groupId: forbiddenKey });
const StepRepeatGroup = RepeatGroup.extend({
  questionId: forbiddenKey,
  version: forbiddenKey,
});

/**
 * One entry of a step's item list. It carries no `kind` tag, the two shapes
 * having disjoint required keys, and adding one would stop every stored form
 * definition parsing.
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
 * The cost budget for one cross-group rule, in instance pairs (ADR-16, SEC-16).
 * A cost bound rather than an instance ceiling: per rule, and checked at publish
 * against declared maxima, so serving cost is known before a form publishes.
 * Moving it is a decision rather than a tuning, forms publishing against it.
 */
export const REPEAT_EVALUATION_BUDGET = 10_000;

/**
 * The question types a `table` presentation admits as columns (ADR-43); the
 * stacked presentation allows every type. A constant rather than a literal at
 * the check, because the admin's library picker filters to the same list.
 */
export const TABLE_COLUMN_TYPES = [
  "shortText",
  "number",
  "date",
  "boolean",
  "singleChoice",
] as const;

/** Takes a string, so an unknown library type narrows rather than widens. */
export function isTableColumnType(type: string): boolean {
  return (TABLE_COLUMN_TYPES as readonly string[]).includes(type);
}

/** The live, one-based ordinal of the instance in the roster. */
export const INSTANCE_LABEL_PLACEHOLDER = "n";

export function labelPlaceholders(template: string): readonly string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? "");
}

/** Tests the value, not the key: a pin written with `groupId: undefined` has it. */
export function isRepeatGroup(item: StepItem | QuestionRef): item is RepeatGroup {
  return "groupId" in item && item.groupId !== undefined;
}

/**
 * Every pin a step holds, in document order, each group expanded into its
 * members. {@link questionGroups} is what says where a question sits.
 */
export function stepQuestionRefs(step: Step): readonly QuestionRef[] {
  return step.items.flatMap((item) => (isRepeatGroup(item) ? item.items : [item]));
}

export function repeatGroups(steps: readonly Step[]): readonly RepeatGroup[] {
  return steps.flatMap((step) => step.items.filter((item) => isRepeatGroup(item)));
}

/** Absent for a question outside every group. */
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
 * One shape for all three count sources. `max` is `undefined` only for a bounded
 * source that omitted it, which publish refuses.
 */
export function countBounds(count: RepeatCount): {
  readonly min: number;
  readonly max: number | undefined;
} {
  return count.source === "fixed"
    ? { min: count.count, max: count.count }
    : { min: count.min, max: count.max };
}
