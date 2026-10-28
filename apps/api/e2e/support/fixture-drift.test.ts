/**
 * A legitimate compiler change regenerates the regenerable fixtures with
 * `UPDATE_API_FIXTURES=1 pnpm exec vitest run --root . --project qcms-api fixture-drift`.
 * Review that diff by eye: the regenerated file is what a respondent is served.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { compileForm, COMPILER_VERSION } from "@roonga/qcms-a2ui-compiler";
import {
  compileDraft,
  parseFormDefinition,
  parseQuestionDefinition,
  type DraftInput,
  type FrozenSnapshot,
  type QuestionId,
  type QuestionVersionRecord,
} from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import {
  COMPILED_FIXTURES,
  INSURANCE_GOLDEN,
  INSURANCE_GOLDEN_PATH,
  type CompiledFixture,
} from "./fixtures.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);

/**
 * Each definition is registered at versions 1 and 2, because the form fixtures pin
 * `q_at_fault_accident@2` and everything else `@1`.
 */
function fixtureStore(
  fixture: CompiledFixture,
): Pick<DraftInput, "resolveQuestion" | "publishedQuestionVersions"> {
  const byKey = new Map<string, QuestionVersionRecord>();
  const published = new Map<QuestionId, Set<number>>();
  for (const raw of fixture.questions) {
    const parsed = parseQuestionDefinition(raw);
    if (!parsed.ok) {
      throw new Error(
        `${fixture.name}: a pinned question definition did not parse: ${JSON.stringify(parsed.error)}`,
      );
    }
    const definition = parsed.value;
    for (const version of [1, 2]) {
      byKey.set(`${definition.questionId}@${String(version)}`, {
        questionId: definition.questionId,
        version,
        definition,
      });
      const versions = published.get(definition.questionId) ?? new Set<number>();
      versions.add(version);
      published.set(definition.questionId, versions);
    }
  }
  return {
    resolveQuestion: (questionId, version) => byKey.get(`${questionId}@${String(version)}`),
    publishedQuestionVersions: published,
  };
}

function buildSnapshot(fixture: CompiledFixture): FrozenSnapshot {
  const definition = parseFormDefinition(fixture.form);
  if (!definition.ok) {
    throw new Error(
      `${fixture.name}: the form definition did not parse: ${JSON.stringify(definition.error)}`,
    );
  }
  const result = compileDraft({ definition: definition.value, ...fixtureStore(fixture) });
  if (!result.ok) {
    throw new Error(`${fixture.name}: the form did not publish: ${JSON.stringify(result.error)}`);
  }
  return result.value.snapshot;
}

function serialize(compiled: unknown): string {
  return `${JSON.stringify(compiled, null, 2)}\n`;
}

describe("compiled A2UI fixtures track the live compiler (issue #321)", () => {
  it("guards every committed compiled fixture", () => {
    expect(COMPILED_FIXTURES.length).toBeGreaterThan(0);
  });

  it("reads the insurance document from the live compiler's corpus generation", () => {
    expect(INSURANCE_GOLDEN_PATH).toMatch(
      /^packages\/a2ui-compiler\/golden\/v\d+\/insurance\.a2ui\.json$/,
    );
    expect(INSURANCE_GOLDEN.compilerVersion).toBe(COMPILER_VERSION);
  });

  for (const fixture of COMPILED_FIXTURES) {
    describe(fixture.name, () => {
      it(`recompiles byte-for-byte to ${fixture.path}`, () => {
        const compiled = compileForm(buildSnapshot(fixture), {});
        const serialized = serialize(compiled);
        const file = new URL(fixture.path, REPO_ROOT);

        if (process.env["UPDATE_API_FIXTURES"] === "1" && fixture.regenerable) {
          writeFileSync(file, serialized, "utf8");
          return;
        }

        const committed = readFileSync(file, "utf8");
        // Structural first, so a shape change names the exact JSON path instead of
        // reporting two large strings as unequal.
        expect(compiled).toEqual(JSON.parse(committed));
        // Then byte-exact: key order and formatting are part of the determinism
        // contract (ADR-18), and these bytes are what the seed stores.
        expect(serialized).toBe(committed);
      });
    });
  }
});
