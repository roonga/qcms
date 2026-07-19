import { describe, expect, it } from "vitest";

import {
  FormId,
  LinkId,
  OptionId,
  QuestionId,
  RuleId,
  SessionId,
  StepId,
  isFormId,
  isLinkId,
  isOptionId,
  isQuestionId,
  isRuleId,
  isSessionId,
  isStepId,
  parseFormId,
  parseLinkId,
  parseOptionId,
  parseQuestionId,
  parseRuleId,
  parseSessionId,
  parseStepId,
} from "./index.js";

const KINDS = [
  {
    name: "QuestionId",
    schema: QuestionId,
    parse: parseQuestionId,
    is: isQuestionId,
    valid: "q_smoker",
    code: "INVALID_QUESTION_ID",
  },
  {
    name: "FormId",
    schema: FormId,
    parse: parseFormId,
    is: isFormId,
    valid: "frm_life_signup",
    code: "INVALID_FORM_ID",
  },
  {
    name: "StepId",
    schema: StepId,
    parse: parseStepId,
    is: isStepId,
    valid: "stp_health",
    code: "INVALID_STEP_ID",
  },
  {
    name: "OptionId",
    schema: OptionId,
    parse: parseOptionId,
    is: isOptionId,
    valid: "opt_yes",
    code: "INVALID_OPTION_ID",
  },
  {
    name: "RuleId",
    schema: RuleId,
    parse: parseRuleId,
    is: isRuleId,
    valid: "rul_smoker_followup",
    code: "INVALID_RULE_ID",
  },
  {
    name: "SessionId",
    schema: SessionId,
    parse: parseSessionId,
    is: isSessionId,
    valid: "ses_abc123",
    code: "INVALID_SESSION_ID",
  },
  {
    name: "LinkId",
    schema: LinkId,
    parse: parseLinkId,
    is: isLinkId,
    valid: "lnk_batch_2026_07",
    code: "INVALID_LINK_ID",
  },
] as const;

describe.each(KINDS)("$name", ({ schema, parse, is, valid, code }) => {
  it("round-trips a valid id unchanged", () => {
    const result = parse(valid);
    expect(result).toEqual({ ok: true, value: valid });
    expect(schema.parse(valid)).toBe(valid);
    expect(is(valid)).toBe(true);
  });

  it("rejects a wrong prefix with its typed code", () => {
    const result = parse("zzz_nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
    }
    expect(is("zzz_nope")).toBe(false);
  });

  it("rejects prefix-only, uppercase, and non-string input", () => {
    const prefix = valid.slice(0, valid.indexOf("_") + 1);
    for (const bad of [prefix, valid.toUpperCase(), `${valid} `, "", 42, null, undefined]) {
      const result = parse(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
      }
    }
  });
});

describe("id kinds are mutually exclusive", () => {
  it("a QuestionId is not accepted by the other kinds", () => {
    expect(isQuestionId("q_smoker")).toBe(true);
    expect(isFormId("q_smoker")).toBe(false);
    expect(isStepId("q_smoker")).toBe(false);
    expect(isOptionId("q_smoker")).toBe(false);
    expect(isRuleId("q_smoker")).toBe(false);
    expect(isSessionId("q_smoker")).toBe(false);
    expect(isLinkId("q_smoker")).toBe(false);
  });
});
