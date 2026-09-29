import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  analyzeRuleGraph,
  AnswerValue,
  checkRuleTypes,
  evaluateRules,
  FlowState,
  GroupId,
  InstanceAnswerKey,
  InstanceId,
  parseFormDefinition,
  parseQuestionDefinition,
  QuestionId,
  type AnswerKey,
  type AnswerMap,
  type FormDefinition,
  type QuestionDefinition,
  type ResolveQuestion,
  type RosterMap,
} from "./index.js";

/**
 * Golden evaluator corpus runner (task 007). Loads every scenario under
 * `golden/evaluator/scenarios/` and asserts the live evaluator's `FlowState`
 * equals the committed `expected` - the regression net for the frozen
 * `SEMANTICS_VERSION = 1` semantics (I7). Format and change policy:
 * `golden/evaluator/CORPUS.md`. The root `pnpm test:golden-drift` script runs
 * exactly this file as the CI drift guard.
 *
 * One test per scenario file, named after it, so a semantic drift reports the
 * failing scenario(s) by name with a structural diff of the two FlowStates.
 */

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const CORPUS_DIR = path.join(PACKAGE_DIR, "golden", "evaluator");

/** Scenario file schema - `answers` values are validated as canonical
 * AnswerValue encodings here, but the *raw* JSON values are what get handed to
 * the evaluator (its own canonicalization - NFC, multiChoice dedup - is part
 * of the surface under test). */
const Scenario = z.object({
  description: z.string().min(1),
  form: z.string().min(1),
  // The key is a bare `questionId` outside a repeating group and
  // `instanceId/questionId` inside one (ADR-42). The field keeps its name so
  // that every scenario committed before repetition is unchanged.
  answers: z.array(
    z.object({ questionId: z.union([QuestionId, InstanceAnswerKey]), value: AnswerValue }),
  ),
  // The LIVE roster the evaluation is handed, in roster order. Absent for a form
  // with no group, which is every scenario committed before task 071 and is
  // what makes the corpus's additivity claim checkable rather than asserted.
  rosters: z
    .array(z.object({ groupId: GroupId, instances: z.array(InstanceId) }))
    .optional(),
  expected: FlowState,
});

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/** Resolver over the canonical question fixtures plus the corpus-local gate
 * questions; duplicate questionIds across the two sets are a corpus bug. */
function corpusResolver(): ResolveQuestion {
  const byId = new Map<string, QuestionDefinition>();
  const questionDirs = [
    path.join(PACKAGE_DIR, "fixtures", "questions", "valid"),
    path.join(CORPUS_DIR, "questions"),
  ];
  for (const dir of questionDirs) {
    for (const file of readdirSync(dir).sort()) {
      const parsed = parseQuestionDefinition(readJson(path.join(dir, file)));
      if (!parsed.ok) {
        throw new Error(`corpus question ${file} did not parse: ${JSON.stringify(parsed.error)}`);
      }
      if (byId.has(parsed.value.questionId)) {
        throw new Error(`duplicate corpus questionId ${parsed.value.questionId} (${file})`);
      }
      byId.set(parsed.value.questionId, parsed.value);
    }
  }
  return (questionId) => byId.get(questionId);
}

/** `form` refs are paths relative to `packages/core/` (either
 * `fixtures/forms/valid/...` or `golden/evaluator/forms/...`). */
function loadForm(ref: string, cache: Map<string, FormDefinition>): FormDefinition {
  const cached = cache.get(ref);
  if (cached !== undefined) {
    return cached;
  }
  if (ref.includes("..")) {
    throw new Error(`form ref ${ref} must stay inside packages/core`);
  }
  const parsed = parseFormDefinition(readJson(path.join(PACKAGE_DIR, ref)));
  if (!parsed.ok) {
    throw new Error(`corpus form ${ref} did not parse: ${JSON.stringify(parsed.error)}`);
  }
  cache.set(ref, parsed.value);
  return parsed.value;
}

interface LoadedScenario {
  file: string;
  scenario: z.infer<typeof Scenario>;
  /** Raw (pre-canonical) answer values, exactly as authored in the JSON. */
  answers: AnswerMap;
  /** `undefined` for a scenario that declares no roster, so the evaluator is
   * called with three arguments exactly as every pre-071 caller calls it. */
  rosters: RosterMap | undefined;
}

function loadScenarios(): LoadedScenario[] {
  const dir = path.join(CORPUS_DIR, "scenarios");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  return files.map((file) => {
    const raw = readJson(path.join(dir, file));
    const parsed = Scenario.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`scenario ${file} is malformed: ${z.prettifyError(parsed.error)}`);
    }
    // Hand the evaluator the raw authored values, not the schema-canonicalized
    // ones. Casts justified: Scenario.parse above proved each value is a valid
    // AnswerValue encoding and each id a QuestionId.
    const rawAnswers = (raw as { answers: { questionId: string; value: unknown }[] }).answers;
    const answers = new Map<AnswerKey, AnswerValue>();
    for (const entry of rawAnswers) {
      const key = entry.questionId as AnswerKey;
      if (answers.has(key)) {
        throw new Error(`scenario ${file} answers ${entry.questionId} twice`);
      }
      answers.set(key, entry.value as AnswerValue);
    }
    const rosters =
      parsed.data.rosters === undefined
        ? undefined
        : new Map(parsed.data.rosters.map((entry) => [entry.groupId, entry.instances]));
    return { file, scenario: parsed.data, answers, rosters };
  });
}

const resolve = corpusResolver();
const formCache = new Map<string, FormDefinition>();
const scenarios = loadScenarios();

describe("golden evaluator corpus", () => {
  it("has scenarios to assert", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  describe("corpus hygiene: every referenced form is publish-shaped", () => {
    const refs = [...new Set(scenarios.map((entry) => entry.scenario.form))].sort();
    it.each(refs)("%s parses, graph-checks, and type-checks clean", (ref) => {
      const form = loadForm(ref, formCache);
      expect(analyzeRuleGraph(form)).toEqual([]);
      expect(checkRuleTypes(form, resolve)).toEqual([]);
    });
  });

  describe("scenarios", () => {
    for (const { file, scenario, answers, rosters } of scenarios) {
      it(`${file} - ${scenario.description}`, () => {
        const form = loadForm(scenario.form, formCache);
        const result = evaluateRules(form, answers, resolve, rosters);
        if (!result.ok) {
          throw new Error(`evaluator returned an error: ${JSON.stringify(result.error)}`);
        }
        // toEqual prints the structural FlowState diff on mismatch - the
        // per-scenario readable failure the corpus exists to produce.
        expect(result.value).toEqual(scenario.expected);
      });
    }
  });
});
