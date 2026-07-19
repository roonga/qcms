import { z } from "zod";

import type { Result } from "./errors.js";
import type { FormDefinition } from "./form-definition.js";
import { OptionId, QuestionId, RuleId, StepId } from "./ids.js";
import { LocaleCode } from "./localized-text.js";

/**
 * The typed publish error model (task 004, DOMAIN_SCHEMA §4.1). This is the
 * contract `compileDraft` (008) returns and the admin UI (034) renders
 * verbatim: a closed discriminated union on `code`, each variant carrying a
 * human `message` and a *structured* path (domain locations like
 * `{ step, question }`, not positional indices — the draft may be re-ordered
 * between validate and render, the IDs still resolve).
 *
 * Publish reports are always complete: `PublishResult.err` carries **all**
 * errors, never first-only. The checks that *produce* these errors are tasks
 * 005 (rule content) and 008 (publish invariants) — out of scope here.
 */
export const PublishErrorCode = z.enum([
  "DANGLING_QUESTION_REF",
  "DANGLING_OPTION_REF",
  "DANGLING_STEP_REF",
  "UNPUBLISHED_QUESTION_PIN",
  "LOCALE_INCOMPLETE",
  "RULE_BACKWARD_TARGET",
  "RULE_CYCLE",
  "RULE_DEPTH_EXCEEDED",
  "RULE_TYPE_MISMATCH",
  "DUPLICATE_QUESTION_IN_FORM",
  // Parse-level sibling of DUPLICATE_QUESTION_IN_FORM (the minimum set
  // already includes that one): compileDraft accepts a raw draft, so its
  // report must be able to carry the form's parse-level refinements too.
  "DUPLICATE_STEP_ID",
]);
export type PublishErrorCode = z.infer<typeof PublishErrorCode>;

const message = z.string().min(1);

/**
 * One variant per code, each with the path shape that locates that failure.
 * Optional keys mean "where applicable": e.g. a dangling question reference
 * may come from a step pin or from a rule condition; a locale gap without
 * step/question/option keys is the form title itself.
 */
export const PublishError = z.discriminatedUnion("code", [
  // A pinned or rule-referenced questionId that does not exist.
  z.object({
    code: z.literal("DANGLING_QUESTION_REF"),
    message,
    path: z.object({
      question: QuestionId,
      step: StepId.optional(),
      rule: RuleId.optional(),
    }),
  }),
  // A rule references an optionId the pinned question version does not carry.
  z.object({
    code: z.literal("DANGLING_OPTION_REF"),
    message,
    path: z.object({ rule: RuleId, question: QuestionId, option: OptionId }),
  }),
  // A rule's show-target names a stepId that is not in the form.
  z.object({
    code: z.literal("DANGLING_STEP_REF"),
    message,
    path: z.object({ rule: RuleId, step: StepId }),
  }),
  // A pin references a question version that is not published (R1).
  z.object({
    code: z.literal("UNPUBLISHED_QUESTION_PIN"),
    message,
    path: z.object({ step: StepId, question: QuestionId, version: z.number().int().positive() }),
  }),
  // A LocalizedText is missing the form's defaultLocale (invariant I3).
  z.object({
    code: z.literal("LOCALE_INCOMPLETE"),
    message,
    path: z.object({
      locale: LocaleCode,
      step: StepId.optional(),
      question: QuestionId.optional(),
      option: OptionId.optional(),
    }),
  }),
  // A rule target does not appear strictly after every question its
  // condition references (ADR-16 forward-only).
  z.object({
    code: z.literal("RULE_BACKWARD_TARGET"),
    message,
    path: z.object({ rule: RuleId, target: z.union([QuestionId, StepId]) }),
  }),
  // A cycle in the reads→shows graph (ADR-16); the path lists the rules on it.
  z.object({
    code: z.literal("RULE_CYCLE"),
    message,
    path: z.object({ rules: z.array(RuleId).min(1) }),
  }),
  // Condition nesting deeper than the cap of 8 (DOMAIN_SCHEMA §3).
  z.object({
    code: z.literal("RULE_DEPTH_EXCEEDED"),
    message,
    path: z.object({ rule: RuleId }),
  }),
  // A condition operator applied to a question type it is not valid for
  // (e.g. contains on a non-multiChoice question, ADR-21).
  z.object({
    code: z.literal("RULE_TYPE_MISMATCH"),
    message,
    path: z.object({ rule: RuleId, question: QuestionId }),
  }),
  // A question pinned more than once; the path names the later occurrence.
  z.object({
    code: z.literal("DUPLICATE_QUESTION_IN_FORM"),
    message,
    path: z.object({ step: StepId, question: QuestionId }),
  }),
  z.object({
    code: z.literal("DUPLICATE_STEP_ID"),
    message,
    path: z.object({ step: StepId }),
  }),
]);
export type PublishError = z.infer<typeof PublishError>;

