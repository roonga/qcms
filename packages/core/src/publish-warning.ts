import { z } from "zod";

import { QuestionId, RuleId, StepId } from "./ids.js";

/**
 * The typed publish **warning** model (issue #123).
 *
 * A warning is the other half of the publish report, and the distinction is
 * the whole point of the channel: an error refuses the publish, a warning
 * never does. Everything here describes a draft that is legal, compiles, and
 * will serve correctly, but that almost certainly does not do what its author
 * intended - the class of mistake no downstream layer can detect, because by
 * the time the snapshot is compiled the authoring intent is gone.
 *
 * Warnings ride the *success* result (`PublishResult`'s `ok` branch): they
 * accompany a snapshot rather than replacing one. A caller that ignores them
 * behaves exactly as it did before this channel existed.
 *
 * The shape deliberately mirrors `PublishError`: a closed discriminated union
 * on `code`, a human `message`, and a **structured domain path** rather than a
 * positional index, so the admin can render a warning through the same list,
 * with the same anchors, as the errors it already shows.
 */
export const PublishWarningCode = z.enum([
  // A rule whose condition reads a multiChoice answer and whose target is a
  // question on the SAME step (ADR-31, issue #123).
  "MULTICHOICE_SAME_STEP_TARGET",
  // A shortText `pattern` whose character class carries an unescaped `&&` or
  // `--`, which means different things under the `u` and `v` regex flags
  // (issue #53).
  "PATTERN_CLASS_SET_AMBIGUOUS",
]);
export type PublishWarningCode = z.infer<typeof PublishWarningCode>;

const message = z.string().min(1);

export const PublishWarning = z.discriminatedUnion("code", [
  // ADR-31 classifies multiChoice as committing on *group exit*, not on
  // change, so a reveal targeted at the same step cannot happen while the
  // respondent is still inside the checkbox group. Legal, and almost never
  // what the author drew.
  z.object({
    code: z.literal("MULTICHOICE_SAME_STEP_TARGET"),
    message,
    path: z.object({
      rule: RuleId,
      /** The multiChoice question the condition reads. */
      question: QuestionId,
      /** The same-step question the rule shows. */
      target: QuestionId,
      /** The step both of them sit on. */
      step: StepId,
    }),
  }),
  // `[a&&b]` compiles under both flags and means `{a, &, b}` under `u` but an
  // empty-set intersection under `v`. It produces no console error, so the
  // renderer structurally cannot detect or repair it: authoring-time
  // validation is the only layer that can say anything at all.
  z.object({
    code: z.literal("PATTERN_CLASS_SET_AMBIGUOUS"),
    message,
    path: z.object({ question: QuestionId }),
  }),
]);
export type PublishWarning = z.infer<typeof PublishWarning>;

/** The variant of PublishWarning carrying a given code. */
export type PublishWarningOf<C extends PublishWarningCode> = Extract<PublishWarning, { code: C }>;

/* v8 ignore next 3 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverPublishWarning(warning: never): never {
  throw new Error(
    `Unhandled publish warning code: ${String((warning as { code?: unknown }).code)}`,
  );
}

/**
 * Human-readable location of a publish warning, rendered from its structured
 * path - the sibling of `publishErrorLocation`, exhaustive over the code union
 * with a `never` default so a new code cannot be added without a location.
 */
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
