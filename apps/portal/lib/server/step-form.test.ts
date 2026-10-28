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
    const { answers } = decodeStepForm(
      form(["__qk__q_n", "number"], ["q_n", ""], ["__qk__q_t", "string"], ["q_t", ""]),
    );
    expect(answers).toEqual([]);
  });

  it("forwards the honeypot decoy (no kind tag) into extras, not answers", () => {
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
    expect(answers).toEqual([{ questionId: "q_t", value: null }]);
  });

  it("ignores the SAME empty post when the field is not marked", () => {
    const { answers } = decodeStepForm(form(["__qk__q_t", "string"], ["q_t", ""]));
    expect(answers).toEqual([]);
  });

  it("decodes an emptied MARKED multiChoice to a retraction, though it posts nothing at all", () => {
    const { answers } = decodeStepForm(form(["__qk__q_m", "multi"], ["__qa__q_m", "1"]));
    expect(answers).toEqual([{ questionId: "q_m", value: null }]);
  });

  it("ignores an all-unchecked multiChoice that was never answered", () => {
    const { answers } = decodeStepForm(form(["__qk__q_m", "multi"]));
    expect(answers).toEqual([]);
  });

  it("posts the VALUE, not a retraction, when a marked field still carries one", () => {
    const { answers } = decodeStepForm(
      form(["__qk__q_t", "string"], ["__qa__q_t", "1"], ["q_t", "Ada"]),
    );
    expect(answers).toEqual([{ questionId: "q_t", value: "Ada" }]);
  });

  it("retracts a marked radio and a marked number that arrive empty, on the same rule", () => {
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

/**
 * The fields the posted form ASKED, whether or not they carried a value (issue
 * #920). `answers` cannot answer that question: a blank required field contributes
 * no answer at all, and the caller has to narrow the API's flow-wide
 * missing-required set to the step the respondent was actually looking at.
 */
describe("decodeStepForm reports the questions the form asked (issue #920)", () => {
  it("lists every kind-tagged field in document order, valued or not", () => {
    const { fields, answers } = decodeStepForm(
      form(
        ["__qk__q_full_name", "string"],
        ["q_full_name", "Ada Lovelace"],
        ["__qk__q_dob", "string"],
        ["q_dob", ""],
        ["__qk__q_conditions", "multi"],
        ["website", ""],
      ),
    );
    expect(fields).toEqual(["q_full_name", "q_dob", "q_conditions"]);
    expect(answers).toEqual([{ questionId: "q_full_name", value: "Ada Lovelace" }]);
  });

  it("excludes the honeypot and any other untagged field", () => {
    const { fields, extras } = decodeStepForm(form(["website", "spam"], ["__qk__q_a", "string"]));
    expect(fields).toEqual(["q_a"]);
    expect(extras).toEqual({ website: "spam" });
  });

  it("is empty for a post with no answer fields at all", () => {
    expect(decodeStepForm(form(["website", ""])).fields).toEqual([]);
  });
});

describe("the roster operation, the fourth reserved name (task 073, ADR-43)", () => {
  it("decodes the pressed Add button", () => {
    const { rosterOp, answers } = decodeStepForm(
      form(["__qk__q_t", "string"], ["q_t", "Ada"], ["__qop", "add:grp_vehicles:op_7f3"]),
    );
    expect(rosterOp).toEqual({ op: "add", groupId: "grp_vehicles", token: "op_7f3" });
    expect(answers).toEqual([{ questionId: "q_t", value: "Ada" }]);
  });

  it("decodes the pressed Remove button, instance and all", () => {
    const { rosterOp } = decodeStepForm(form(["__qop", "remove:grp_vehicles:ins_7k2:op_7f3"]));
    expect(rosterOp).toEqual({
      op: "remove",
      groupId: "grp_vehicles",
      instanceId: "ins_7k2",
      token: "op_7f3",
    });
  });

  it("is absent on an ordinary Continue", () => {
    expect(decodeStepForm(form(["__qk__q_t", "string"], ["q_t", "Ada"])).rosterOp).toBeUndefined();
  });

  it("never lands in extras and is never read as an answer", () => {
    const { extras, answers, fields } = decodeStepForm(
      form(["__qop", "add:grp_vehicles:op_7f3"], ["website", ""]),
    );
    expect(extras).toEqual({ website: "" });
    expect(answers).toEqual([]);
    expect(fields).toEqual([]);
  });

  it("drops a value that is not exactly the shape the buttons write", () => {
    for (const hostile of ["", "add", "add:grp:op:extra", "remove:grp:op_7f3", "drop:grp:op_7f3"]) {
      expect(decodeStepForm(form(["__qop", hostile])).rosterOp, hostile).toBeUndefined();
    }
  });

  it("takes the first of two, which a browser cannot produce", () => {
    const { rosterOp } = decodeStepForm(
      form(["__qop", "add:grp_a:op_1"], ["__qop", "add:grp_b:op_2"]),
    );
    expect(rosterOp).toEqual({ op: "add", groupId: "grp_a", token: "op_1" });
  });

  it("carries instance-qualified field names through unchanged", () => {
    const { answers, fields } = decodeStepForm(
      form(
        ["__qk__ins_7k2/q_plate", "string"],
        ["ins_7k2/q_plate", "ABC123"],
        ["__qk__ins_9m4/q_plate", "string"],
        ["__qa__ins_9m4/q_plate", "1"],
        ["ins_9m4/q_plate", ""],
      ),
    );
    expect(fields).toEqual(["ins_7k2/q_plate", "ins_9m4/q_plate"]);
    expect(answers).toEqual([
      { questionId: "ins_7k2/q_plate", value: "ABC123" },
      { questionId: "ins_9m4/q_plate", value: null },
    ]);
  });
});

describe("decodeStepForm: the no-JS date's three parts (Code Owner, 2026-10-19)", () => {
  it("joins the day, month and year boxes into the ISO day, whatever order they posted in", () => {
    const decoded = decodeStepForm(
      form(
        ["__qdm__q_dob", "5"],
        ["__qdd__q_dob", "17"],
        ["__qdy__q_dob", "1990"],
        ["__qk__q_dob", "date"],
      ),
    );
    expect(decoded.answers).toEqual([{ questionId: "q_dob", value: "1990-05-17" }]);
    expect(decoded.fields).toEqual(["q_dob"]);
    expect(decoded.extras).toEqual({});
  });

  it("reads three blank boxes as absence, and as a retraction when marked answered", () => {
    const blank: [string, string][] = [
      ["__qdd__q_dob", ""],
      ["__qdm__q_dob", ""],
      ["__qdy__q_dob", ""],
      ["__qk__q_dob", "date"],
    ];
    expect(decodeStepForm(form(...blank)).answers).toEqual([]);
    const cleared = decodeStepForm(form(...blank, ["__qa__q_dob", "1"]));
    expect(cleared.answers).toEqual([{ questionId: "q_dob", value: null }]);
    expect(cleared.cleared).toEqual({ q_dob: "date" });
  });

  it("passes a partial date through for the API to refuse rather than judging it", () => {
    const decoded = decodeStepForm(
      form(
        ["__qdd__q_dob", "5"],
        ["__qdm__q_dob", ""],
        ["__qdy__q_dob", "1990"],
        ["__qk__q_dob", "date"],
      ),
    );
    expect(decoded.answers).toEqual([{ questionId: "q_dob", value: "1990--05" }]);
  });

  it("still decodes the earlier single-field shape under the `string` kind", () => {
    const decoded = decodeStepForm(form(["q_dob", "1990-05-17"], ["__qk__q_dob", "string"]));
    expect(decoded.answers).toEqual([{ questionId: "q_dob", value: "1990-05-17" }]);
  });
});