/** The variant of PublishError carrying a given code. */
export type PublishErrorOf<C extends PublishErrorCode> = Extract<PublishError, { code: C }>;

/**
 * Type-level contract for what `compileDraft` (008) returns on success
 * (DOMAIN_SCHEMA §4.1): the validated definition, deep-frozen, stamped with
 * the evaluation-semantics version it was validated under (ADR-16). Kept
 * minimal and forward-compatible on purpose — the implementation (freezing,
 * stamping) is task 008's, and the storage row (013) adds compiled A2UI and
 * version stamps around it.
 */
export type FrozenSnapshot = {
  readonly definition: FormDefinition;
  readonly semanticsVersion: number;
};

/**
 * The publish contract (DOMAIN_SCHEMA §4.1): `ok(frozenSnapshot)` when every
 * invariant holds, otherwise `err` with **all** publish errors — atomic,
 * nothing persisted, never first-only.
 */
export type PublishResult = Result<FrozenSnapshot, readonly PublishError[]>;

/* v8 ignore next 3 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverPublishError(error: never): never {
  throw new Error(`Unhandled publish error code: ${String((error as { code?: unknown }).code)}`);
}

/**
 * Human-readable location of a publish error, rendered from its structured
 * path (the admin UI's default presentation next to the message). The switch
 * is exhaustive over the code union with a `never` default — adding a code
 * without handling it here is a build error, not a runtime surprise.
 */
export function publishErrorLocation(error: PublishError): string {
  switch (error.code) {
    case "DANGLING_QUESTION_REF": {
      const via =
        error.path.step !== undefined
          ? ` in step "${error.path.step}"`
          : error.path.rule !== undefined
            ? ` in rule "${error.path.rule}"`
            : "";
      return `question "${error.path.question}"${via}`;
    }
    case "DANGLING_OPTION_REF":
      return `option "${error.path.option}" of question "${error.path.question}" in rule "${error.path.rule}"`;
    case "DANGLING_STEP_REF":
      return `step "${error.path.step}" in rule "${error.path.rule}"`;
    case "UNPUBLISHED_QUESTION_PIN":
      return `question "${error.path.question}"@${String(error.path.version)} in step "${error.path.step}"`;
    case "LOCALE_INCOMPLETE": {
      const at =
        error.path.option !== undefined && error.path.question !== undefined
          ? `option "${error.path.option}" of question "${error.path.question}"`
          : error.path.question !== undefined
            ? `question "${error.path.question}"`
            : error.path.step !== undefined
              ? `step "${error.path.step}"`
              : "form title";
      return `locale "${error.path.locale}" missing on ${at}`;
    }
    case "RULE_BACKWARD_TARGET":
      return `target "${error.path.target}" of rule "${error.path.rule}"`;
    case "RULE_CYCLE":
      return `rules ${error.path.rules.map((rule) => `"${rule}"`).join(" -> ")}`;
    case "RULE_DEPTH_EXCEEDED":
      return `rule "${error.path.rule}"`;
    case "RULE_TYPE_MISMATCH":
      return `question "${error.path.question}" in rule "${error.path.rule}"`;
    case "DUPLICATE_QUESTION_IN_FORM":
      return `question "${error.path.question}" in step "${error.path.step}"`;
    case "DUPLICATE_STEP_ID":
      return `step "${error.path.step}"`;
    /* v8 ignore next 2 -- unreachable by construction */
    default:
      return assertNeverPublishError(error);
  }
}
