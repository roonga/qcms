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
} from "@roonga/qcms-core";
import { parseNode } from "@a2ra/core";
import { describe, expect, it } from "vitest";

import { compileForm } from "./compile.js";
import { REPEAT_GROUP_NODE_TYPE } from "./repeat-group.js";
import type { A2UINode, CompiledForm } from "./types.js";

// A committed golden is never edited: output that changes opens a new generation
// directory instead (ADR-18, `golden/README.md`). Seed a new one with
// `UPDATE_GOLDEN=1`; the append-only CI guard refuses any other edit.

const CORE_FIXTURES = fileURLToPath(new URL("../../core/fixtures/", import.meta.url));
// For entries whose questions cannot live in the kernel fixture set, which is
// asserted to cover each question type exactly once.
const LOCAL_FIXTURES = fileURLToPath(new URL("../fixtures/corpus/", import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL("../golden/v4/", import.meta.url));

// Each generation pins, from the older side, the property that made its
// successor a new generation, so "retained" cannot collapse into "present".
const RETAINED_GENERATIONS: readonly {
  readonly dir: string;
  readonly compiler: string;
  readonly hasHoneypot: boolean;
  readonly hasHeadingTypography: boolean;
  readonly hasRepeatGroup: boolean;
}[] = [
  {
    dir: "v1",
    compiler: "0.0.0",
    hasHoneypot: false,
    hasHeadingTypography: false,
    hasRepeatGroup: false,
  },
  {
    dir: "v2",
    compiler: "0.1.0",
    hasHoneypot: true,
    hasHeadingTypography: false,
    hasRepeatGroup: false,
  },
  {
    dir: "v3",
    compiler: "0.2.0",
    hasHoneypot: true,
    hasHeadingTypography: true,
    hasRepeatGroup: false,
  },
];

// Append-only (ADR-18): a row's bytes freeze once a generation ships, which is
// what makes each later feature provably additive.
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
  { fixture: "repeat-open-group.json", golden: "repeat-open-group.a2ui.json", local: true },
  { fixture: "repeat-count-sources.json", golden: "repeat-count-sources.a2ui.json", local: true },
  // Appended rather than a new generation: the template node already carried
  // `presentation`, so no compiler output moved.
  { fixture: "repeat-table-group.json", golden: "repeat-table-group.a2ui.json", local: true },
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
  return result.value.snapshot;
}

/** The on-disk golden form: two-space indent, trailing newline. */
function serialize(compiled: CompiledForm): string {
  return `${JSON.stringify(compiled, null, 2)}\n`;
}

function childNodes(node: A2UINode): readonly A2UINode[] {
  const children = node.children;
  return children !== undefined && typeof children !== "string" ? children : [];
}

function walk(node: A2UINode, into: A2UINode[] = []): A2UINode[] {
  into.push(node);
  for (const child of childNodes(node)) {
    walk(child, into);
  }
  return into;
}

// Validates against the vendored strict parser (ADR-22), which throws on any
// non-conforming node.
function assertValidA2uiNode(node: A2UINode): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- @a2ra/core d.ts type-resolution defect
  parseNode(node);
}

function headingLevel(node: A2UINode): string | undefined {
  if (node.type !== "Text") return undefined;
  const as: unknown = node.props?.as;
  return typeof as === "string" && /^h[1-6]$/u.test(as) ? as : undefined;
}

