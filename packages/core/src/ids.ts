import { z } from "zod";

import type { Result } from "./errors.js";
import { parseWithCode } from "./internal/parse.js";

// Branded so the ids are nominal at compile time, one kind not being assignable
// to another although all are strings. An id is never reused with a different
// meaning (R6).
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

/** Form-scoped, permanent within a form, and never read by a respondent. */
export const GroupId = z.string().regex(idPattern("grp")).brand<"GroupId">();
export type GroupId = z.infer<typeof GroupId>;

/**
 * Session-scoped, minted once, never reused or renumbered, and never a label a
 * respondent reads. The ordinal they do read is recomputed after a removal, so
 * using it as a key would re-target a removed instance's answers.
 */
export const InstanceId = z.string().regex(idPattern("ins")).brand<"InstanceId">();
export type InstanceId = z.infer<typeof InstanceId>;

/**
 * No branded id may contain it, so an answer key parses without a schema. It is
 * a legal HTML `id` and fragment, and needs `CSS.escape` in a selector.
 */
export const ANSWER_KEY_SEPARATOR = "/";

export const InstanceAnswerKey = z
  .string()
  .regex(/^ins_[a-z0-9_]+\/q_[a-z0-9_]+$/)
  .brand<"InstanceAnswerKey">();
export type InstanceAnswerKey = z.infer<typeof InstanceAnswerKey>;

/** A question outside every group keeps the bare `questionId` (ADR-42). */
export type AnswerKey = QuestionId | InstanceAnswerKey;

// Cast justified: both halves are branded ids whose patterns exclude the
// separator, so the result matches the key pattern by construction.
export function answerKey(questionId: QuestionId, instanceId?: InstanceId): AnswerKey {
  return instanceId === undefined
    ? questionId
    : (`${instanceId}${ANSWER_KEY_SEPARATOR}${questionId}` as InstanceAnswerKey);
}

/** A key that is not instance-qualified comes back as a bare question id. */
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
