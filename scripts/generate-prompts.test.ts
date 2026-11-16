import { describe, expect, it } from "vitest";

import {
  bumpProblem,
  descriptionProblems,
  placeholderProblems,
  readSources,
  recipeProblems,
  recorded,
  renderModule,
  sourceHash,
  unwrapDescription,
} from "./generate-prompts.mjs";

const versionFile = (version: number, hash: string): string =>
  [
    `export const SYSTEM_PROMPT_VERSION = ${String(version)};`,
    `export const PROMPT_SOURCE_HASH = "${hash}";`,
  ].join("\n");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("reading a description out of its Markdown", () => {
  it("joins the wrapped lines back into the one line a schema carries", () => {
    expect(unwrapDescription("Count a form's responses\nunder four filters.\n")).toBe(
      "Count a form's responses under four filters.",
    );
  });

  it("reports an empty file rather than describing a tool with nothing", () => {
    expect(descriptionProblems([{ path: "tools/x.md", name: "x", text: "\n" }])).toEqual([
      "tools/x.md is empty.",
    ]);
  });

  it("reports a placeholder in a description, which nothing fills", () => {
    expect(
      descriptionProblems([{ path: "tools/x.md", name: "x", text: "Lists {{QUESTION_TYPES}}." }]),
    ).toEqual(["tools/x.md uses a placeholder, and a description fills none."]);
  });
});

describe("a question-type recipe", () => {
  it("accepts a file named as the type enum spells it", () => {
    expect(
      recipeProblems([{ path: "recipes/date-of-birth.md", name: "date-of-birth", text: "Use a date." }]),
    ).toEqual([]);
  });

  it("reports a name the enum could not carry", () => {
    expect(
      recipeProblems([{ path: "recipes/Date Of Birth.md", name: "Date Of Birth", text: "x" }]),
    ).toEqual(["recipes/Date Of Birth.md is named outside the type enum's shape, a-z and hyphens."]);
  });

  it("reports an empty file and a placeholder, neither of which a lookup can return", () => {
    expect(recipeProblems([{ path: "recipes/x.md", name: "x", text: " \n" }])).toEqual([
      "recipes/x.md is empty.",
    ]);
    expect(
      recipeProblems([{ path: "recipes/x.md", name: "x", text: "Types: {{QUESTION_TYPES}}." }]),
    ).toEqual(["recipes/x.md uses a placeholder, and a recipe fills none."]);
  });
});

describe("the placeholders a system section may use", () => {
  it("accepts the names buildSystemPrompt computes", () => {
    expect(
      placeholderProblems([
        { path: "system/01.md", name: "01", text: "Operators: {{CONDITION_OPERATORS}}." },
      ]),
    ).toEqual([]);
  });

  it("names a placeholder nothing fills, with the list that is filled", () => {
    const [problem] = placeholderProblems([
      { path: "system/01.md", name: "01", text: "Types: {{TYPES}}." },
    ]);
    expect(problem).toContain("system/01.md uses {{TYPES}}");
    expect(problem).toContain("CONDITION_OPERATORS");
  });
});

describe("the recorded version and hash", () => {
  it("reads both out of the file that records them", () => {
    expect(recorded(versionFile(21, HASH_A))).toEqual({ version: 21, hash: HASH_A });
  });

  it("reads neither out of a file that records neither", () => {
    expect(recorded("export const SYSTEM_PROMPT_VERSION = 21.5;")).toEqual({
      version: undefined,
      hash: undefined,
    });
  });
});

describe("the bump rule", () => {
  it("passes unchanged text, whatever the version", () => {
    expect(bumpProblem(versionFile(21, HASH_A), versionFile(21, HASH_A))).toBeUndefined();
  });

  it("passes changed text that carries a higher version", () => {
    expect(bumpProblem(versionFile(21, HASH_A), versionFile(22, HASH_B))).toBeUndefined();
  });

  it("fails changed text at the same version, naming the one to set", () => {
    const problem = bumpProblem(versionFile(21, HASH_A), versionFile(21, HASH_B));
    expect(problem).toContain("still 21");
    expect(problem).toContain("set it to 22");
  });

  it("fails changed text at a lower version", () => {
    expect(bumpProblem(versionFile(21, HASH_A), versionFile(20, HASH_B))).toContain("set it to 22");
  });
});

describe("the hash over the sources", () => {
  it("changes with a section's text and not with the order it is read in", () => {
    const one = { path: "p", name: "01", text: "first" };
    const two = { path: "p", name: "02", text: "second" };
    expect(sourceHash({ system: [one, two] })).toBe(sourceHash({ system: [one, two] }));
    expect(sourceHash({ system: [one, two] })).not.toBe(
      sourceHash({ system: [one, { ...two, text: "changed" }] }),
    );
    expect(sourceHash({ system: [one], tools: [two] })).not.toBe(
      sourceHash({ system: [one, two] }),
    );
  });
});

describe("the rendered module", () => {
  it("carries each section in file order and each description as one line", () => {
    const module = renderModule({
      system: [{ path: "p", name: "01-intro", text: "line one\nline two" }],
      tools: [{ path: "p", name: "read_form", text: "Read one\nform." }],
      actions: [{ path: "p", name: "form.create", text: "Create a form." }],
    });
    expect(module).toContain('"line one\\nline two"');
    expect(module).toContain('"read_form": "Read one form."');
    expect(module).toContain('"form.create": "Create a form."');
    expect(module).toContain("Do not edit");
  });

  it("keeps a recipe's own line breaks, and indexes the types from the file names", () => {
    const module = renderModule({
      recipes: [
        { path: "p", name: "date-of-birth", text: "# Date of birth\n\nUse a date." },
        { path: "p", name: "postcode", text: "# Postcode\n\nUse short text." },
      ],
    });

    expect(module).toContain('"date-of-birth": "# Date of birth\\n\\nUse a date."');
    expect(module).toContain('export const QUESTION_RECIPE_TYPES = [\n  "date-of-birth",\n  "postcode",\n]');
  });
});

describe("this repository's own sources", () => {
  it("holds one Markdown file per section and per description", () => {
    expect(readSources("system").length).toBeGreaterThan(0);
    expect(readSources("tools").length).toBeGreaterThan(0);
    expect(readSources("actions").length).toBeGreaterThan(0);
    expect(readSources("recipes").length).toBeGreaterThan(0);
    expect(placeholderProblems(readSources("system"))).toEqual([]);
    expect(descriptionProblems([...readSources("tools"), ...readSources("actions")])).toEqual([]);
    expect(recipeProblems(readSources("recipes"))).toEqual([]);
  });
});