describe("A2UI golden corpus (v4 - current generation)", () => {
  for (const { fixture, golden, local } of CORPUS) {
    describe(golden, () => {
      const compiled = compileForm(buildSnapshot(fixture, local === true), {});
      const goldenPath = path.join(GOLDEN_DIR, golden);

      it("compiles to a spec-valid A2UI document per step", () => {
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
              `Seed it once, hand-review, and commit: UPDATE_GOLDEN=1 pnpm exec vitest run --project @roonga/qcms-a2ui-compiler golden-corpus`,
          );
        }

        const goldenText = readFileSync(goldenPath, "utf8");
        const expected = JSON.parse(goldenText) as CompiledForm;
        // Structural first, so a shape change names the document and path.
        expect(compiled).toEqual(expected);
        expect(serialized).toBe(goldenText);
      });

      it("appends a honeypot decoy as the last field of each step (task 026)", () => {
        for (const doc of compiled.documents) {
          const flex = childNodes(doc.root)[0];
          expect(flex).toBeDefined();
          const fields = childNodes(flex!);
          const last = fields[fields.length - 1];
          expect(last?.type).toBe("Honeypot");
          expect(fields.filter((n) => n.type === "Honeypot").length).toBe(1);
        }
      });

      it("gives every heading a size and weight above the body's (issue #186)", () => {
        // The vendored component's own defaults: a future flip of them must not
        // make a heading read as body copy, so the document states the intent.
        const TEXT_DEFAULT_SIZE = "md";
        const TEXT_DEFAULT_WEIGHT = "normal";

        const headings = compiled.documents
          .flatMap((doc) => walk(doc.root))
          .map((node) => ({ level: headingLevel(node), props: node.props ?? {} }))
          .filter((entry) => entry.level !== undefined);
        expect(headings.length).toBeGreaterThan(0);

        for (const { level, props } of headings) {
          expect(props.size, `${level!} must carry a size`).toBeDefined();
          expect(props.weight, `${level!} must carry a weight`).toBeDefined();
          expect(props.size).not.toBe(TEXT_DEFAULT_SIZE);
          expect(props.weight).not.toBe(TEXT_DEFAULT_WEIGHT);
        }

        // The form title must outrank the step title, not merely the body.
        const h1 = headings.find((entry) => entry.level === "h1")?.props;
        const h2 = headings.find((entry) => entry.level === "h2")?.props;
        expect(h2).toBeDefined();
        if (h1 !== undefined) {
          expect(h1.size).not.toBe(h2?.size);
          expect(h1.weight).not.toBe(h2?.weight);
        }
      });
    });
  }
});

// A frozen generation is a contract for the life of any snapshot compiled under
// it (ADR-18). The per-generation assertions would also catch a directory
// quietly regenerated under a later compiler.
describe.each(RETAINED_GENERATIONS)(
  "A2UI golden corpus ($dir - retained, compiler $compiler)",
  ({ dir, hasHoneypot, hasHeadingTypography, hasRepeatGroup }) => {
    const generationDir = fileURLToPath(new URL(`../golden/${dir}/`, import.meta.url));

    // From disk, not the corpus table: an entry appended after this generation
    // froze has no document here.
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

        const headings = nodes.filter((node) => headingLevel(node) !== undefined);
        expect(headings.length).toBeGreaterThan(0);
        expect(headings.some((node) => node.props?.size !== undefined)).toBe(hasHeadingTypography);

        expect(nodes.some((node) => node.type === REPEAT_GROUP_NODE_TYPE)).toBe(hasRepeatGroup);
      });
    }
  },
);

// The proof that the template node is additive. Byte equality covers the
// `documents` member alone, the stamp being the one thing a generation moves.
describe("v4 carries the pre-073 corpus across byte-identically (case 5)", () => {
  const V3_DIR = fileURLToPath(new URL("../golden/v3/", import.meta.url));
  const carriedOver = readdirSync(V3_DIR)
    .filter((file) => file.endsWith(".a2ui.json"))
    .sort();

  it("carries all seven", () => {
    expect(carriedOver).toHaveLength(7);
  });

  for (const golden of carriedOver) {
    it(`${golden} has byte-identical documents in v4`, () => {
      const before = JSON.parse(readFileSync(path.join(V3_DIR, golden), "utf8")) as CompiledForm;
      const after = JSON.parse(readFileSync(path.join(GOLDEN_DIR, golden), "utf8")) as CompiledForm;
      expect(JSON.stringify(after.documents, null, 2)).toBe(
        JSON.stringify(before.documents, null, 2),
      );
      expect({ ...after, compilerVersion: before.compilerVersion }).toEqual(before);
      expect(after.compilerVersion).not.toBe(before.compilerVersion);
    });
  }
});

// Expansion clones the template, so a decoy inside it would post once per live
// instance.
describe("the honeypot is never inside a RepeatGroup template (case 34)", () => {
  const REPEAT_CORPUS = CORPUS.filter((entry) => entry.fixture.startsWith("repeat-"));

  it("covers every repeat corpus form", () => {
    // So a repeat form appended without a decoy assertion fails here.
    expect(REPEAT_CORPUS).toHaveLength(3);
  });

  for (const { fixture, golden, local } of REPEAT_CORPUS) {
    it(`${golden} keeps its one decoy outside every template`, () => {
      const compiled = compileForm(buildSnapshot(fixture, local === true), {});
      let groups = 0;
      for (const doc of compiled.documents) {
        const nodes = walk(doc.root);
        expect(nodes.filter((node) => node.type === "Honeypot")).toHaveLength(1);
        for (const group of nodes.filter((node) => node.type === REPEAT_GROUP_NODE_TYPE)) {
          groups += 1;
          expect(walk(group).some((node) => node.type === "Honeypot")).toBe(false);
        }
      }
      expect(groups).toBeGreaterThan(0);
    });
  }
});
