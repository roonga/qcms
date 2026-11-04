import { describe, expect, it } from "vitest";

import {
  addGroup,
  addPinAt,
  addPinToGroup,
  addRule,
  addStep,
  blankDraft,
  countBounds,
  draftDocumentOrder,
  draftGroups,
  eligibleTargets,
  findGroup,
  instanceNoun,
  moveGroupWithinStep,
  movePin,
  movePinWithinGroup,
  movePinWithinStep,
  pinnedQuestionIds,
  questionGroupIds,
  removeGroup,
  removePin,
  removeStep,
  renameGroup,
  setGroupCount,
  setGroupInstanceLabel,
  setGroupPresentation,
  stepPins,
  unsaveableReason,
  updateRule,
} from "./draft.ts";
import type { DraftForm } from "./types.ts";

function withGroup(): { draft: DraftForm; stepId: string; groupId: string } {
  let draft = addStep(blankDraft("frm_booking"), "Travellers");
  const stepId = draft.steps[0]?.stepId ?? "";
  draft = addGroup(draft, stepId, "Passengers");
  const groupId = draftGroups(draft)[0]?.groupId ?? "";
  draft = addPinToGroup(draft, groupId, "q_full_name", 1);
  draft = addPinToGroup(draft, groupId, "q_passport", 2);
  return { draft, stepId, groupId };
}

describe("addGroup", () => {
  it("mints a readable id from the name and starts the group empty", () => {
    const { draft, groupId } = withGroup();

    expect(groupId).toBe("grp_passengers");
    const group = findGroup(draft, groupId)?.group;
    expect(group?.label).toStrictEqual({ en: "Passengers" });
    expect(group?.presentation, "stacked is the kernel's own default").toBe("stacked");
  });

  it("seeds the instance heading from the author's own words, with the one placeholder", () => {
    const { draft, groupId } = withGroup();

    expect(findGroup(draft, groupId)?.group.instanceLabel).toStrictEqual({
      en: "Passengers {n}",
    });
  });

  it("starts with NO maximum, which is the one state publish refuses", () => {
    const { draft, groupId } = withGroup();
    const count = findGroup(draft, groupId)?.group.count;

    expect(count).toStrictEqual({ source: "open", min: 1 });
    expect(countBounds(count ?? { source: "open", min: 1 }).max).toBeUndefined();
  });

  it("suffixes when a live group already holds the id", () => {
    const { draft, stepId } = withGroup();
    const next = addGroup(draft, stepId, "Passengers");

    expect(draftGroups(next).map((group) => group.groupId)).toStrictEqual([
      "grp_passengers",
      "grp_passengers_2",
    ]);
  });

  it("does not re-mint an id a dangling condition still reads", () => {
    const { draft, stepId, groupId } = withGroup();
    let built = addRule(draft, "q_full_name");
    const rule = built.rules[0];
    if (rule === undefined) throw new Error("addRule did not append a rule");
    built = updateRule(built, rule.ruleId, {
      ...rule,
      when: { op: "instanceCount", groupId, compare: "gte", value: 2 },
      show: ["q_declaration"],
    });

    const removed = removeGroup(built, groupId);
    expect(draftGroups(removed)).toHaveLength(0);
    expect(removed.rules[0]?.when).toMatchObject({ groupId });

    const reAdded = addGroup(removed, stepId, "Passengers");
    expect(draftGroups(reAdded)[0]?.groupId).toBe("grp_passengers_2");
  });
});

describe("removeGroup", () => {
  it("takes its member pins with it and leaves the rules alone", () => {
    const { draft, groupId } = withGroup();
    const next = removeGroup(draft, groupId);

    expect(pinnedQuestionIds(next)).toStrictEqual([]);
    expect(next.steps[0]?.items).toStrictEqual([]);
  });

  it("leaves a pin the step holds directly in place", () => {
    const { draft, stepId, groupId } = withGroup();
    const withSibling = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);

    expect(pinnedQuestionIds(removeGroup(withSibling, groupId))).toStrictEqual(["q_trip_purpose"]);
  });
});

describe("addPinToGroup", () => {
  it("appends by default and inserts at a boundary when given one", () => {
    const { draft, groupId } = withGroup();
    const next = addPinToGroup(draft, groupId, "q_dob", 1, 1);

    expect(findGroup(next, groupId)?.group.items.map((pin) => pin.questionId)).toStrictEqual([
      "q_full_name",
      "q_dob",
      "q_passport",
    ]);
  });

  it("refuses a question the form already pins anywhere", () => {
    const { draft, stepId, groupId } = withGroup();
    const beside = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);

    expect(addPinToGroup(beside, groupId, "q_trip_purpose", 1)).toBe(beside);
    expect(addPinToGroup(beside, groupId, "q_passport", 3)).toBe(beside);
  });
});

