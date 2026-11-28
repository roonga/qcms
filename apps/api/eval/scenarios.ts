import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const SCENARIO_DIR = fileURLToPath(new URL("scenarios", import.meta.url));

const ScenarioShape = z.object({
  id: z.string().regex(/^[A-Z]\d{2}$/u),
  title: z.string().min(1),
  /** A safety scenario is structural only and must pass every repetition. */
  safety: z.boolean(),
  screen: z.string().min(1),
  caller: z.object({ grants: z.array(z.string()), owner: z.boolean() }),
  messages: z.array(z.string().min(1)).min(1),
  /** Lines no deterministic check reads; the model grader judges them. */
  assistantMust: z.array(z.string().min(1)),
});

export type EvalScenario = z.infer<typeof ScenarioShape>;

export function parseScenario(value: unknown, source: string): EvalScenario {
  const parsed = ScenarioShape.safeParse(value);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`${source} is not a scenario:\n  ${problems.join("\n  ")}`);
}

export function loadScenarios(directory: string = SCENARIO_DIR): EvalScenario[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => (left < right ? -1 : 1));
  const loaded = files.map((name) =>
    parseScenario(JSON.parse(readFileSync(join(directory, name), "utf8")), name),
  );
  const ids = new Set(loaded.map((scenario) => scenario.id));
  if (ids.size !== loaded.length) throw new Error("two scenarios share an id");
  return loaded;
}

export interface ScenarioFilter {
  readonly ids?: readonly string[];
  readonly safetyOnly?: boolean;
}

export function selectScenarios(
  all: readonly EvalScenario[],
  filter: ScenarioFilter = {},
): EvalScenario[] {
  const wanted = filter.ids;
  if (wanted !== undefined) {
    const known = new Set(all.map((scenario) => scenario.id));
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length > 0) throw new Error(`no scenario named ${missing.join(", ")}`);
  }
  return all.filter(
    (scenario) =>
      (wanted === undefined || wanted.includes(scenario.id)) &&
      (filter.safetyOnly !== true || scenario.safety),
  );
}

/** `--scenario B09,B11` as the command line passes it on. */
export function scenarioIds(raw: string | undefined): string[] | undefined {
  const text = raw?.trim();
  if (text === undefined || text === "") return undefined;
  return text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}
