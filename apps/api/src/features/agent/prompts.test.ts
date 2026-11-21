import { readdirSync, readFileSync } from "node:fs";

import { FORMAT_PATTERN_NAMES, FORMAT_PATTERNS } from "@roonga/qcms-core";
import type { FormatPatternName } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { ACTION_KIND_NAMES, ACTION_KINDS } from "./actions/registry.js";
import {
  ACTION_DESCRIPTIONS,
  QUESTION_RECIPE_TYPES,
  QUESTION_RECIPES,
  SYSTEM_PROMPT_SECTIONS,
  TOOL_DESCRIPTIONS,
} from "./prompts/prompts.generated.js";
import {
  AVOID_WORDS,
  AVOID_WORDS_LINE_PREFIX,
  buildSystemPrompt,
  CONTRACTS_HEADING,
} from "./system-prompt.js";
import type { AgentContext } from "./types.js";
import { advertisedJsonSchema, AGENT_TOOL_NAMES, TOOLS } from "./tools/registry.js";

const EM_DASH = String.fromCharCode(0x2014);

function sources(directory: string): { name: string; text: string }[] {
  const base = new URL(`./prompts/${directory}/`, import.meta.url);
  return readdirSync(base)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ name, text: readFileSync(new URL(name, base), "utf8").replace(/\n$/, "") }));
}

/**
 * The text the person is spoken to through, which the avoid-words rule holds: the system
 * sections before the contracts, and every recipe, which is guidance in the same voice.
 */
function guidanceSources(): { name: string; text: string }[] {
  const system = sources("system");
  const contracts = system.findIndex((source) => source.text.includes(CONTRACTS_HEADING));
  expect(contracts, `no system section carries "${CONTRACTS_HEADING}"`).toBeGreaterThan(0);
  return [
    ...system.slice(0, contracts),
    ...sources("recipes").map((source) => ({ ...source, name: `recipes/${source.name}` })),
  ];
}

const PROMPT_DIRS = ["system", "tools", "actions", "recipes"];

/** Avoid words a tool or action description may still write, because each one names a field. */
const FIELD_WORDS: ReadonlySet<string> = new Set(["slug"]);

/** Which recipe hands the model which vetted format, so a kernel edit cannot leave one behind. */
const RECIPE_FORMATS: Readonly<Record<string, readonly FormatPatternName[]>> = {
  "email-address": ["email"],
  "phone-number": ["phone"],
  postcode: ["postcode-au", "postcode-ca", "postcode-gb", "postcode-nz", "postcode-us"],
};

/** The first segment of every tool name, which is what a mention is recognised by. */
function toolHeads(): Set<string> {
  return new Set(AGENT_TOOL_NAMES.map((name) => name.split("_")[0] ?? ""));
}

function kindHeads(): Set<string> {
  return new Set(
    ACTION_KIND_NAMES.filter((kind) => kind.includes(".")).map((kind) => kind.split(".")[0] ?? ""),
  );
}

/**
 * Every tool as a turn advertises it, with the propose tools carrying every action kind
 * so each kind's arguments and their own text are in the rendered view.
 */
