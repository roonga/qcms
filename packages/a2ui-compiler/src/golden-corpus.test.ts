import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileDraft,
  parseFormDefinition,
  parseQuestionDefinition,
  type DraftInput,
  type FormDefinition,
  type FrozenSnapshot,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
} from "@qcms/core";
import { parseNode } from "@a2ra/core";
import { describe, expect, it } from "vitest";

import { compileForm } from "./compile.js";
import type { A2UINode, CompiledForm } from "./types.js";

/**
 * A2UI golden corpus runner (task 012, ADR-18; generation bumped in 026). Each
 * corpus form is a `@qcms/core` fixture; the runner rebuilds its published
 * {@link FrozenSnapshot} through the real publish path (`compileDraft`, task
 * 008), compiles it with the launch compiler (`compileForm`, task 011), and
 * asserts the output equals the committed golden document under the **current**
 * generation directory `golden/v2/`.
 *
 * `golden/v2/` is the second frozen generation: task 026 taught the compiler to
 * emit a honeypot decoy in every step document (a mapping change that alters
 * existing output), which under the append-only policy (ADR-18) is handled by a
 * new directory rather than editing `golden/v1/`. `golden/v1/` stays committed
 * as the faithful record of what compiler `0.0.0` produced and is still
 * asserted spec-valid below - old stored snapshots resolve against it forever
 * (`golden/README.md` spec-bump procedure).
 *
 * These goldens are three contracts at once (`golden/README.md`): the
 * compiler's regression net, the renderer's conformance input (028), and the
 * audit contract with `a2-react-aria`. They are **append-only** - a committed
 * golden is never edited, so a shape change must fail here, never be "fixed" by
 * rewriting the golden. Seed a *new* golden with `UPDATE_GOLDEN=1`; the
 * append-only CI guard (`scripts/check-golden-append-only.mjs`) rejects any edit
 * or deletion of an existing one.
 */

const CORE_FIXTURES = fileURLToPath(new URL("../../core/fixtures/", import.meta.url));
/**
 * Corpus-local fixtures (task 048, `../fixtures/corpus/README.md`): the inputs to
 * appended corpus entries whose own questions cannot live in the kernel fixture
 * set (which is asserted to cover each question type exactly once, and whose
 * forms may pin only questions from it).
 */
const LOCAL_FIXTURES = fileURLToPath(new URL("../fixtures/corpus/", import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL("../golden/v2/", import.meta.url));
const GOLDEN_V1_DIR = fileURLToPath(new URL("../golden/v1/", import.meta.url));

/**
 * Corpus membership: form fixture → golden document filename. `local: true` reads
 * the form from `LOCAL_FIXTURES/forms/` instead of the kernel's
 * `fixtures/forms/valid/`.
 *
 * APPEND ONLY (ADR-18). The last two rows are task 048's: author-supplied
 * validation messages (ADR-32) and boolean label overrides (ADR-36). Everything
 * above them was compiled by an earlier compiler and its bytes are frozen; those
 * forms carry no messages and no label overrides, which is exactly what makes
 * both features provably additive.
 */
const CORPUS: readonly {
  readonly fixture: string;
  readonly golden: string;
  readonly local?: boolean;
}[] = [
  { fixture: "kitchen-sink.json", golden: "kitchen-sink.a2ui.json" },
  { fixture: "insurance.json", golden: "insurance.a2ui.json" },
  { fixture: "minimal.json", golden: "minimal.a2ui.json" },
  { fixture: "constraints-heavy.json", golden: "constraints-heavy.a2ui.json" },
  { fixture: "deep-nesting-rules.json", golden: "deep-nesting-rules.a2ui.json" },
  { fixture: "author-messages.json", golden: "author-messages.a2ui.json", local: true },
  { fixture: "boolean-labels.json", golden: "boolean-labels.a2ui.json", local: true },
];

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(CORE_FIXTURES, ...segments), "utf8"));
}

function readLocalJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(path.join(LOCAL_FIXTURES, ...segments), "utf8"));
}

