import { z } from "zod";

import type { Result } from "./errors.js";
import type { FormDefinition } from "./form-definition.js";
import { GroupId, OptionId, QuestionId, RuleId, StepId } from "./ids.js";
import { LocaleCode } from "./localized-text.js";
import type { PublishWarning } from "./publish-warning.js";
import type { QuestionVersionRecord } from "./question-definition.js";
import { ValidationMessageKey } from "./validation-message.js";

/**
 * The typed publish error model (DOMAIN_SCHEMA §4.1): a closed union on `code`,
 * each variant carrying a human `message` and a structured domain path rather
 * than positional indices, so a draft re-ordered between validate and render
 * still resolves. Publish reports are always complete, never first-only.
 */
export const PublishErrorCode = z.enum([
  "DANGLING_QUESTION_REF",
  "DANGLING_OPTION_REF",
  "DANGLING_STEP_REF",
  "UNPUBLISHED_QUESTION_PIN",
  "LOCALE_INCOMPLETE",
  "BLANK_LOCALIZED_TEXT",
  "RULE_BACKWARD_TARGET",
  "RULE_CYCLE",
  "RULE_DEPTH_EXCEEDED",
  "RULE_TYPE_MISMATCH",
  "DUPLICATE_QUESTION_IN_FORM",
  "DUPLICATE_STEP_ID",
  "ORPHAN_MESSAGE_KEY",
  "DUPLICATE_GROUP_ID",
  "REPEAT_NESTING_NOT_ALLOWED",
  "REPEAT_MAX_MISSING",
  "REPEAT_MIN_ABOVE_MAX",
  "REPEAT_COUNT_BACKWARD_REF",
  "REPEAT_COUNT_NOT_A_NUMBER",
  "INSTANCE_LABEL_PLACEHOLDER_UNKNOWN",
  "RULE_TARGETS_SPAN_SCOPES",
  "REPEAT_EVALUATION_BUDGET_EXCEEDED",
  "DANGLING_GROUP_REF",
  "REPEAT_OPERATOR_NESTING_NOT_ALLOWED",
  "RULE_READS_GROUP_WITHOUT_OPERATOR",
  "REPEAT_COUNT_INSIDE_GROUP",
  "TABLE_COLUMN_TYPE_NOT_ALLOWED",
]);
export type PublishErrorCode = z.infer<typeof PublishErrorCode>;

const message = z.string().min(1);

/**
 * One variant per code, each with the path shape that locates that failure. An
 * optional key means "where applicable": a locale gap with no step, question or
 * option key is the form title itself.
 */
