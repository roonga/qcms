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

/**
 * Clearing without JavaScript (issue #127, Code Owner ruling 2026-09-02).
 *
 * The wire cannot distinguish an emptied field from a never-touched one, so the
 * renderer marks the questions that CURRENTLY HOLD AN ANSWER with a `__qa__<id>`
 * hidden companion. These cases pin the whole of the rule that marker buys, and the
 * pair that matters is the first two: the same empty post decodes to a retraction
 * with the marker and to nothing without it. Either one alone passes on the old
 * behaviour.
 */
describe("decodeStepForm: a marked field submitted empty is a retraction (issue #127)", () => {
  it("decodes an emptied MARKED text field to a null retraction", () => {
    const { answers } = decodeStepForm(
      form(["__qk__q_t", "string"], ["__qa__q_t", "1"], ["q_t", ""]),
    );
    // `null` is the same body the scripted path posts for the same gesture, so the
    // two transports reach one ledger call (ADR-33).
    expect(answers).toEqual([{ questionId: "q_t", value: null }]);
  });

  it("ignores the SAME empty post when the field is not marked", () => {
    const { answers } = decodeStepForm(form(["__qk__q_t", "string"], ["q_t", ""]));
    expect(answers).toEqual([]);
  });

  it("decodes an emptied MARKED multiChoice to a retraction, though it posts nothing at all", () => {
    // An all-unchecked checkbox group contributes NO entry for its name, so this is
    // the case a decoder that walked the posted values could never see. The kind tag
    // and the marker are the only trace of the question in the whole post.
    const { answers } = decodeStepForm(form(["__qk__q_m", "multi"], ["__qa__q_m", "1"]));
    expect(answers).toEqual([{ questionId: "q_m", value: null }]);
  });

  it("ignores an all-unchecked multiChoice that was never answered", () => {
    const { answers } = decodeStepForm(form(["__qk__q_m", "multi"]));
    expect(answers).toEqual([]);
  });

  it("posts the VALUE, not a retraction, when a marked field still carries one", () => {
    // The marker says "there is an answer to clear", never "clear it": a marked
    // field that arrives with content is an ordinary answer revision.
    const { answers } = decodeStepForm(
      form(["__qk__q_t", "string"], ["__qa__q_t", "1"], ["q_t", "Ada"]),
    );
    expect(answers).toEqual([{ questionId: "q_t", value: "Ada" }]);
  });

  it("retracts a marked radio and a marked number that arrive empty, on the same rule", () => {
    // Neither control can actually reach this state without JavaScript (a selected
    // radio has no clear gesture, and a NumberField's value rides a JS-synced hidden
    // input that keeps serializing the seeded answer). The rule is uniform anyway, so
    // the transport carries no per-kind exception for a reader to keep in their head.
    const { answers } = decodeStepForm(
      form(
        ["__qk__q_r", "radio"],
        ["__qa__q_r", "1"],
        ["__qk__q_n", "number"],
        ["__qa__q_n", "1"],
        ["q_n", "   "],
      ),
    );
    expect(answers).toEqual([
      { questionId: "q_r", value: null },
      { questionId: "q_n", value: null },
    ]);
  });

  it("never treats a marker as an answer field or as a honeypot extra", () => {
    // A marker naming a question with no kind tag is not an answer (nothing says how
    // to decode it) and must not fall through to `extras`, where it would reach the
    // API's honeypot check as a filled decoy and get the submission refused.
    const { answers, extras } = decodeStepForm(
      form(["__qa__q_ghost", "1"], ["website", ""], ["__qk__q_t", "string"], ["q_t", "Ada"]),
    );
    expect(answers).toEqual([{ questionId: "q_t", value: "Ada" }]);
    expect(extras).toEqual({ website: "" });
  });

  it("mixes a retraction and a live answer in one whole-step post, in field order", () => {
    const { answers } = decodeStepForm(
      form(
        ["__qk__q_a", "string"],
        ["__qa__q_a", "1"],
        ["q_a", ""],
        ["__qk__q_b", "string"],
        ["q_b", "kept"],
      ),
    );
    expect(answers).toEqual([
      { questionId: "q_a", value: null },
      { questionId: "q_b", value: "kept" },
    ]);
  });
});
