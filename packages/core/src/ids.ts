import { z } from "zod";

import type { Result } from "./errors.js";
import { parseWithCode } from "./internal/parse.js";

/**
 * Branded ID types (task 002, R6; `lnk_` added in task 010; `grp_` and `ins_`
 * added in task 071, ADR-42). Prefixes are settled project-wide
 * (`q_ frm_ stp_ opt_ rul_ ses_ lnk_ grp_ ins_`) and an ID is never reused with
 * a different
 * meaning. Branding makes the IDs nominal at compile time - a FormId cannot be
 * passed where a QuestionId is expected even though both are strings.
 * .NET mapping: strongly-typed IDs, like `record struct QuestionId(string Value)`.
 */
const idPattern = (prefix: string): RegExp => new RegExp(`^${prefix}_[a-z0-9_]+$`);

export const QuestionId = z.string().regex(idPattern("q")).brand<"QuestionId">();
export type QuestionId = z.infer<typeof QuestionId>;

export const FormId = z.string().regex(idPattern("frm")).brand<"FormId">();
export type FormId = z.infer<typeof FormId>;

export const StepId = z.string().regex(idPattern("stp")).brand<"StepId">();
export type StepId = z.infer<typeof StepId>;

export const OptionId = z.string().regex(idPattern("opt")).brand<"OptionId">();
export type OptionId = z.infer<typeof OptionId>;

export const RuleId = z.string().regex(idPattern("rul")).brand<"RuleId">();
export type RuleId = z.infer<typeof RuleId>;

export const SessionId = z.string().regex(idPattern("ses")).brand<"SessionId">();
export type SessionId = z.infer<typeof SessionId>;

export const LinkId = z.string().regex(idPattern("lnk")).brand<"LinkId">();
export type LinkId = z.infer<typeof LinkId>;

/**
 * A repeating group's id (ADR-42): **form-scoped**, permanent within a form the
 * way a `StepId` is, and never the name of anything a respondent reads.
 */
export const GroupId = z.string().regex(idPattern("grp")).brand<"GroupId">();
export type GroupId = z.infer<typeof GroupId>;

/**
 * One instance of a repeating group (ADR-42): **session-scoped**, minted once,
 * never reused across sessions and never renumbered within one.
 *
 * The id is **never a label**. It appears in an answer key, in a field `name`,
 * in a DOM id, in an error-summary anchor and in the no-JS fragment, all of
 * which a respondent can read in the page source; it appears in no heading,
 * legend, label, message or caption, so a respondent is never asked to read or
 * understand it. The ordinal they do read ("Passenger 2") is the instance's
 * position in the live roster and is presentation only, recomputed after a
 * removal - which is exactly why the id and not the ordinal is the identity
 * (R6 one level down: an ordinal reused as a key would silently re-target a
 * removed passenger's answers at the passenger who took their place).
 */
export const InstanceId = z.string().regex(idPattern("ins")).brand<"InstanceId">();
export type InstanceId = z.infer<typeof InstanceId>;

/**
 * The separator between an instance id and a question id in an answer key
 * (ADR-42, Q15 ruled 2026-09-29): `ins_7k2/q_passport`.
 *
 * `/` is safe because no branded id may contain it - every prefix pattern above
 * is `[a-z0-9_]+` - so the encoding parses without a schema. It is also a legal
 * HTML `id` and a legal fragment, and needs `CSS.escape` in a selector, which
 * the shared jsdom setup already polyfills.
 */
export const ANSWER_KEY_SEPARATOR = "/";

/** An `ins_.../q_...` answer key: one question inside one instance of a group. */
export const InstanceAnswerKey = z
  .string()
  .regex(/^ins_[a-z0-9_]+\/q_[a-z0-9_]+$/)
  .brand<"InstanceAnswerKey">();
export type InstanceAnswerKey = z.infer<typeof InstanceAnswerKey>;

/**
 * How an answer is addressed (ADR-42). A question outside every repeating group
 * keeps the bare `questionId` it has always had, byte for byte; a question
 * inside a group is keyed by its instance as well.
 *
 * `QuestionId` is a member of the union, which is what lets every existing
 * caller of {@link AnswerMap} compile unchanged.
 */
