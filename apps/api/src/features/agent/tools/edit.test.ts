import { describe, expect, it } from "vitest";

import { parseFormDefinition, type FormDefinition } from "@roonga/qcms-core";

import { EDITS_PER_TURN } from "../edit-token.js";
import { applyBuilderEdit, type EditOutcome } from "./edit.js";

function draft(): FormDefinition {
  const parsed = parseFormDefinition({
    formId: "frm_edit",
    defaultLocale: "en",
    title: { en: "Quote" },
    steps: [
      {
        stepId: "stp_a",
        title: { en: "A" },
        items: [
          { questionId: "q_a", version: 1 },
          { questionId: "q_b", version: 1 },
        ],
      },
      {
        stepId: "stp_b",
        title: { en: "B" },
        items: [
          { questionId: "q_c", version: 2 },
          {
            groupId: "grp_people",
            label: { en: "People" },
            instanceLabel: { en: "Person {n}" },
            items: [{ questionId: "q_d", version: 1 }],
            count: { source: "fixed", count: 2 },
          },
        ],
      },
    ],
    rules: [{ ruleId: "rul_a", when: { op: "answered", questionId: "q_a" }, show: ["q_b"] }],
  });
  if (!parsed.ok) throw new Error("fixture draft invalid");
  return parsed.value;
}

function applied(outcome: EditOutcome): FormDefinition {
  if (!outcome.ok) throw new Error(`expected the edit to apply: ${outcome.reason}`);
  return outcome.definition;
}

function refusal(outcome: EditOutcome): string {
  if (outcome.ok) throw new Error("expected the edit to be refused");
  return outcome.reason;
}

function pinsOf(definition: FormDefinition, stepIndex: number): unknown[] {
  return (definition.steps[stepIndex]?.items ?? []).map((item) =>
    "questionId" in item ? `${String(item.questionId)}@${String(item.version)}` : item.groupId,
  );
}

describe("the builder's question edits", () => {
  it("pins a library question at a position and leaves the input untouched", () => {
    const before = draft();
    const after = applied(
      applyBuilderEdit(
        before,
        "question",
        { action: "pin", questionId: "q_new", version: 3, stepId: "stp_a", position: 1 },
        0,
      ),
    );
    expect(pinsOf(after, 0)).toEqual(["q_a@1", "q_new@3", "q_b@1"]);
    expect(pinsOf(before, 0)).toEqual(["q_a@1", "q_b@1"]);
  });

  it("repins inside a repeating group, moves a top-level pin and unpins", () => {
    const repinned = applied(
      applyBuilderEdit(draft(), "question", { action: "repin", questionId: "q_d", version: 4 }, 0),
    );
    expect(JSON.stringify(repinned.steps[1])).toContain('"questionId":"q_d","version":4');

    const moved = applied(
      applyBuilderEdit(
        draft(),
        "question",
        { action: "move", questionId: "q_b", stepId: "stp_b", position: 0 },
        0,
      ),
    );
    expect(pinsOf(moved, 0)).toEqual(["q_a@1"]);
    expect(pinsOf(moved, 1)).toEqual(["q_b@1", "q_c@2", "grp_people"]);

    const unpinned = applied(
      applyBuilderEdit(draft(), "question", { action: "unpin", questionId: "q_c" }, 0),
    );
    expect(pinsOf(unpinned, 1)).toEqual(["grp_people"]);
  });

  it.each([
    [{ action: "pin", questionId: "q_a", version: 1, stepId: "stp_b" }, "already on this form"],
    [{ action: "pin", questionId: "q_new", stepId: "stp_a" }, "needs the version"],
    [{ action: "pin", questionId: "q_new", version: 1, stepId: "stp_none" }, "no step stp_none"],
    [{ action: "repin", questionId: "q_none", version: 2 }, "not on this form"],
    [{ action: "move", questionId: "q_d", stepId: "stp_a" }, "inside a repeating group"],
    [{ action: "repin", questionId: "q_a", version: 1 }, "changes nothing"],
    [{ action: "unpin", questionId: "q_d" }, "would no longer parse"],
  ])("refuses %j", (input, reason) => {
    expect(refusal(applyBuilderEdit(draft(), "question", input, 0))).toContain(reason);
  });

  it("refuses arguments that do not parse, rather than throwing", () => {
    expect(
      refusal(applyBuilderEdit(draft(), "question", { action: "pin", questionId: "nope" }, 0)),
    ).not.toBe("");
  });
});

