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
 * A2UI golden corpus runner (task 012, ADR-18; generation bumped in 026 and by
 * issue #186). Each corpus form is a `@qcms/core` fixture; the runner rebuilds
 * its published {@link FrozenSnapshot} through the real publish path
 * (`compileDraft`, task 008), compiles it with the launch compiler
 * (`compileForm`, task 011), and asserts the output equals the committed golden
 * document under the **current** generation directory `golden/v3/`.
 *
 * Each generation is a mapping change that altered existing output, handled by a
 * new directory rather than by editing the previous one (ADR-18, append-only):
 *
 * - `v1/` - compiler `0.0.0`, the original corpus (task 012).
 * - `v2/` - compiler `0.1.0`, task 026's honeypot decoy in every step document.
 * - `v3/` - compiler `0.2.0`, issue #186: every compiled heading carries `size`
 *   and `weight`, so a form title and a step title stop rendering at body size
 *   and body weight.
 *
 * Every earlier generation stays committed as the faithful record of what that
 * compiler produced, and is still asserted spec-valid below. They are never
 * recompiled: the live compiler emits the current generation, and a stored
 * snapshot is served from its own bytes forever (`golden/README.md` spec-bump
 * procedure).
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
const GOLDEN_DIR = fileURLToPath(new URL("../golden/v3/", import.meta.url));

/**
 * The frozen generations, oldest first, and what is still true of each. Retained
 * forever (ADR-18) and asserted spec-valid rather than recompiled.
 *
 * The per-generation assertion is what stops "retained" collapsing into "present":
 * `v1` predates the honeypot and must not have one, `v2` has the honeypot and
 * predates issue #186's heading typography and must not have that. Each pins the
 * property that made its successor a new generation, from the older side.
 */
const RETAINED_GENERATIONS: readonly {
  readonly dir: string;
  readonly compiler: string;
  readonly hasHoneypot: boolean;
  readonly hasHeadingTypography: boolean;
}[] = [
  { dir: "v1", compiler: "0.0.0", hasHoneypot: false, hasHeadingTypography: false },
  { dir: "v2", compiler: "0.1.0", hasHoneypot: true, hasHeadingTypography: false },
];

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

describe("A2UI golden corpus (v3 - current generation)", () => {
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

      it("gives every heading a size and weight above the body's (issue #186)", () => {
        // The assertion #186 asks for, and the reason it is here rather than in a
        // renderer test: the defect was that headings looked exactly like the body copy
        // beside them, which no gate could see, because the elements were correct and only
        // the typography was absent. Asserted against the vendored `Text` component's own
        // defaults, so a future flip of THOSE cannot silently reintroduce it - the compiled
        // document has to state the intent, not inherit it.
        const TEXT_DEFAULT_SIZE = "md";
        const TEXT_DEFAULT_WEIGHT = "normal";

        const headings = compiled.documents.flatMap((doc) =>
          walk(doc.root).filter(
            (node) => node.type === "Text" && /^h[1-6]$/u.test(String(node.props?.as ?? "")),
          ),
        );
        expect(headings.length).toBeGreaterThan(0);

        for (const node of headings) {
          const props = node.props ?? {};
          expect(props.size, `${String(props.as)} must carry a size`).toBeDefined();
          expect(props.weight, `${String(props.as)} must carry a weight`).toBeDefined();
          expect(props.size).not.toBe(TEXT_DEFAULT_SIZE);
          expect(props.weight).not.toBe(TEXT_DEFAULT_WEIGHT);
        }

        // And the two levels differ from each other, so the form title outranks the step
        // title rather than merely outranking the body.
        const h1 = headings.find((node) => node.props?.as === "h1")?.props;
        const h2 = headings.find((node) => node.props?.as === "h2")?.props;
        expect(h2).toBeDefined();
        if (h1 !== undefined) {
          expect(h1.size).not.toBe(h2?.size);
          expect(h1.weight).not.toBe(h2?.weight);
        }
      });
    });
  }
});

/**
 * Every frozen generation remains a valid contract forever (ADR-18, the stored copy
 * is served for the life of any snapshot compiled under it). They are *not*
 * recompiled - the live compiler emits the current generation - but every committed
 * document must still parse as a spec-valid `@a2ra/core` document, so the vendored
 * renderer keeps rendering old stored snapshots.
 *
 * Each generation also carries the assertion that made its successor a new
 * generation, from the older side: `v1` has no honeypot, `v2` has one and no heading
 * typography. Without those, "retained" would mean nothing more than "the file is
 * still on disk", and a directory quietly regenerated under a later compiler would
 * pass.
 */
describe.each(RETAINED_GENERATIONS)(
  "A2UI golden corpus ($dir - retained, compiler $compiler)",
  ({ dir, hasHoneypot, hasHeadingTypography }) => {
    const generationDir = fileURLToPath(new URL(`../golden/${dir}/`, import.meta.url));

    // Iterated from disk, not from CORPUS: each retained generation is a closed
    // historical set, so a corpus entry appended after it was frozen (task 048's two
    // are absent from `v1/`) has no document there and must not be looked for.
    const goldens = readdirSync(generationDir)
      .filter((file) => file.endsWith(".a2ui.json"))
      .sort();

    for (const golden of goldens) {
      it(`${golden} remains a valid @a2ra/core document`, () => {
        const text = readFileSync(path.join(generationDir, golden), "utf8");
        const doc = JSON.parse(text) as CompiledForm;
        const nodes = doc.documents.flatMap((document) => walk(document.root));
        for (const node of nodes) {
          expect(() => {
            assertValidA2uiNode(node);
          }).not.toThrow();
        }

        expect(nodes.some((node) => node.type === "Honeypot")).toBe(hasHoneypot);

        const headings = nodes.filter(
          (node) => node.type === "Text" && /^h[1-6]$/u.test(String(node.props?.as ?? "")),
        );
        expect(headings.length).toBeGreaterThan(0);
        expect(headings.some((node) => node.props?.size !== undefined)).toBe(
          hasHeadingTypography,
        );
      });
    }
  },
);
