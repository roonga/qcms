import { describe, expect, it } from "vitest";

import type { ReadState } from "../read-state.ts";

import {
  anchorFor,
  groupAnchorId,
  issuesForGroup,
  messageForIssue,
  parseIssues,
  stepIssueCounts,
  stepOwningAnchor,
} from "./issues.ts";
import { stepGridRows } from "./pin-grid.ts";
import { formSubtreeRail, railStepItems } from "./subtree-rail.ts";
import type { DraftForm, FormIssue, PinnableQuestion } from "./types.ts";

/**
 * The repeating group as the screens report it (task 074, ADR-42).
 *
 * Four things are asserted here and each one is a way the group could be invisible on a screen
 * that is otherwise working:
 *
 * 1. **The grid states the span.** A group is a contiguous run of pins, so the grid's rows are a
 *    boundary followed by its members, with every position counted against the CONTAINER - which
 *    is what makes Move up at a group's first member a no-op rather than a move out of the group.
 * 2. **A group that cannot be published says so where it is listed.** `max` is required on both
 *    bounded count sources (Q4 as amended by Q14) and the boundary row flags its absence from the
 *    draft alone, before any round trip.
 * 3. **A group-scoped refusal has somewhere to land.** Eight publish codes name a group and no
 *    question, so without an anchor of its own every one of them would render in the validation
 *    panel as plain text with nothing to move focus to.
 * 4. **The two composed sentences say what they have to say.** `RULE_TARGETS_SPAN_SCOPES` names
 *    the mechanical remedy, and `REPEAT_EVALUATION_BUDGET_EXCEEDED` says what it is NOT about -
 *    because the obvious reading of a refusal quoting two maxima is "my group is too big", and
 *    the author's next act would be to shrink a group for no reason.
 */

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_passport",
    slug: "passport",
    label: { en: "Passport number" },
    type: "shortText",
    versions: [
      {
        version: 1,
        status: "published",
        definition: {
          questionId: "q_passport",
          type: "shortText",
          label: { en: "Passport number" },
        },
      },
    ],
  },
  {
    questionId: "q_dob",
    slug: "dob",
    label: { en: "Date of birth" },
    type: "date",
    versions: [
      {
        version: 1,
        status: "published",
        definition: { questionId: "q_dob", type: "date", label: { en: "Date of birth" } },
      },
    ],
  },
  {
    questionId: "q_trip",
    slug: "trip",
    label: { en: "Trip purpose" },
    type: "shortText",
    versions: [
      {
        version: 1,
        status: "published",
        definition: { questionId: "q_trip", type: "shortText", label: { en: "Trip purpose" } },
      },
    ],
  },
];

const READ: ReadState<readonly PinnableQuestion[]> = { ok: true, data: LIBRARY };

/** A step holding one pin, then a two-member group whose `max` is set. */
function draftWith(max: number | undefined): DraftForm {
  return {
    formId: "frm_booking",
    defaultLocale: "en",
    title: { en: "Booking" },
    steps: [
      {
        stepId: "stp_travellers",
        title: { en: "Travellers" },
        items: [
          { questionId: "q_trip", version: 1 },
          {
            groupId: "grp_passengers",
            label: { en: "Passengers" },
            instanceLabel: { en: "Passenger {n}" },
            items: [
              { questionId: "q_passport", version: 1 },
              { questionId: "q_dob", version: 1 },
            ],
            count: max === undefined ? { source: "open", min: 1 } : { source: "open", min: 1, max },
            presentation: "stacked",
          },
        ],
      },
    ],
    rules: [],
  };
}