async function renderedTools(): Promise<unknown[]> {
  const offeredActionKinds = ACTION_KIND_NAMES.map((kind) => ({ kind, environments: [] }));
  const ctx = { offeredActionKinds } as unknown as AgentContext;
  const rendered = [];
  for (const name of AGENT_TOOL_NAMES) {
    const def = TOOLS[name];
    rendered.push({
      name,
      description: def.description,
      inputSchema: await advertisedJsonSchema(def.schemaFor?.(ctx) ?? def.inputSchema),
    });
  }
  return rendered;
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

  it("holds one recipe per file, with the index and the enum in step with both", () => {
    const names = sources("recipes").map((source) => source.name.replace(/\.md$/u, ""));
    expect(names.length).toBeGreaterThan(0);
    expect([...QUESTION_RECIPE_TYPES]).toEqual(names);
    expect(Object.keys(QUESTION_RECIPES)).toEqual(names);
    for (const type of QUESTION_RECIPE_TYPES) {
      expect(QUESTION_RECIPES[type].length, type).toBeGreaterThan(200);
    }
  });

  it("quotes every published format pattern in a recipe, verbatim", () => {
    const recipes = new Map(
      sources("recipes").map((source) => [source.name.replace(/\.md$/u, ""), source.text]),
    );
    const covered: FormatPatternName[] = [];
    for (const [stem, names] of Object.entries(RECIPE_FORMATS)) {
      const text = recipes.get(stem);
      expect(text, `no recipe ${stem}.md`).toBeDefined();
      for (const name of names) {
        const entry = FORMAT_PATTERNS[name];
        expect(text, `${stem}.md does not quote the ${name} pattern`).toContain(entry.pattern);
        expect(text, `${stem}.md does not quote the ${name} cap`).toContain(
          `maxLength: ${entry.maxLength}`,
        );
        expect(text, `${stem}.md does not quote the ${name} message`).toContain(entry.message);
        covered.push(name);
      }
    }
    expect([...covered].sort()).toEqual([...FORMAT_PATTERN_NAMES].sort());
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

  it("keeps the builder words a call has no use for out of the tool and action descriptions", () => {
    const banned = AVOID_WORDS.filter((word) => !FIELD_WORDS.has(word));
    for (const directory of ["tools", "actions"]) {
      for (const source of sources(directory)) {
        const text = source.text.toLowerCase();
        for (const term of banned) {
          expect(text, `${directory}/${source.name} uses the builder term ${term}`).not.toContain(
            term.toLowerCase(),
          );
        }
      }
    }
  });

  it("writes no em dash in any prompt source", () => {
    for (const directory of PROMPT_DIRS) {
      for (const source of sources(directory)) {
        expect(source.text, `${directory}/${source.name} carries an em dash`).not.toContain(
          EM_DASH,
        );
      }
    }
  });

  it("names only tools and action kinds the registries hold", () => {
    const toolLike = new RegExp(`\\b(?:${[...toolHeads()].join("|")})_[a-z][a-z_]*`, "g");
    const kindLike = new RegExp(`\\b(?:${[...kindHeads()].join("|")})\\.[a-z][A-Za-z]*`, "g");
    const tools: { name: string; where: string }[] = [];
    const kinds: { name: string; where: string }[] = [];
    for (const directory of PROMPT_DIRS) {
      for (const source of sources(directory)) {
        const where = `${directory}/${source.name}`;
        for (const [name] of source.text.matchAll(toolLike)) tools.push({ name, where });
        for (const [name] of source.text.matchAll(kindLike)) kinds.push({ name, where });
      }
    }
    // Counted first: a head that stopped matching would leave the loops below vacuous.
    expect(tools.length, "no prompt source names a tool").toBeGreaterThan(0);
    expect(kinds.length, "no prompt source names an action kind").toBeGreaterThan(0);
    for (const { name, where } of tools) {
      expect(AGENT_TOOL_NAMES, `${where} names the tool ${name}`).toContain(name);
    }
    for (const { name, where } of kinds) {
      expect(ACTION_KIND_NAMES, `${where} names the action kind ${name}`).toContain(name);
    }
  });

  it("advertises the tools and schemas a turn sends, text and all", async () => {
    await expect(`${JSON.stringify(await renderedTools(), null, 2)}\n`).toMatchFileSnapshot(
      "./prompts/rendered/tools.json",
    );
  });

  it("advertises every action kind a step may name", async () => {
    const kinds = Object.entries(ACTION_KINDS).map(([kind, def]) => ({
      kind,
      description: def.description,
    }));
    await expect(`${JSON.stringify(kinds, null, 2)}\n`).toMatchFileSnapshot(
      "./prompts/rendered/action-kinds.json",
    );
  });
});