export const PublishError = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("DANGLING_QUESTION_REF"),
    message,
    path: z.object({
      question: QuestionId,
      step: StepId.optional(),
      rule: RuleId.optional(),
    }),
  }),
  z.object({
    code: z.literal("DANGLING_OPTION_REF"),
    message,
    path: z.object({ rule: RuleId, question: QuestionId, option: OptionId }),
  }),
  z.object({
    code: z.literal("DANGLING_STEP_REF"),
    message,
    path: z.object({ rule: RuleId, step: StepId }),
  }),
  z.object({
    code: z.literal("UNPUBLISHED_QUESTION_PIN"),
    message,
    path: z.object({ step: StepId, question: QuestionId, version: z.number().int().positive() }),
  }),
  z.object({
    code: z.literal("LOCALE_INCOMPLETE"),
    message,
    path: z.object({
      locale: LocaleCode,
      step: StepId.optional(),
      group: GroupId.optional(),
      question: QuestionId.optional(),
      option: OptionId.optional(),
    }),
  }),
  // Same locations as LOCALE_INCOMPLETE, a different verdict about the value.
  z.object({
    code: z.literal("BLANK_LOCALIZED_TEXT"),
    message,
    path: z.object({
      locale: LocaleCode,
      step: StepId.optional(),
      group: GroupId.optional(),
      question: QuestionId.optional(),
      option: OptionId.optional(),
    }),
  }),
  z.object({
    code: z.literal("RULE_BACKWARD_TARGET"),
    message,
    path: z.object({ rule: RuleId, target: z.union([QuestionId, StepId]) }),
  }),
  z.object({
    code: z.literal("RULE_CYCLE"),
    message,
    path: z.object({ rules: z.array(RuleId).min(1) }),
  }),
  z.object({
    code: z.literal("RULE_DEPTH_EXCEEDED"),
    message,
    path: z.object({ rule: RuleId }),
  }),
  z.object({
    code: z.literal("RULE_TYPE_MISMATCH"),
    message,
    path: z.object({ rule: RuleId, question: QuestionId }),
  }),
  // The path names the later occurrence.
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
  z.object({
    code: z.literal("ORPHAN_MESSAGE_KEY"),
    message,
    path: z.object({ question: QuestionId, constraint: ValidationMessageKey }),
  }),
  z.object({
    code: z.literal("DUPLICATE_GROUP_ID"),
    message,
    path: z.object({ group: GroupId, step: StepId }),
  }),
  // Refused at parse too; this variant reports a definition built without the
  // parser.
  z.object({
    code: z.literal("REPEAT_NESTING_NOT_ALLOWED"),
    message,
    path: z.object({ group: GroupId, step: StepId }),
  }),
  z.object({
    code: z.literal("REPEAT_MAX_MISSING"),
    message,
    path: z.object({ group: GroupId, step: StepId }),
  }),
  z.object({
    code: z.literal("REPEAT_MIN_ABOVE_MAX"),
    message,
    path: z.object({ group: GroupId, step: StepId }),
  }),
  z.object({
    code: z.literal("REPEAT_COUNT_BACKWARD_REF"),
    message,
    path: z.object({ group: GroupId, question: QuestionId }),
  }),
  z.object({
    code: z.literal("REPEAT_COUNT_NOT_A_NUMBER"),
    message,
    path: z.object({ group: GroupId, question: QuestionId }),
  }),
  z.object({
    code: z.literal("INSTANCE_LABEL_PLACEHOLDER_UNKNOWN"),
    message,
    path: z.object({ group: GroupId, locale: LocaleCode, placeholder: z.string() }),
  }),
  // `"form"` is the scope of every target outside every group, step targets
  // included.
  z.object({
    code: z.literal("RULE_TARGETS_SPAN_SCOPES"),
    message,
    path: z.object({
      rule: RuleId,
      scopes: z.array(z.union([GroupId, z.literal("form")])).min(2),
    }),
  }),
  z.object({
    code: z.literal("REPEAT_EVALUATION_BUDGET_EXCEEDED"),
    message,
    path: z.object({ rule: RuleId, targetGroup: GroupId, readGroup: GroupId }),
  }),
  z.object({
    code: z.literal("DANGLING_GROUP_REF"),
    message,
    path: z.object({ rule: RuleId, group: GroupId }),
  }),
  z.object({
    code: z.literal("REPEAT_OPERATOR_NESTING_NOT_ALLOWED"),
    message,
    path: z.object({ rule: RuleId, outerGroup: GroupId, innerGroup: GroupId }),
  }),
  z.object({
    code: z.literal("RULE_READS_GROUP_WITHOUT_OPERATOR"),
    message,
    path: z.object({ rule: RuleId, question: QuestionId, group: GroupId }),
  }),
  z.object({
    code: z.literal("REPEAT_COUNT_INSIDE_GROUP"),
    message,
    path: z.object({ group: GroupId, question: QuestionId }),
  }),
  // `type` is on the path so the admin can name the refused type without
  // re-resolving the pin.
  z.object({
    code: z.literal("TABLE_COLUMN_TYPE_NOT_ALLOWED"),
    message,
    path: z.object({
      group: GroupId,
      question: QuestionId,
      step: StepId,
      type: z.string().min(1),
    }),
  }),
]);
export type PublishError = z.infer<typeof PublishError>;

/** The variant of PublishError carrying a given code. */
export type PublishErrorOf<C extends PublishErrorCode> = Extract<PublishError, { code: C }>;

/**
 * What a successful publish freezes (DOMAIN_SCHEMA §4.1): the definition plus
 * the question version each pin resolved to, so the snapshot is
 * self-contained (R1), stamped with the semantics and schema versions it was
 * validated under. Compiled A2UI is attached outside core.
 */
export type FrozenSnapshot = {
  readonly definition: FormDefinition;
  /** One per distinct pin, in document order. */
  readonly questions: readonly QuestionVersionRecord[];
  readonly semanticsVersion: number;
  readonly schemaVersion: number;
};

/**
 * The frozen snapshot plus every advisory the checks raised. Warnings ride the
 * success branch rather than a channel of their own, because a warning did not
 * stop the publish, so a result carrying warnings always carries a snapshot.
 */
export type PublishOutcome = {
  readonly snapshot: FrozenSnapshot;
  /** Non-blocking advisories about a draft that is nonetheless publishable. */
  readonly warnings: readonly PublishWarning[];
};

/**
 * The publish contract (DOMAIN_SCHEMA §4.1): atomic, and on failure every
 * publish error rather than the first.
 */
export type PublishResult = Result<PublishOutcome, readonly PublishError[]>;

/* v8 ignore next 3 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverPublishError(error: never): never {
  throw new Error(`Unhandled publish error code: ${String((error as { code?: unknown }).code)}`);
}

/**
 * Where a `LocalizedText` verdict was reached, written for a human. Shared by
 * the two codes that report on one, which name the same sites.
 */