describe("stepGridRows", () => {
  it("draws a boundary row, then the group's members, with the step's own pin outside it", () => {
    const draft = draftWith(9);
    const step = draft.steps[0];
    if (step === undefined) throw new Error("the fixture lost its step");
    const rows = stepGridRows(step, READ, []);

    expect(
      rows.map((row) => (row.kind === "group" ? `group:${row.group.groupId}` : row.pin.questionId)),
    ).toStrictEqual(["q_trip", "group:grp_passengers", "q_passport", "q_dob"]);
  });

  it("counts every position against its own container, not against the step", () => {
    const draft = draftWith(9);
    const step = draft.steps[0];
    if (step === undefined) throw new Error("the fixture lost its step");
    const rows = stepGridRows(step, READ, []);
    const pins = rows.flatMap((row) => (row.kind === "pin" ? [row.pin] : []));

    // The step's own pin is 1 of 1 - a group is ONE neighbour of it, not a run of two - and each
    // member is counted among the group's members. That is what makes the row menu's Move up
    // disabled at a group's first member rather than moving the pin out of the group.
    expect(pins.map((pin) => [pin.questionId, pin.position, pin.total, pin.groupId])).toStrictEqual([
      ["q_trip", 1, 1, undefined],
      ["q_passport", 1, 2, "grp_passengers"],
      ["q_dob", 2, 2, "grp_passengers"],
    ]);
  });

  it("states the count source and the member count on the boundary", () => {
    const draft = draftWith(9);
    const step = draft.steps[0];
    if (step === undefined) throw new Error("the fixture lost its step");
    const boundary = stepGridRows(step, READ, []).find((row) => row.kind === "group");

    expect(boundary?.kind === "group" ? boundary.group : undefined).toMatchObject({
      label: "Passengers",
      members: 2,
      memberSummary: "2 questions",
      countSummary: "respondent adds, 1 to 9",
      presentation: "stacked",
      maxMissing: false,
      position: 2,
      total: 2,
    });
  });

  it("flags a bounded group with no maximum, from the draft rather than from a verdict", () => {
    const step = draftWith(undefined).steps[0];
    if (step === undefined) throw new Error("the fixture lost its step");
    const boundary = stepGridRows(step, READ, []).find((row) => row.kind === "group");

    // `max` is the only limit on how many instances a respondent can create (SEC-16), so the grid
    // says so where a step is scanned rather than leaving `REPEAT_MAX_MISSING` to arrive at
    // publish. A range reading "1 to " would look like a rendering fault instead.
    expect(boundary?.kind === "group" ? boundary.group.maxMissing : undefined).toBe(true);
    expect(boundary?.kind === "group" ? boundary.group.countSummary : "").toBe(
      "respondent adds, no maximum set",
    );
  });

  it("shows a fixed count as its own bound, with no maximum at all", () => {
    const draft = draftWith(9);
    const step = draft.steps[0];
    if (step === undefined) throw new Error("the fixture lost its step");
    const fixed = {
      ...step,
      items: step.items.map((item) =>
        "groupId" in item ? { ...item, count: { source: "fixed" as const, count: 3 } } : item,
      ),
    };
    const boundary = stepGridRows(fixed, READ, []).find((row) => row.kind === "group");

    expect(boundary?.kind === "group" ? boundary.group.countSummary : "").toBe("always 3");
    expect(boundary?.kind === "group" ? boundary.group.maxMissing : true).toBe(false);
  });
});

describe("a group-scoped issue", () => {
  const BOUNDS: FormIssue = {
    code: "REPEAT_MAX_MISSING",
    message: "from the kernel",
    path: { group: "grp_passengers", step: "stp_travellers" },
  };

  it("lands on the group's own anchor, and on the step that renders it", () => {
    const draft = draftWith(undefined);

    expect(anchorFor(BOUNDS, draft)).toBe(groupAnchorId("grp_passengers"));
    expect(stepOwningAnchor(BOUNDS, draft)).toBe("stp_travellers");
  });

  it("claims no anchor for a group the draft no longer declares", () => {
    const draft = draftWith(undefined);
    const gone: FormIssue = { ...BOUNDS, path: { group: "grp_gone" } };

    // The same rule a `DANGLING_QUESTION_REF` follows: an anchor for something not on screen is a
    // link to nothing, and the panel renders those as plain text instead.
    expect(anchorFor(gone, draft)).toBeUndefined();
  });

  it("counts against its step exactly once", () => {
    const counts = stepIssueCounts([BOUNDS], draftWith(undefined));

    expect([...counts.entries()]).toStrictEqual([["stp_travellers", 1]]);
  });

  it("is shown on the group's own panel, and a rule's issue about it is not", () => {
    const ruleIssue: FormIssue = {
      code: "DANGLING_GROUP_REF",
      message: "from the kernel",
      path: { rule: "rul_one", group: "grp_passengers" },
    };

    // A rule issue naming a group is a statement about the RULE. Showing it on the group's panel
    // would invite an author to change the group's bounds to fix a rule.
    expect(issuesForGroup([BOUNDS, ruleIssue], "grp_passengers")).toStrictEqual([BOUNDS]);
  });
});

