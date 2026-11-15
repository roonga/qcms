import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACTION_KIND_NAMES, ACTION_KINDS } from "./actions/registry.js";
import {
  ACTION_DESCRIPTIONS,
  SYSTEM_PROMPT_SECTIONS,
  TOOL_DESCRIPTIONS,
} from "./prompts/prompts.generated.js";
import {
  AVOID_WORDS,
  AVOID_WORDS_LINE_PREFIX,
  buildSystemPrompt,
  CONTRACTS_HEADING,
} from "./system-prompt.js";
import { AGENT_TOOL_NAMES, TOOLS } from "./tools/registry.js";

const EM_DASH = String.fromCharCode(0x2014);

function sources(directory: string): { name: string; text: string }[] {
  const base = new URL(`./prompts/${directory}/`, import.meta.url);
  return readdirSync(base)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ name, text: readFileSync(new URL(name, base), "utf8").replace(/\n$/, "") }));
}

/** The sections the person is spoken to through, which the avoid-words rule holds. */
function guidanceSources(): { name: string; text: string }[] {
  const system = sources("system");
  const contracts = system.findIndex((source) => source.text.includes(CONTRACTS_HEADING));
  expect(contracts, `no system section carries "${CONTRACTS_HEADING}"`).toBeGreaterThan(0);
  return system.slice(0, contracts);
}

describe("the assistant's prompt sources", () => {
  it("assembles the sections the Markdown holds, in file order", () => {
    expect(SYSTEM_PROMPT_SECTIONS).toEqual(sources("system").map((source) => source.text));
  });

  it("fills every placeholder the sections use", () => {
    expect(buildSystemPrompt()).not.toContain("{{");
  });

  it("describes every tool in the registry, and no name outside it", () => {
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual(Object.keys(TOOLS).sort());
  });

  it("describes every action kind, and no kind outside the registry", () => {
    expect(Object.keys(ACTION_DESCRIPTIONS).sort()).toEqual([...ACTION_KIND_NAMES].sort());
    expect(Object.keys(ACTION_DESCRIPTIONS).sort()).toEqual(Object.keys(ACTION_KINDS).sort());
  });

  it("keeps builder terms out of the guidance sources", () => {
    for (const source of guidanceSources()) {
      const guidance = source.text
        .split("\n")
        .filter((line) => !line.startsWith(AVOID_WORDS_LINE_PREFIX))
        .join("\n")
        .toLowerCase();
      for (const term of AVOID_WORDS) {
        expect(guidance, `${source.name} uses the builder term ${term}`).not.toContain(
          term.toLowerCase(),
        );
      }
    }
  });

  it("writes no em dash in any prompt source", () => {
    for (const directory of ["system", "tools", "actions"]) {
      for (const source of sources(directory)) {
        expect(source.text, `${directory}/${source.name} carries an em dash`).not.toContain(
          EM_DASH,
        );
      }
    }
  });

  it("carries the tool descriptions this folder replaced, byte for byte", async () => {
    const descriptions = Object.fromEntries(
      Object.entries(TOOLS).map(([name, def]) => [name, def.description]),
    );
    await expect(`${JSON.stringify(descriptions, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/tool-descriptions.json",
    );
  });

  it("carries the action descriptions this folder replaced, byte for byte", async () => {
    const descriptions = Object.fromEntries(
      Object.entries(ACTION_KINDS).map(([kind, def]) => [kind, def.description]),
    );
    await expect(`${JSON.stringify(descriptions, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/action-descriptions.json",
    );
  });
});
