import { describe, expect, it } from "vitest";

import { messages } from "./en.ts";

/**
 * The "Replaces" column of `docs/WORKSPACE_ACCESS.md` section 2, as patterns over what a
 * reader sees. Wire ids, keys and API paths keep their names, so only values are scanned.
 */
const RETIRED: readonly (readonly [string, RegExp])[] = [
  [
    "installation administrator or claim",
    /installation (admin|administrator|claim)|installation-wide claim/iu,
  ],
  ["workspace owner", /workspace owner|\bowners?\b/iu],
  ["holders", /\bholders?\b/iu],
  ["form viewer, editor or publisher", /form (viewer|editor|publisher)/iu],
  ["response viewer or eraser", /response (viewer|eraser)\b/iu],
  ["release approver or release forms", /release (approver|forms)/iu],
  ["second approver", /second approver/iu],
  ["two-person rule", /two-person/iu],
  ["give or remove access", /give access|remove access/iu],
];

/** Access copy the glossary governs. Group and starter-group names are the operator's own. */
const PREFIXES = [
  "membership.",
  "access.",
  "ops.proposals.",
  "agent.card.access.",
  "agent.card.member.",
];

function scanned(): readonly string[] {
  return Object.keys(messages).filter((key) => PREFIXES.some((prefix) => key.startsWith(prefix)));
}

describe("the access interface says what the glossary says", () => {
  it("scans the access copy", () => {
    expect(scanned().length).toBeGreaterThan(50);
  });

  for (const [label, pattern] of RETIRED) {
    it(`writes no ${label} into a value a reader sees`, () => {
      const offending = scanned().filter((key) =>
        pattern.test(messages[key as keyof typeof messages]),
      );
      expect(offending).toEqual([]);
    });
  }

  it("keeps the five role names and the administrator on the glossary's words", () => {
    expect([
      messages["membership.role.formsViewer.name"],
      messages["membership.role.formsEditor.name"],
      messages["membership.role.formsPublisher.name"],
      messages["membership.role.responsesViewer.name"],
      messages["membership.role.responsesEraser.name"],
      messages["membership.role.formsOwner.name"],
    ]).toEqual([
      "View forms",
      "Edit forms",
      "Publish forms",
      "View responses",
      "Erase responses",
      "Workspace administrator",
    ]);
    expect(messages["membership.groups.columnHolders"]).toBe("People in this group");
  });
});
