import { describe, expect, it } from "vitest";

import {
  loadScenarios,
  parseScenario,
  scenarioIds,
  selectScenarios,
  type EvalScenario,
} from "./scenarios.js";

function scenario(overrides: Partial<EvalScenario> = {}): EvalScenario {
  return {
    id: "B09",
    title: "Refusals",
    safety: true,
    screen: "/forms/[formId]/build",
    caller: { grants: ["forms.editor"], owner: false },
    messages: ["publish this"],
    assistantMust: [],
    ...overrides,
  };
}

describe("the committed scenarios", () => {
  it("all parse, and the smoke one runs on the builder screen", () => {
    const loaded = loadScenarios();
    const smoke = loaded.find((entry) => entry.id === "S00");

    expect(loaded.length).toBeGreaterThan(0);
    expect(smoke?.screen).toBe("/forms/[formId]/build");
    expect(smoke?.messages).toHaveLength(1);
  });
});

describe("reading one scenario", () => {
  it("names what is wrong rather than running a half-read scenario", () => {
    expect(() => parseScenario({ ...scenario(), messages: [] }, "B09.json")).toThrow("B09.json");
    expect(() => parseScenario({ ...scenario(), id: "nine" }, "B09.json")).toThrow("id");
  });

  it("keeps the fields a grader reads", () => {
    const parsed = parseScenario(scenario({ assistantMust: ["names the lock"] }), "B09.json");

    expect(parsed.safety).toBe(true);
    expect(parsed.assistantMust).toEqual(["names the lock"]);
  });
});

describe("choosing what to run", () => {
  const all = [scenario(), scenario({ id: "B01", safety: false })];

  it("runs everything when nothing is asked for", () => {
    expect(selectScenarios(all).map((entry) => entry.id)).toEqual(["B09", "B01"]);
  });

  it("runs only the ids named", () => {
    expect(selectScenarios(all, { ids: ["B01"] }).map((entry) => entry.id)).toEqual(["B01"]);
  });

  it("runs only the safety scenarios", () => {
    expect(selectScenarios(all, { safetyOnly: true }).map((entry) => entry.id)).toEqual(["B09"]);
  });

  it("refuses an id no scenario carries", () => {
    expect(() => selectScenarios(all, { ids: ["B99"] })).toThrow("B99");
  });

  it("reads a comma-separated list from the command line", () => {
    expect(scenarioIds(" B09 , B11 ")).toEqual(["B09", "B11"]);
    expect(scenarioIds(undefined)).toBeUndefined();
    expect(scenarioIds("  ")).toBeUndefined();
  });
});
