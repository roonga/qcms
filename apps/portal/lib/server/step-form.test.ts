import { describe, expect, it } from "vitest";

import { decodeStepForm } from "./step-form";

/**
 * Whole-step form decoding (task 044). The native-submit renderer tags each answer
 * field with a `__qk__<questionId>` kind hint; this decoder turns the wire strings
 * back into canonical JSON shapes for the API (pure transport, no validation - R2).
 * A field with no kind tag is the honeypot decoy, forwarded verbatim in `extras`.
 */

/** Build a FormData from `[name, value]` pairs (a value may repeat for multi). */
function form(...pairs: [string, string][]): FormData {
  const fd = new FormData();
  for (const [name, value] of pairs) fd.append(name, value);
  return fd;
}

describe("decodeStepForm (task 044 transport decoding)", () => {
  it("decodes a radio 'true'/'false' to a JSON boolean", () => {
    const { answers } = decodeStepForm(form(["__qk__q_bool", "radio"], ["q_bool", "true"]));
    expect(answers).toEqual([{ questionId: "q_bool", value: true }]);

    const no = decodeStepForm(form(["__qk__q_bool", "radio"], ["q_bool", "false"]));
    expect(no.answers).toEqual([{ questionId: "q_bool", value: false }]);
  });

  it("keeps a radio OptionId (singleChoice) as a string", () => {
    const { answers } = decodeStepForm(form(["__qk__q_c", "radio"], ["q_c", "opt_standard"]));
    expect(answers).toEqual([{ questionId: "q_c", value: "opt_standard" }]);
  });

  it("coerces a number field with Number()", () => {
    const { answers } = decodeStepForm(form(["__qk__q_n", "number"], ["q_n", "10"]));
    expect(answers).toEqual([{ questionId: "q_n", value: 10 }]);
  });

  it("collects a multiChoice into a string array", () => {
    const { answers } = decodeStepForm(
      form(["__qk__q_m", "multi"], ["q_m", "opt_a"], ["q_m", "opt_b"]),
    );
    expect(answers).toEqual([{ questionId: "q_m", value: ["opt_a", "opt_b"] }]);
  });

  it("keeps a string/date field as-is", () => {
    const { answers } = decodeStepForm(form(["__qk__q_d", "string"], ["q_d", "2026-07-22"]));
    expect(answers).toEqual([{ questionId: "q_d", value: "2026-07-22" }]);
  });

  it("skips an unanswered field (absent or blank), never posting it", () => {
    // A blank number and an empty string both mean 'no answer given'.
    const { answers } = decodeStepForm(
      form(["__qk__q_n", "number"], ["q_n", ""], ["__qk__q_t", "string"], ["q_t", ""]),
    );
    expect(answers).toEqual([]);
  });

  it("forwards the honeypot decoy (no kind tag) into extras, not answers", () => {
    // The honeypot travels on the no-JS POST: it has no kind tag, so it is routed
    // to `extras` (the caller forwards it to the submit body, where the API's
    // anti-abuse check reads it - 026).
    const { answers, extras } = decodeStepForm(
      form(["__qk__q_bool", "radio"], ["q_bool", "true"], ["website", "spam-bot"]),
    );
    expect(answers).toEqual([{ questionId: "q_bool", value: true }]);
    expect(extras).toEqual({ website: "spam-bot" });
  });

  it("carries an empty honeypot too (a clean submit forwards website='')", () => {
    const { extras } = decodeStepForm(form(["website", ""]));
    expect(extras).toEqual({ website: "" });
  });

  it("does no validation: a non-numeric number decodes to NaN for the API to reject", () => {
    const { answers } = decodeStepForm(form(["__qk__q_n", "number"], ["q_n", "abc"]));
    expect(answers).toHaveLength(1);
    expect(Number.isNaN(answers[0]?.value)).toBe(true);
  });
});
