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
  ["production release", /production release/iu],
  ["published version", /\bpublished versions?\b/iu],
  ["two-person rule", /two-person/iu],
  ["give or remove access", /give access|remove access/iu],
];

/**
 * Every value, not a prefix list: the swept strings reach beyond the access screens into
 * the operations empty state, the publish refusals and the assistant cards, and a prefix
 * list leaves each of those uncovered until somebody remembers to extend it.
 */
function scanned(): readonly string[] {
  return Object.keys(messages);
}

describe("the admin interface says what the glossary says", () => {
  it("scans the whole catalog", () => {
    expect(scanned().length).toBeGreaterThan(500);
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

  it("keeps the strings swept outside the access screens covered", () => {
    for (const key of [
      "operations.empty.body",
      "forms.publish.blocked.draftNotAllowedOnly",
      "agent.card.arg.requireSecondApprover",
      "agent.card.result.held",
      "ops.error.proposerCannotConfirm",
    ]) {
      expect(scanned(), key).toContain(key);
    }
  });
});