describe("the two refusals the admin composes rather than quotes", () => {
  it("tells the author to split a rule whose targets straddle two scopes", () => {
    const draft = draftWith(9);
    const sentence = messageForIssue(
      {
        code: "RULE_TARGETS_SPAN_SCOPES",
        message: "from the kernel",
        path: { rule: "rul_one", scopes: ["grp_passengers", "form"] },
      },
      draft,
    );

    // The remedy is mechanical and saying so is the point: the condition is copyable and neither
    // half's meaning changes, so an author told only that the rule is refused has nowhere to go.
    expect(sentence).toContain("Passengers");
    expect(sentence).toContain("outside every repeating group");
    expect(sentence).toContain("split it into two");
  });

  it("names both groups, both maxima and the product - and what the refusal is NOT about", () => {
    const draft: DraftForm = {
      ...draftWith(9),
      steps: [
        ...draftWith(9).steps,
        {
          stepId: "stp_bags",
          title: { en: "Bags" },
          items: [
            {
              groupId: "grp_bags",
              label: { en: "Bags" },
              instanceLabel: { en: "Bag {n}" },
              items: [{ questionId: "q_dob", version: 1 }],
              count: { source: "open", min: 0, max: 5000 },
              presentation: "stacked",
            },
          ],
        },
      ],
    };
    const sentence = messageForIssue(
      {
        code: "REPEAT_EVALUATION_BUDGET_EXCEEDED",
        message: "from the kernel",
        path: { rule: "rul_one", targetGroup: "grp_bags", readGroup: "grp_passengers" },
      },
      draft,
    );

    expect(sentence).toContain("Bags");
    expect(sentence).toContain("5000");
    expect(sentence).toContain("Passengers");
    expect(sentence).toContain("9");
    expect(sentence, "the product of the two declared maxima").toContain("45000");
    expect(sentence).toContain("10000");
    // The sentence that stops an author shrinking a group for no reason: there is no
    // installation-wide ceiling (Q14) and this caps no group's maximum.
    expect(sentence).toContain("not about either group's size");
  });

  it("renders with ids and a stand-in when no draft is to hand", () => {
    const sentence = messageForIssue({
      code: "REPEAT_EVALUATION_BUDGET_EXCEEDED",
      message: "from the kernel",
      path: { rule: "rul_one", targetGroup: "grp_bags", readGroup: "grp_passengers" },
    });

    expect(sentence).toContain("grp_bags");
    expect(sentence).toContain("?");
  });

  it("has a sentence for every repeating-group code, rather than the unknown fallback", () => {
    for (const code of [
      "DUPLICATE_GROUP_ID",
      "DANGLING_GROUP_REF",
      "REPEAT_MAX_MISSING",
      "REPEAT_MIN_ABOVE_MAX",
      "REPEAT_NESTING_NOT_ALLOWED",
      "REPEAT_COUNT_BACKWARD_REF",
      "REPEAT_COUNT_NOT_A_NUMBER",
      "REPEAT_COUNT_INSIDE_GROUP",
      "INSTANCE_LABEL_PLACEHOLDER_UNKNOWN",
      "REPEAT_OPERATOR_NESTING_NOT_ALLOWED",
      "RULE_READS_GROUP_WITHOUT_OPERATOR",
      "RULE_TARGETS_SPAN_SCOPES",
      "REPEAT_EVALUATION_BUDGET_EXCEEDED",
      "TABLE_COLUMN_TYPE_NOT_ALLOWED",
    ]) {
      const sentence = messageForIssue({ code, message: "from the kernel" }, draftWith(9));
      expect(sentence, code).not.toContain("no wording for");
    }
  });

  it("carries the group-shaped path fields off the wire", () => {
    const parsed = parseIssues([
      {
        code: "RULE_TARGETS_SPAN_SCOPES",
        message: "m",
        path: { rule: "rul_one", scopes: ["grp_a", "form"] },
      },
      {
        code: "REPEAT_OPERATOR_NESTING_NOT_ALLOWED",
        message: "m",
        path: { rule: "rul_one", outerGroup: "grp_a", innerGroup: "grp_b" },
      },
      {
        code: "INSTANCE_LABEL_PLACEHOLDER_UNKNOWN",
        message: "m",
        path: { group: "grp_a", locale: "en", placeholder: "index" },
      },
    ]);

    expect(parsed[0]?.path?.scopes).toStrictEqual(["grp_a", "form"]);
    expect(parsed[1]?.path).toMatchObject({ outerGroup: "grp_a", innerGroup: "grp_b" });
    expect(parsed[2]?.path).toMatchObject({ group: "grp_a", placeholder: "index" });
  });
});

describe("the rail tree", () => {
  it("nests a group under the step that holds it, and badges only the step", () => {
    const rail = formSubtreeRail({
      formId: "frm_booking",
      slug: "booking",
      title: "Booking",
      steps: draftWith(9).steps,
      issueCounts: new Map([["stp_travellers", 2]]),
      current: { kind: "group", groupId: "grp_passengers" },
    });

    expect(rail.children.map((item) => [item.kind, item.key, item.isCurrent])).toStrictEqual([
      ["step", "step:stp_travellers", false],
      ["group", "group:grp_passengers", true],
    ]);
    // A group's issues are counted against its step, so a second count on the nested row would
    // make the rail's numbers add up to more than the panel's (§5.6's named mistake).
    expect(rail.children.map((item) => item.issueCount)).toStrictEqual([2, 0]);
    expect(railStepItems(rail).map((item) => item.key)).toStrictEqual(["step:stp_travellers"]);
  });

  it("points a group row at the anchor the grid and the rail both carry", () => {
    const rail = formSubtreeRail({
      formId: "frm_booking",
      slug: "booking",
      title: "Booking",
      steps: draftWith(9).steps,
      issueCounts: new Map(),
      current: { kind: "section", section: "preview" },
    });
    const group = rail.children.find((item) => item.kind === "group");

    expect(group?.anchorId).toBe(groupAnchorId("grp_passengers"));
    expect(group?.href).toBe(`/forms/frm_booking#${groupAnchorId("grp_passengers")}`);
  });
});
