import { describe, expect, it } from "vitest";

import { messages } from "./en.ts";

/**
 * The "Replaces" column of `docs/WORKSPACE_ACCESS.md` section 2, as patterns over what a
 * reader sees; only values are scanned, because keys and API paths keep their names. Each
 * sample proves its pattern bites, since three of these terms are in no shipped value.
 */
const RETIRED: readonly (readonly [string, RegExp, string])[] = [
  [
    "installation administrator or claim",
    /installation (admin|administrator|claim)|installation-wide claim/iu,
    "You hold the installation-wide claim, so you are an installation administrator.",
  ],
  [
    "workspace owner",
    /workspace owner|\bowners?\b/iu,
    "Ask a workspace owner, or any of this workspace's owners.",
  ],
  ["holders", /\bholders?\b/iu, "Every holder keeps theirs, and the other holders do too."],
  [
    "form viewer, editor or publisher",
    /form (viewer|editor|publisher)/iu,
    "A form viewer reads it, a form editor drafts it and a form publisher ships it.",
  ],
  [
    "response viewer or eraser",
    /response (viewer|eraser)\b/iu,
    "A response viewer exports, and a response eraser erases.",
  ],
  [
    "release approver or release forms",
    /release (approver|forms)/iu,
    "Release forms carries it, so ask a release approver.",
  ],
  ["second approver", /second approver/iu, "This change is waiting for a second approver."],
  ["production release", /production release/iu, "A production release is a separate act."],
  [
    "published version",
    /\bpublished versions?\b/iu,
    "A published version never changes, and earlier published versions stay as they are.",
  ],
  ["two-person rule", /two-person/iu, "The two-person rule applies in production."],
  [
    "give or remove access",
    /give access|remove access/iu,
    "Give access to this group, or remove access from it.",
  ],
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

  for (const [label, pattern, sample] of RETIRED) {
    it(`writes no ${label} into a value a reader sees`, () => {
      expect(pattern.test(sample), `the ${label} pattern catches nothing`).toBe(true);
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
