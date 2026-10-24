import { z } from "zod";

import { QuestionId, RuleId, StepId } from "./ids.js";

/**
 * A code here describes a draft that is legal and serves correctly but probably
 * does not do what its author intended, which no later layer can detect, the
 * authoring intent being gone by then. The shape mirrors `PublishError`, so the
 * admin renders a warning through the same list and anchors.
 */
export const PublishWarningCode = z.enum([
  "MULTICHOICE_SAME_STEP_TARGET",
  "PATTERN_CLASS_SET_AMBIGUOUS",
]);
export type PublishWarningCode = z.infer<typeof PublishWarningCode>;

const message = z.string().min(1);

export const PublishWarning = z.discriminatedUnion("code", [
  // A multiChoice answer commits on group exit (ADR-31), so a same-step reveal
  // cannot happen while the respondent is still in the group.
  z.object({
    code: z.literal("MULTICHOICE_SAME_STEP_TARGET"),
    message,
    path: z.object({
      rule: RuleId,
      question: QuestionId,
      target: QuestionId,
      step: StepId,
    }),
  }),
  z.object({
    code: z.literal("PATTERN_CLASS_SET_AMBIGUOUS"),
    message,
    path: z.object({ question: QuestionId }),
  }),
]);
export type PublishWarning = z.infer<typeof PublishWarning>;

export type PublishWarningOf<C extends PublishWarningCode> = Extract<PublishWarning, { code: C }>;

/* v8 ignore next 3 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverPublishWarning(warning: never): never {
  throw new Error(
    `Unhandled publish warning code: ${String((warning as { code?: unknown }).code)}`,
  );
}

/** Exhaustive, so a new code cannot be added without a location. */
export function publishWarningLocation(warning: PublishWarning): string {
  switch (warning.code) {
    case "MULTICHOICE_SAME_STEP_TARGET":
      return `rule "${warning.path.rule}" reading question "${warning.path.question}" and showing question "${warning.path.target}" in step "${warning.path.step}"`;
    case "PATTERN_CLASS_SET_AMBIGUOUS":
      return `pattern of question "${warning.path.question}"`;
    /* v8 ignore next 2 -- unreachable by construction */
    default:
      return assertNeverPublishWarning(warning);
  }
}