describe("movePinWithinGroup", () => {
  it("swaps two members and refuses to move past either end", () => {
    const { draft, groupId } = withGroup();
    const moved = movePinWithinGroup(draft, groupId, "q_passport", -1);

    expect(findGroup(moved, groupId)?.group.items.map((pin) => pin.questionId)).toStrictEqual([
      "q_passport",
      "q_full_name",
    ]);
    expect(movePinWithinGroup(moved, groupId, "q_passport", -1)).toStrictEqual(moved);
  });

  it("never moves a member out of its group", () => {
    const { draft, stepId, groupId } = withGroup();
    const withSibling = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);

    const attempted = movePinWithinGroup(withSibling, groupId, "q_full_name", -1);
    expect(questionGroupIds(attempted).get("q_full_name")).toBe(groupId);
    expect(questionGroupIds(attempted).get("q_trip_purpose")).toBeUndefined();
  });
});

describe("movePinWithinStep and moveGroupWithinStep", () => {
  it("treats a whole group as one neighbour of a step's own pin", () => {
    const { draft, stepId, groupId } = withGroup();
    const withSibling = addPinAt(draft, stepId, "q_trip_purpose", 1, 1);

    const moved = movePinWithinStep(withSibling, stepId, "q_trip_purpose", -1);
    expect(
      moved.steps[0]?.items.map((item) => ("groupId" in item ? item.groupId : item.questionId)),
    ).toStrictEqual(["q_trip_purpose", groupId]);
    expect(questionGroupIds(moved).get("q_trip_purpose")).toBeUndefined();
  });

  it("moves a whole group within its step, which is what moves its span", () => {
    const { draft, stepId, groupId } = withGroup();
    const withSibling = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);

    const moved = moveGroupWithinStep(withSibling, stepId, groupId, -1);
    expect(
      moved.steps[0]?.items.map((item) => ("groupId" in item ? item.groupId : item.questionId)),
    ).toStrictEqual([groupId, "q_trip_purpose"]);
    expect(moveGroupWithinStep(moved, stepId, groupId, -1)).toStrictEqual(moved);
  });
});

describe("setGroupCount", () => {
  it("replaces the whole count, so no source keeps another's fields", () => {
    const { draft, groupId } = withGroup();
    const fixed = setGroupCount(draft, groupId, { source: "fixed", count: 3 });

    expect(findGroup(fixed, groupId)?.group.count).toStrictEqual({ source: "fixed", count: 3 });

    expect(countBounds({ source: "fixed", count: 3 })).toStrictEqual({ min: 3, max: 3 });

    const bounded = setGroupCount(fixed, groupId, { source: "open", min: 1, max: 9 });
    expect(findGroup(bounded, groupId)?.group.count).toStrictEqual({
      source: "open",
      min: 1,
      max: 9,
    });
  });

  it("carries a `fromAnswer` source's question and bounds together", () => {
    const { draft, groupId } = withGroup();
    const next = setGroupCount(draft, groupId, {
      source: "fromAnswer",
      questionId: "q_passenger_count",
      min: 1,
      max: 9,
    });

    expect(
      countBounds(findGroup(next, groupId)?.group.count ?? { source: "open", min: 0 }),
    ).toStrictEqual({ min: 1, max: 9 });
  });
});

describe("setGroupPresentation", () => {
  it("changes one field and nothing else, which is the whole of ADR-42's argument", () => {
    const { draft, groupId } = withGroup();
    const table = setGroupPresentation(draft, groupId, "table");
    const stepView = setGroupPresentation(table, groupId, "perInstanceStep");

    expect(findGroup(table, groupId)?.group.presentation).toBe("table");
    expect(findGroup(stepView, groupId)?.group.presentation).toBe("perInstanceStep");

    expect(findGroup(stepView, groupId)?.group.items).toStrictEqual(
      findGroup(draft, groupId)?.group.items,
    );
    expect(findGroup(stepView, groupId)?.group.count).toStrictEqual(
      findGroup(draft, groupId)?.group.count,
    );
  });
});

describe("renameGroup and setGroupInstanceLabel", () => {
  it("renames without touching the id a condition may read", () => {
    const { draft, groupId } = withGroup();
    const next = renameGroup(draft, groupId, "Travellers");

    expect(findGroup(next, groupId)?.group.label).toStrictEqual({ en: "Travellers" });
    expect(draftGroups(next)[0]?.groupId).toBe(groupId);
  });

  it("stores an instance heading verbatim, including a placeholder publish refuses", () => {
    const { draft, groupId } = withGroup();
    const next = setGroupInstanceLabel(draft, groupId, "Passenger {index}");

    expect(findGroup(next, groupId)?.group.instanceLabel).toStrictEqual({
      en: "Passenger {index}",
    });
  });
});

describe("instanceNoun", () => {
  it("reads the author's own instance heading, with the placeholder stripped", () => {
    const { draft, groupId } = withGroup();
    const named = setGroupInstanceLabel(draft, groupId, "Passenger {n}");
    const group = findGroup(named, groupId)?.group;
    if (group === undefined) throw new Error("the group went missing");

    expect(instanceNoun(group)).toBe("Passenger");
  });

  it("falls back to the group's label, and then to its id", () => {
    const { draft, groupId } = withGroup();
    const blank = setGroupInstanceLabel(draft, groupId, "");
    const blankGroup = findGroup(blank, groupId)?.group;
    if (blankGroup === undefined) throw new Error("the group went missing");
    expect(instanceNoun(blankGroup)).toBe("Passengers");

    const unnamed = renameGroup(blank, groupId, "");
    const unnamedGroup = findGroup(unnamed, groupId)?.group;
    if (unnamedGroup === undefined) throw new Error("the group went missing");
    expect(instanceNoun(unnamedGroup)).toBe(groupId);
  });
});

