import { describe, expect, it } from "vitest";

import { DEFAULTS, withDefaults } from "./options.js";
import { promptMissing, type Asker } from "./prompt.js";

const CWD = "/workspace";

/** An asker that replays a script of answers and records what it was asked. */
function scriptedAsker(answers: readonly string[]): Asker & { asked: string[] } {
  const asked: string[] = [];
  let index = 0;
  return {
    asked,
    question: (prompt: string) => {
      asked.push(prompt);
      const answer = answers[index] ?? "";
      index += 1;
      return Promise.resolve(answer);
    },
    close: () => {
      /* nothing to release */
    },
  };
}

/** Enter pressed through every prompt. */
const ALL_EMPTY = ["", "", "", "", "", ""];

describe("promptMissing", () => {
  it("lands on exactly the tree --yes produces when every answer is empty", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    const answered = await promptMissing({}, asker, CWD);
    expect(withDefaults(answered, CWD)).toStrictEqual(withDefaults({}, CWD));
  });

  it("asks for all six things the task names", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({}, asker, CWD);
    expect(asker.asked).toHaveLength(6);
    for (const label of [
      "Project name",
      "Package manager",
      "Deployment shape",
      "Admin two-factor authentication",
      "Portal base URL",
      "Admin base URL",
    ]) {
      expect(asker.asked.some((prompt) => prompt.startsWith(label))).toBe(true);
    }
  });

  it("offers each default in the prompt itself", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({}, asker, CWD);
    expect(asker.asked.join("\n")).toContain(DEFAULTS.projectName);
    expect(asker.asked.join("\n")).toContain(DEFAULTS.portalBaseUrl);
  });

  it("never re-asks something a flag already answered", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({ shape: "enterprise", packageManager: "pnpm" }, asker, CWD);
    expect(asker.asked).toHaveLength(4);
    expect(asker.asked.some((prompt) => prompt.startsWith("Deployment shape"))).toBe(false);
    expect(asker.asked.some((prompt) => prompt.startsWith("Package manager"))).toBe(false);
  });

  it("takes an answered project name and resolves its directory", async () => {
    const asker = scriptedAsker(["insurance-forms", "", "", "", "", ""]);
    const answered = await promptMissing({}, asker, CWD);
    expect(answered.projectName).toBe("insurance-forms");
    expect(answered.targetDirectory).toBe("/workspace/insurance-forms");
  });

  it("re-asks until a choice is one of the offered values", async () => {
    // "npm" is a refusal now, not an alternative (issue #449), so it is the perfect
    // rejected answer: an adopter who types it is exactly who this loop exists for.
    const asker = scriptedAsker(["", "npm", "pnpm", "", "", "", ""]);
    const answered = await promptMissing({}, asker, CWD);
    expect(answered.packageManager).toBe("pnpm");
    expect(asker.asked.filter((prompt) => prompt.startsWith("Package manager"))).toHaveLength(2);
  });

  it("re-asks until a base URL is absolute, then normalizes it", async () => {
    const asker = scriptedAsker(["", "", "", "", "/forms", "https://forms.example.com/", ""]);
    const answered = await promptMissing({}, asker, CWD);
    expect(answered.portalBaseUrl).toBe("https://forms.example.com");
    expect(asker.asked.filter((prompt) => prompt.startsWith("Portal base URL"))).toHaveLength(2);
  });
});
