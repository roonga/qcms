import { describe, expect, it } from "vitest";

import { PublishWarning, PublishWarningCode, publishWarningLocation } from "./index.js";

/**
 * The warning model's own contract test, the sibling of `publish-error.test.ts`
 * (issue #123). Same three properties: the enum and the union stay in lockstep,
 * every code has a sample, and every sample renders a location.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const codesInLockstep: MutuallyAssignable<PublishWarning["code"], PublishWarningCode> = true;

const samples: { raw: unknown; location: string }[] = [
  {
    raw: {
      code: "MULTICHOICE_SAME_STEP_TARGET",
      message: "Rule reveals a same-step question from a multiChoice answer",
      path: {
        rule: "rul_condition_details",
        question: "q_preexisting_conditions",
        target: "q_condition_notes",
        step: "stp_health",
      },
    },
    location:
      'rule "rul_condition_details" reading question "q_preexisting_conditions" and showing question "q_condition_notes" in step "stp_health"',
  },
  {
    raw: {
      code: "PATTERN_CLASS_SET_AMBIGUOUS",
      message: "Pattern character class contains an unescaped '&&'",
      path: { question: "q_policy_number" },
    },
    location: 'pattern of question "q_policy_number"',
  },
];

describe("PublishWarning", () => {
  it("codes and union variants stay in lockstep (compile-time)", () => {
    expect(codesInLockstep).toBe(true);
    expect(PublishWarningCode.options).toHaveLength(2);
  });

  it("samples cover every code", () => {
    const covered = new Set(samples.map((sample) => (sample.raw as { code: string }).code));
    for (const code of PublishWarningCode.options) {
      expect(covered, `no sample covers ${code}`).toContain(code);
    }
  });

  it.each(samples)("parses and locates $raw.code", ({ raw, location }) => {
    const warning = PublishWarning.parse(raw);
    expect(publishWarningLocation(warning)).toBe(location);
  });

  it("rejects a warning with no message", () => {
    expect(
      PublishWarning.safeParse({
        code: "PATTERN_CLASS_SET_AMBIGUOUS",
        message: "",
        path: { question: "q_policy_number" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown code: the union is closed", () => {
    expect(
      PublishWarning.safeParse({ code: "NOT_A_WARNING", message: "hm", path: {} }).success,
    ).toBe(false);
  });
});