function textSite(path: {
  readonly step?: StepId | undefined;
  readonly group?: GroupId | undefined;
  readonly question?: QuestionId | undefined;
  readonly option?: OptionId | undefined;
}): string {
  if (path.option !== undefined && path.question !== undefined) {
    return `option "${path.option}" of question "${path.question}"`;
  }
  if (path.question !== undefined) return `question "${path.question}"`;
  if (path.group !== undefined) return `group "${path.group}"`;
  if (path.step !== undefined) return `step "${path.step}"`;
  return "form title";
}

/**
 * Human-readable location of a publish error, rendered from its structured
 * path. The switch is exhaustive with a `never` default, so adding a code
 * without handling it here is a build error rather than a runtime surprise.
 */
export function publishErrorLocation(error: PublishError): string {
  switch (error.code) {
    case "DANGLING_QUESTION_REF": {
      let via = "";
      if (error.path.step !== undefined) {
        via = ` in step "${error.path.step}"`;
      } else if (error.path.rule !== undefined) {
        via = ` in rule "${error.path.rule}"`;
      }
      return `question "${error.path.question}"${via}`;
    }
    case "DANGLING_OPTION_REF":
      return `option "${error.path.option}" of question "${error.path.question}" in rule "${error.path.rule}"`;
    case "DANGLING_STEP_REF":
      return `step "${error.path.step}" in rule "${error.path.rule}"`;
    case "UNPUBLISHED_QUESTION_PIN":
      return `question "${error.path.question}"@${String(error.path.version)} in step "${error.path.step}"`;
    case "LOCALE_INCOMPLETE":
      return `locale "${error.path.locale}" missing on ${textSite(error.path)}`;
    case "BLANK_LOCALIZED_TEXT":
      return `locale "${error.path.locale}" blank on ${textSite(error.path)}`;
    case "RULE_BACKWARD_TARGET":
      return `target "${error.path.target}" of rule "${error.path.rule}"`;
    case "RULE_CYCLE": {
      const quotedRules = error.path.rules.map((rule) => `"${rule}"`).join(" -> ");
      return `rules ${quotedRules}`;
    }
    case "RULE_DEPTH_EXCEEDED":
      return `rule "${error.path.rule}"`;
    case "RULE_TYPE_MISMATCH":
      return `question "${error.path.question}" in rule "${error.path.rule}"`;
    case "DUPLICATE_QUESTION_IN_FORM":
      return `question "${error.path.question}" in step "${error.path.step}"`;
    case "DUPLICATE_STEP_ID":
      return `step "${error.path.step}"`;
    case "ORPHAN_MESSAGE_KEY":
      return `validation message "${error.path.constraint}" of question "${error.path.question}"`;
    case "DUPLICATE_GROUP_ID":
    case "REPEAT_NESTING_NOT_ALLOWED":
    case "REPEAT_MAX_MISSING":
    case "REPEAT_MIN_ABOVE_MAX":
      return `group "${error.path.group}" in step "${error.path.step}"`;
    case "REPEAT_COUNT_BACKWARD_REF":
    case "REPEAT_COUNT_NOT_A_NUMBER":
    case "REPEAT_COUNT_INSIDE_GROUP":
      return `count question "${error.path.question}" of group "${error.path.group}"`;
    case "INSTANCE_LABEL_PLACEHOLDER_UNKNOWN":
      return `placeholder "{${error.path.placeholder}}" in locale "${error.path.locale}" of group "${error.path.group}"`;
    case "RULE_TARGETS_SPAN_SCOPES": {
      const named = error.path.scopes.map((scope) =>
        scope === "form" ? "the form" : `group "${scope}"`,
      );
      return `rule "${error.path.rule}" across ${named.join(" and ")}`;
    }
    case "REPEAT_EVALUATION_BUDGET_EXCEEDED":
      return `rule "${error.path.rule}" from group "${error.path.targetGroup}" over group "${error.path.readGroup}"`;
    case "DANGLING_GROUP_REF":
      return `group "${error.path.group}" in rule "${error.path.rule}"`;
    case "REPEAT_OPERATOR_NESTING_NOT_ALLOWED":
      return `group "${error.path.innerGroup}" inside group "${error.path.outerGroup}" in rule "${error.path.rule}"`;
    case "RULE_READS_GROUP_WITHOUT_OPERATOR":
      return `question "${error.path.question}" of group "${error.path.group}" in rule "${error.path.rule}"`;
    case "TABLE_COLUMN_TYPE_NOT_ALLOWED":
      return `column "${error.path.question}" of group "${error.path.group}" in step "${error.path.step}"`;
    /* v8 ignore next 2 -- unreachable by construction */
    default:
      return assertNeverPublishError(error);
  }
}
