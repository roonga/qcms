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

// The format and the change policy are `golden/evaluator/CORPUS.md`, and
// `pnpm test:golden-drift` runs this file as the CI drift guard.

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const CORPUS_DIR = path.join(PACKAGE_DIR, "golden", "evaluator");

// The evaluator is handed the raw JSON values, its own canonicalization being
// part of the surface under test.
const Scenario = z.object({
  description: z.string().min(1),
  form: z.string().min(1),
  answers: z.array(
    z.object({ questionId: z.union([QuestionId, InstanceAnswerKey]), value: AnswerValue }),
  ),
  rosters: z.array(z.object({ groupId: GroupId, instances: z.array(InstanceId) })).optional(),
  expected: FlowState,
});

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

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
  answers: AnswerMap;
  // `undefined` for a scenario with no roster, so the evaluator is called
  // without the argument at all.
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
    // Casts justified: the parse above proved each value is a valid AnswerValue
    // encoding and each id a question id.
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
        expect(result.value).toEqual(scenario.expected);
      });
    }
  });
});
