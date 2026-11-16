import { describe, expect, it } from "vitest";

import { messages } from "./en.ts";

/**
 * Keys, API paths and refusal codes still say release; what a reader sees does not. The
 * prefixes below are the forms screens, the publish wizard and the assistant cards that
 * drive them, plus the strings swept with them.
 */
const PUBLISH_PREFIXES = ["forms.", "agent.card.form.", "agent.card.apply-draft."];

const ALSO_SWEPT = [
  "operations.column.lastRelease",
  "operations.filter.sort.released-desc",
  "operations.filter.sort.released-asc",
  "agent.card.arg.fromEnvironment",
  "agent.card.workspace.settings.consequence",
  "membership.agentAudit.act.form.publish",
  "membership.agentAudit.act.form.release",
  "membership.role.formsViewer.description",
  "membership.settings.twoPersonHelp",
];

function offending(keys: readonly string[]): string[] {
  return keys.filter((key) => /release/iu.test(messages[key as keyof typeof messages]));
}

describe("the forms interface says Publish", () => {
  it("writes no Release into a value a reader sees", () => {
    const keys = Object.keys(messages).filter((key) =>
      PUBLISH_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(offending(keys)).toEqual([]);
  });

  it("keeps the strings swept beside them clear too", () => {
    for (const key of ALSO_SWEPT) expect(Object.hasOwn(messages, key), key).toBe(true);
    expect(offending(ALSO_SWEPT)).toEqual([]);
  });
});