export type AnswerKey = QuestionId | InstanceAnswerKey;

/**
 * The key an answer is stored and evaluated under: the bare `questionId`
 * outside a group, `instanceId/questionId` inside one.
 *
 * The cast is the branded-construction idiom: both halves are already branded
 * ids whose patterns exclude the separator, so the result matches
 * {@link InstanceAnswerKey}'s pattern by construction and re-parsing it would
 * only re-prove that on the evaluator's hot path.
 */
export function answerKey(questionId: QuestionId, instanceId?: InstanceId): AnswerKey {
  return instanceId === undefined
    ? questionId
    : (`${instanceId}${ANSWER_KEY_SEPARATOR}${questionId}` as InstanceAnswerKey);
}

/**
 * Split an answer key back into its parts. `instanceId` is `undefined` for a
 * question outside every group. Total: a key that is not instance-qualified is
 * returned as a bare question id, whatever it holds.
 */
export function answerKeyParts(key: AnswerKey): {
  readonly instanceId?: InstanceId;
  readonly questionId: QuestionId;
} {
  const cut = key.indexOf(ANSWER_KEY_SEPARATOR);
  if (cut < 0) {
    return { questionId: key as QuestionId };
  }
  return {
    instanceId: key.slice(0, cut) as InstanceId,
    questionId: key.slice(cut + 1) as QuestionId,
  };
}

export function parseGroupId(value: unknown): Result<GroupId> {
  return parseWithCode(GroupId, "INVALID_GROUP_ID", "GroupId", value);
}
export function isGroupId(value: unknown): value is GroupId {
  return GroupId.safeParse(value).success;
}

export function parseInstanceId(value: unknown): Result<InstanceId> {
  return parseWithCode(InstanceId, "INVALID_INSTANCE_ID", "InstanceId", value);
}
export function isInstanceId(value: unknown): value is InstanceId {
  return InstanceId.safeParse(value).success;
}

export function isInstanceAnswerKey(value: unknown): value is InstanceAnswerKey {
  return InstanceAnswerKey.safeParse(value).success;
}

export function parseQuestionId(value: unknown): Result<QuestionId> {
  return parseWithCode(QuestionId, "INVALID_QUESTION_ID", "QuestionId", value);
}
export function isQuestionId(value: unknown): value is QuestionId {
  return QuestionId.safeParse(value).success;
}

export function parseFormId(value: unknown): Result<FormId> {
  return parseWithCode(FormId, "INVALID_FORM_ID", "FormId", value);
}
export function isFormId(value: unknown): value is FormId {
  return FormId.safeParse(value).success;
}

export function parseStepId(value: unknown): Result<StepId> {
  return parseWithCode(StepId, "INVALID_STEP_ID", "StepId", value);
}
export function isStepId(value: unknown): value is StepId {
  return StepId.safeParse(value).success;
}

export function parseOptionId(value: unknown): Result<OptionId> {
  return parseWithCode(OptionId, "INVALID_OPTION_ID", "OptionId", value);
}
export function isOptionId(value: unknown): value is OptionId {
  return OptionId.safeParse(value).success;
}

export function parseRuleId(value: unknown): Result<RuleId> {
  return parseWithCode(RuleId, "INVALID_RULE_ID", "RuleId", value);
}
export function isRuleId(value: unknown): value is RuleId {
  return RuleId.safeParse(value).success;
}

export function parseSessionId(value: unknown): Result<SessionId> {
  return parseWithCode(SessionId, "INVALID_SESSION_ID", "SessionId", value);
}
export function isSessionId(value: unknown): value is SessionId {
  return SessionId.safeParse(value).success;
}

export function parseLinkId(value: unknown): Result<LinkId> {
  return parseWithCode(LinkId, "INVALID_LINK_ID", "LinkId", value);
}
export function isLinkId(value: unknown): value is LinkId {
  return LinkId.safeParse(value).success;
}
