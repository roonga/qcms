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
const ALL_EMPTY = ["", "", "", "", ""];

describe("promptMissing", () => {
  it("lands on exactly the tree --yes produces when every answer is empty", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    const answered = await promptMissing({}, asker, CWD);
    expect(withDefaults(answered, CWD)).toStrictEqual(withDefaults({}, CWD));
  });

  it("asks for all five things the task names", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({}, asker, CWD);
    expect(asker.asked).toHaveLength(5);
    for (const label of [
      "Project name",
      "Deployment shape",
      "Admin two-factor authentication",
      "Portal base URL",
      "Admin base URL",
    ]) {
      expect(asker.asked.some((prompt) => prompt.startsWith(label))).toBe(true);
    }
  });

  it("never asks about the package manager, because there is no choice", async () => {
    // The Code Owner dropped npm and yarn (issue #449). A prompt whose only answer is
    // the default is not a question, and asking it would imply a decision the adopter
    // does not have. The length assertion above would survive a renamed prompt; this
    // one would not.
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({}, asker, CWD);
    expect(asker.asked.join("\n")).not.toMatch(/package manager|pnpm|npm|yarn/i);
  });

  it("offers each default in the prompt itself", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({}, asker, CWD);
    expect(asker.asked.join("\n")).toContain(DEFAULTS.projectName);
    expect(asker.asked.join("\n")).toContain(DEFAULTS.portalBaseUrl);
  });

  it("never re-asks something a flag already answered", async () => {
    const asker = scriptedAsker(ALL_EMPTY);
    await promptMissing({ shape: "enterprise" }, asker, CWD);
    expect(asker.asked).toHaveLength(4);
    expect(asker.asked.some((prompt) => prompt.startsWith("Deployment shape"))).toBe(false);
  });

  it("takes an answered project name and resolves its directory", async () => {
    const asker = scriptedAsker(["insurance-forms", "", "", "", ""]);
    const answered = await promptMissing({}, asker, CWD);
    expect(answered.projectName).toBe("insurance-forms");
    expect(answered.targetDirectory).toBe("/workspace/insurance-forms");
  });

  it("re-asks until a choice is one of the offered values", async () => {
    const asker = scriptedAsker(["", "kubernetes", "enterprise", "", "", ""]);
    const answered = await promptMissing({}, asker, CWD);
    expect(answered.shape).toBe("enterprise");
    expect(asker.asked.filter((prompt) => prompt.startsWith("Deployment shape"))).toHaveLength(2);
  });

  it("re-asks until a base URL is absolute, then normalizes it", async () => {
    const asker = scriptedAsker(["", "", "", "/forms", "https://forms.example.com/", ""]);
    const answered = await promptMissing({}, asker, CWD);
    expect(answered.portalBaseUrl).toBe("https://forms.example.com");
    expect(asker.asked.filter((prompt) => prompt.startsWith("Portal base URL"))).toHaveLength(2);
  });
});
