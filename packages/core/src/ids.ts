import { z } from "zod";

import type { Result } from "./errors.js";
import { parseWithCode } from "./internal/parse.js";

/**
 * Branded ID types (task 002, R6; `lnk_` added in task 010). Prefixes are
 * settled project-wide (`q_ frm_ stp_ opt_ rul_ ses_ lnk_`) and an ID is
 * never reused with a different
 * meaning. Branding makes the IDs nominal at compile time — a FormId cannot be
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