describe("the builder's step, rule and copy edits", () => {
  it("adds, replaces, moves and removes a step", () => {
    const step = {
      stepId: "stp_c",
      title: { en: "C" },
      items: [{ questionId: "q_e", version: 1 }],
    };
    const added = applied(
      applyBuilderEdit(draft(), "step", { action: "add", stepId: "stp_c", step, position: 0 }, 0),
    );
    expect(added.steps.map((s) => s.stepId)).toEqual(["stp_c", "stp_a", "stp_b"]);

    const replaced = applied(
      applyBuilderEdit(
        draft(),
        "step",
        { action: "replace", stepId: "stp_a", step: { ...step, stepId: "stp_a" } },
        0,
      ),
    );
    expect(pinsOf(replaced, 0)).toEqual(["q_e@1"]);

    const moved = applied(
      applyBuilderEdit(draft(), "step", { action: "move", stepId: "stp_b", position: 0 }, 0),
    );
    expect(moved.steps.map((s) => s.stepId)).toEqual(["stp_b", "stp_a"]);

    const removed = applied(
      applyBuilderEdit(draft(), "step", { action: "remove", stepId: "stp_a" }, 0),
    );
    expect(removed.steps.map((s) => s.stepId)).toEqual(["stp_b"]);
  });

  it("keeps a step's id bound to its argument and a form's last step in place", () => {
    const step = {
      stepId: "stp_x",
      title: { en: "X" },
      items: [{ questionId: "q_e", version: 1 }],
    };
    expect(
      refusal(applyBuilderEdit(draft(), "step", { action: "add", stepId: "stp_c", step }, 0)),
    ).toContain("must equal stepId");
    const one = applied(
      applyBuilderEdit(draft(), "step", { action: "remove", stepId: "stp_a" }, 0),
    );
    expect(
      refusal(applyBuilderEdit(one, "step", { action: "remove", stepId: "stp_b" }, 0)),
    ).toContain("at least one step");
  });

  it("sets and removes a rule by its id", () => {
    const rule = { ruleId: "rul_b", when: { op: "answered", questionId: "q_c" }, show: ["q_d"] };
    const set = applied(
      applyBuilderEdit(draft(), "rule", { action: "set", ruleId: "rul_b", rule }, 0),
    );
    expect(set.rules.map((r) => r.ruleId)).toEqual(["rul_a", "rul_b"]);
    const removed = applied(
      applyBuilderEdit(draft(), "rule", { action: "remove", ruleId: "rul_a" }, 0),
    );
    expect(removed.rules).toEqual([]);
    expect(
      refusal(applyBuilderEdit(draft(), "rule", { action: "remove", ruleId: "rul_none" }, 0)),
    ).toContain("no rule");
  });

  it("changes wording only where it is pointed", () => {
    const title = applied(
      applyBuilderEdit(draft(), "copy", { target: "form-title", text: { en: "New" } }, 0),
    );
    expect(title.title).toEqual({ en: "New" });
    const label = applied(
      applyBuilderEdit(
        draft(),
        "copy",
        { target: "group-instance-label", groupId: "grp_people", text: { en: "Driver {n}" } },
        0,
      ),
    );
    expect(JSON.stringify(label.steps[1])).toContain("Driver {n}");
    expect(
      refusal(applyBuilderEdit(draft(), "copy", { target: "step-title", text: { en: "x" } }, 0)),
    ).toContain("needs a stepId");
  });
});

describe("the per-turn cap", () => {
  it("refuses the edit past the cap without applying it", () => {
    const input = { target: "form-title", text: { en: "Again" } };
    expect(applyBuilderEdit(draft(), "copy", input, EDITS_PER_TURN - 1).ok).toBe(true);
    expect(refusal(applyBuilderEdit(draft(), "copy", input, EDITS_PER_TURN))).toContain(
      String(EDITS_PER_TURN),
    );
  });
});
