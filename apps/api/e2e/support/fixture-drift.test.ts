/**
 * Compiled-fixture drift guard (issue #321).
 *
 * `apps/api/e2e/support/fixtures/*.a2ui.json` are compiled A2UI documents seeded
 * verbatim into `form_versions` by `seed.ts`, and several API and browser specs
 * then assert against what the serve path replays out of them. Nothing
 * recompiled them, so a `@qcms/a2ui-compiler` change desynced them **silently**:
 * every spec stayed green while asserting against a document the compiler no
 * longer produces, which is the worst failure mode a fixture has. The insurance
 * read had already drifted a whole corpus generation behind by the time this was
 * written.
 *
 * This test closes that. For every entry in `COMPILED_FIXTURES` it rebuilds the
 * published snapshot through the real publish path (`compileDraft`, task 008),
 * projects it with the live compiler (`compileForm`, task 011) exactly as
 * `makePublishFormHandler` does, and asserts the result is byte-identical to the
 * committed file. Byte equality rather than deep equality: key order and
 * formatting are part of the determinism contract (ADR-18), and the seeded bytes
 * are what a respondent is served.
 *
 * It mirrors `packages/a2ui-compiler/src/golden-corpus.test.ts`, with one
 * deliberate difference. That corpus is **append-only** and is never rewritten to
 * match new output; these are ordinary `apps/api` test fixtures, so a legitimate
 * compiler change regenerates them:
 *
 * ```sh
 * UPDATE_API_FIXTURES=1 pnpm exec vitest run --root . --project qcms-api fixture-drift
 * ```
 *
 * Review the diff by eye before committing, exactly as `UPDATE_GOLDEN=1` demands
 * of the corpus: the regenerated file is what respondents get served, and
 * `pnpm lint` re-runs `check:fixture-domain` over the directory, so content that
 * leaves the neutral vehicle domain (task 043) fails there.
 *
 * The insurance entry is `regenerable: false` and is never written by that flag:
 * it lives under `packages/a2ui-compiler/golden/`, whose documents are frozen
 * (ADR-18). A divergence there is a spec-bump question for the corpus, not a
 * regeneration here.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { compileForm, COMPILER_VERSION } from "@qcms/a2ui-compiler";
import {
  compileDraft,
  parseFormDefinition,
  parseQuestionDefinition,
  type DraftInput,
  type FrozenSnapshot,
  type QuestionId,
  type QuestionVersionRecord,
} from "@qcms/core";
import { describe, expect, it } from "vitest";

import {
  COMPILED_FIXTURES,
  INSURANCE_GOLDEN,
  INSURANCE_GOLDEN_PATH,
  type CompiledFixture,
} from "./fixtures.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);

/**
 * A question store over the fixture's own pinned definitions, each registered at
 * versions 1 and 2 - the same shape the corpus runner builds, because the form
 * fixtures pin `q_at_fault_accident@2` and everything else `@1`. Pure lookups:
 * the compiler never reads (R3/R4), so the reads are the harness, not the unit.
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

/** The frozen snapshot the publish path would produce for this fixture's form. */
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
  return result.value;
}

/** Serialize a compiled form to its on-disk form (2-space, trailing LF). */
function serialize(compiled: unknown): string {
  return `${JSON.stringify(compiled, null, 2)}\n`;
}

describe("compiled A2UI fixtures track the live compiler (issue #321)", () => {
  // A registry with no rows would make every assertion below vacuous, which is
  // the exact shape of failure this guard exists to prevent.
  it("guards every committed compiled fixture", () => {
    expect(COMPILED_FIXTURES.length).toBeGreaterThan(0);
  });

  // The seeded insurance document must come from the generation this compiler
  // writes, not from whichever segment was current when the read was authored.
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
        // Structural first, so a shape change names the exact document and JSON
        // path (`documents[1].root.children[0].props.maxLength`) instead of
        // reporting two large strings as unequal.
        expect(compiled).toEqual(JSON.parse(committed));
        // Then byte-exact, which is what the seed actually stores: key order and
        // formatting are part of the determinism contract (ADR-18).
        expect(serialized).toBe(committed);
      });
    });
  }
});