describe("the pin helpers reaching inside a group", () => {
  it("lists, repoints and unpins a member exactly as it does a step's own pin", () => {
    const { draft, stepId, groupId } = withGroup();
    const built = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);

    expect(pinnedQuestionIds(built)).toStrictEqual(["q_trip_purpose", "q_full_name", "q_passport"]);
    expect(
      stepPins(built.steps[0] ?? { stepId, title: {}, items: [] }).map((p) => p.version),
    ).toStrictEqual([1, 1, 2]);

    const moved = movePin(built, "q_passport", 3);
    expect(findGroup(moved, groupId)?.group.items).toStrictEqual([
      { questionId: "q_full_name", version: 1 },
      { questionId: "q_passport", version: 3 },
    ]);

    const unpinned = removePin(moved, "q_full_name");
    expect(findGroup(unpinned, groupId)?.group.items).toStrictEqual([
      { questionId: "q_passport", version: 3 },
    ]);
    expect(unpinned.steps[0]?.items, "the group itself survives losing a member").toHaveLength(2);
  });

  it("maps each member question to the group that holds it, and nothing else", () => {
    const { draft, stepId, groupId } = withGroup();
    const built = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);
    const map = questionGroupIds(built);

    expect(map.get("q_full_name")).toBe(groupId);
    expect(map.get("q_passport")).toBe(groupId);
    expect(map.get("q_trip_purpose")).toBeUndefined();
  });
});

describe("draftDocumentOrder with a group in it", () => {
  it("expands a group into a contiguous span of its members, in order", () => {
    const { draft, stepId, groupId } = withGroup();
    const built = addPinAt(
      addPinAt(draft, stepId, "q_trip_purpose", 1, 0),
      stepId,
      "q_notes",
      1,
      2,
    );

    expect(
      draftDocumentOrder(built).map((entry) => [entry.questionId, entry.groupId]),
    ).toStrictEqual([
      ["q_trip_purpose", undefined],
      ["q_full_name", groupId],
      ["q_passport", groupId],
      ["q_notes", undefined],
    ]);
  });
});

describe("eligibleTargets over a span", () => {
  function spanned(): { draft: DraftForm; groupId: string } {
    const { draft, stepId, groupId } = withGroup();
    const built = addPinAt(
      addPinAt(draft, stepId, "q_trip_purpose", 1, 0),
      stepId,
      "q_notes",
      1,
      2,
    );
    return { draft: built, groupId };
  }

  it("cuts at the question's own position for a BARE in-group reference", () => {
    const { draft } = spanned();

    expect(eligibleTargets(draft, ["q_full_name"]).questions).toStrictEqual([
      "q_passport",
      "q_notes",
    ]);
  });

  it("cuts at the SPAN's end for a whole-group read", () => {
    const { draft, groupId } = spanned();

    expect(eligibleTargets(draft, [], [groupId]).questions).toStrictEqual(["q_notes"]);
  });

  it("ignores a group the draft does not declare rather than cutting on it", () => {
    const { draft } = spanned();

    expect(eligibleTargets(draft, [], ["grp_nowhere"]).questions).toHaveLength(4);
  });

  it("offers a step only when every question in it, group members included, is eligible", () => {
    const { draft, stepId, groupId } = withGroup();
    const later = addStep(draft, "Declaration");
    const laterStepId = later.steps[1]?.stepId ?? "";
    const built = addPinAt(later, laterStepId, "q_declaration", 1, 0);

    expect(eligibleTargets(built, [], [groupId]).steps).toStrictEqual([laterStepId]);
    expect(eligibleTargets(built, ["q_full_name"]).steps).not.toContain(stepId);
  });
});

describe("unsaveableReason", () => {
  it("pauses on a group with no member, as it does on a step with no pin", () => {
    let draft = addStep(blankDraft("frm_booking"), "Travellers");
    const stepId = draft.steps[0]?.stepId ?? "";
    draft = addPinAt(draft, stepId, "q_trip_purpose", 1, 0);
    expect(unsaveableReason(draft)).toBeUndefined();

    const withEmptyGroup = addGroup(draft, stepId, "Passengers");
    expect(unsaveableReason(withEmptyGroup)).toBe("emptyGroup");

    const filled = addPinToGroup(withEmptyGroup, "grp_passengers", "q_full_name", 1);
    expect(unsaveableReason(filled)).toBeUndefined();
  });

  it("still reports an empty step first, because a step with no items has no group either", () => {
    const draft = addStep(blankDraft("frm_booking"), "Travellers");
    expect(unsaveableReason(draft)).toBe("emptyStep");
    expect(unsaveableReason(removeStep(draft, draft.steps[0]?.stepId ?? ""))).toBe("noSteps");
  });
});