function loadForm(file: string, local = false): FormDefinition {
  const raw = local ? readLocalJson("forms", file) : readJson("forms", "valid", file);
  const result = parseFormDefinition(raw);
  if (!result.ok) {
    throw new Error(`fixture ${file} did not parse: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/**
 * Question store over the canonical fixtures, each published at versions 1 and
 * 2 (the form fixtures pin `q_at_fault_accident@2` and everything else `@1`) - the same
 * store `compile-draft.test.ts` builds. Pure lookups, no I/O in the kernel (R3);
 * the reads here are the test harness, not the compiler.
 */
function fixtureStore(): Pick<DraftInput, "resolveQuestion" | "publishedQuestionVersions"> {
  const byKey = new Map<string, QuestionVersionRecord>();
  const published = new Map<QuestionId, Set<number>>();
  const sources: readonly { readonly dir: string; readonly read: (file: string) => unknown }[] = [
    {
      dir: path.join(CORE_FIXTURES, "questions", "valid"),
      read: (file) => readJson("questions", "valid", file),
    },
    {
      dir: path.join(LOCAL_FIXTURES, "questions"),
      read: (file) => readLocalJson("questions", file),
    },
  ];
  const files = sources.flatMap(({ dir, read }) =>
    readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => ({ file, read })),
  );
  for (const { file, read } of files) {
    const parsed = parseQuestionDefinition(read(file));
    if (!parsed.ok) {
      throw new Error(`fixture question ${file} did not parse: ${JSON.stringify(parsed.error)}`);
    }
    const definition: QuestionDefinition = parsed.value;
    if (byKey.has(`${definition.questionId}@1`)) {
      throw new Error(`fixture question ${definition.questionId} is defined in two corpus roots`);
    }
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

const store = fixtureStore();

function buildSnapshot(fixture: string, local = false): FrozenSnapshot {
  const result = compileDraft({ definition: loadForm(fixture, local), ...store });
  if (!result.ok) {
    throw new Error(`fixture ${fixture} did not publish: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Serialize a compiled form to the on-disk golden form (2-space, trailing LF). */
function serialize(compiled: CompiledForm): string {
  return `${JSON.stringify(compiled, null, 2)}\n`;
}

/** The child nodes of a node, or [] for text/leaf nodes (narrows the union). */
function childNodes(node: A2UINode): readonly A2UINode[] {
  const children = node.children;
  return children !== undefined && typeof children !== "string" ? children : [];
}

/** Depth-first walk of every node in a document tree. */
function walk(node: A2UINode, into: A2UINode[] = []): A2UINode[] {
  into.push(node);
  for (const child of childNodes(node)) {
    walk(child, into);
  }
  return into;
}

/**
 * Validate a node against `@a2ra/core`'s strict recursive parser (the A2UI spec
 * is its Zod schemas, ADR-22); throws a ZodError on any non-conforming node.
 * `@a2ra/core@1.0.0-preview.7` ships `.d.ts` files whose exported symbols
 * resolve to `error` under type-aware lint (an upstream packaging defect noted
 * in `compile.test.ts`), so `parseNode` is disabled for the unsafe-call rule
 * only.
 */
function assertValidA2uiNode(node: A2UINode): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- @a2ra/core d.ts type-resolution defect
  parseNode(node);
}

describe("A2UI golden corpus (v2 - current generation)", () => {
  for (const { fixture, golden, local } of CORPUS) {
    describe(golden, () => {
      const compiled = compileForm(buildSnapshot(fixture, local === true), {});
      const goldenPath = path.join(GOLDEN_DIR, golden);

      it("compiles to a spec-valid A2UI document per step", () => {
        // One document per step, keyed by stepId in form order.
        expect(compiled.documents.length).toBeGreaterThan(0);
        for (const doc of compiled.documents) {
          for (const node of walk(doc.root)) {
            expect(() => {
              assertValidA2uiNode(node);
            }).not.toThrow();
          }
        }
      });

      it("matches the committed golden document (append-only - never edit to fit)", () => {
        const serialized = serialize(compiled);

        if (process.env.UPDATE_GOLDEN === "1") {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(goldenPath, serialized, "utf8");
          return;
        }

        if (!existsSync(goldenPath)) {
          throw new Error(
            `golden ${golden} is missing - a corpus form has no committed golden. ` +
              `Seed it once, hand-review, and commit: UPDATE_GOLDEN=1 pnpm exec vitest run --project @qcms/a2ui-compiler golden-corpus`,
          );
        }

        const goldenText = readFileSync(goldenPath, "utf8");
        const expected = JSON.parse(goldenText) as CompiledForm;
        // Structural first: a shape change reports the exact document and path
        // (e.g. `documents[1].root.children[0].children[3].props.maxLength`),
        // the readable per-document diff the corpus exists to produce
        // (exit criterion 3).
        expect(compiled).toEqual(expected);
        // Then byte-exact, so formatting/key-order drift is caught too.
        expect(serialized).toBe(goldenText);
      });

      it("appends a honeypot decoy as the last field of each step (task 026)", () => {
        for (const doc of compiled.documents) {
          // root: Form → Flex(column) → [headings…, controls…, Honeypot].
          const flex = childNodes(doc.root)[0];
          expect(flex).toBeDefined();
          const fields = childNodes(flex!);
          const last = fields[fields.length - 1];
          expect(last?.type).toBe("Honeypot");
          // Exactly one honeypot per document (no stray duplicates).
          expect(fields.filter((n) => n.type === "Honeypot").length).toBe(1);
        }
      });
    });
  }
});

/**
 * The frozen `v1/` generation remains a valid contract forever (ADR-18, the
 * stored copy is served for the life of any snapshot compiled under it). We do
 * *not* recompile it - the live compiler now emits v2 - but every committed v1
 * document must still parse as a spec-valid `@a2ra/core` document so the
 * vendored renderer keeps rendering old stored snapshots.
 */
describe("A2UI golden corpus (v1 - retained, still spec-valid)", () => {
  // Iterated from disk, not from CORPUS: `v1/` is a closed historical set, so a
  // corpus entry appended after it was frozen (task 048's two) has no v1 document
  // and must not be looked for.
  const v1Goldens = readdirSync(GOLDEN_V1_DIR)
    .filter((file) => file.endsWith(".a2ui.json"))
    .sort();

  for (const golden of v1Goldens) {
    it(`${golden} remains a valid @a2ra/core document`, () => {
      const text = readFileSync(path.join(GOLDEN_V1_DIR, golden), "utf8");
      const doc = JSON.parse(text) as CompiledForm;
      for (const document of doc.documents) {
        for (const node of walk(document.root)) {
          expect(() => {
            assertValidA2uiNode(node);
          }).not.toThrow();
        }
      }
      // v1 predates the honeypot: no decoy node in the retained generation.
      for (const document of doc.documents) {
        expect(walk(document.root).some((n) => n.type === "Honeypot")).toBe(false);
      }
    });
  }
});
