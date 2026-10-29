/**
 * A vendored `a2-react-aria` component is registered in eight places and this is the one red that
 * names all eight, anchored on `packages/ui/a2ra-manifest.json`. The lists are parsed, not imported,
 * and parsing fails open, so each parser has an anti-vacuity assertion in "the derivations" below.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The vendored upstream tree. Only `a2ui/` is upstream's; its siblings are QCMS-owned. */
const VENDORED_ROOT = join(REPO_ROOT, "packages/ui/src/components/a2ui");

function source(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

function quotedStrings(fragment: string): string[] {
  return [...fragment.matchAll(/"([^"]*)"/gu)].map((match) => match[1] ?? "");
}

/** Empty when either marker is absent, which the anti-vacuity assertions turn into a red. */
function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  if (start === -1) return "";
  const from = start + open.length;
  const end = text.indexOf(close, from);
  return end === -1 ? "" : text.slice(from, end);
}

function manifestComponents(): readonly string[] {
  const manifest: unknown = JSON.parse(source("packages/ui/a2ra-manifest.json"));
  const components = (manifest as { components?: unknown }).components;
  return Array.isArray(components) ? [...components].map(String).sort() : [];
}

function vendoredDirectories(): readonly string[] {
  const directories = new Set<string>();
  for (const file of trackedFilesUnder(VENDORED_ROOT)) {
    const [directory, ...rest] = file.split("/");
    // A file at the root of the vendored tree is shared source, not a component, and has no
    // registration of its own.
    if (directory === undefined || rest.length === 0) continue;
    directories.add(directory);
  }
  return [...directories].sort();
}

const KIT_REEXPORT =
  /export\s+(type\s+)?\{([^}]*)\}\s+from\s+"\.\/components\/a2ui\/([^"/]+)\/index\.ts"/gu;

/** Every exported name in a `{ ... }` clause, with `X as Y` reported as `Y`. */
function exportedNames(clause: string): string[] {
  return clause
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const parts = entry.split(/\s+as\s+/u);
      return (parts.at(-1) ?? entry).trim();
    });
}

function kitVendoredExports(): ReadonlyMap<string, string> {
  const barrel = source("packages/ui/src/kit.ts");
  const exports = new Map<string, string>();
  for (const match of barrel.matchAll(KIT_REEXPORT)) {
    // `export type` re-exports are the node and props types, not controls, so they have no
    // registration path.
    if (match[1] !== undefined) continue;
    for (const name of exportedNames(match[2] ?? "")) exports.set(name, match[3] ?? "");
  }
  return exports;
}

function kitAllExports(): ReadonlySet<string> {
  const barrel = source("packages/ui/src/kit.ts");
  const names = new Set<string>(kitVendoredExports().keys());
  for (const match of barrel.matchAll(/export\s+\{([^}]*)\}\s+from\s+"react-aria-components"/gu)) {
    for (const name of exportedNames(match[1] ?? "")) names.add(name);
  }
  return names;
}

function kitTestPinnedNames(): ReadonlySet<string> {
  const spec = source("packages/ui/src/kit.test.tsx");
  return new Set(quotedStrings(between(spec, "new Set([", "]),")));
}

function kitTestRenderedNames(): ReadonlySet<string> {
  const spec = source("packages/ui/src/kit.test.tsx");
  const table = between(spec, "const PRIMITIVES = [", "] as const;");
  return new Set([...table.matchAll(/\[\s*"([A-Za-z]+)",/gu)].map((match) => match[1] ?? ""));
}

function adminKitExports(): ReadonlySet<string> {
  const boundary = source("apps/admin/components/kit.tsx");
  const clause = between(boundary, "export {", '} from "@roonga/qcms-ui/kit";');
  return new Set(exportedNames(clause));
}

function contractKitListing(): ReadonlySet<string> {
  const contract = source("docs/features/033-component-contract.md");
  const listing = /`components\/kit\.tsx` exports: `([^`]+)`/u.exec(contract)?.[1] ?? "";
  return new Set(
    listing
      .split(/[\s,]+/u)
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  );
}

interface RegistryEntry {
  readonly type: string;
  /**
   * Derived, not listed: the registry wraps a schema in `withAuthorMessages` exactly when
   * the node may carry ADR-32 author messages, and a message belongs to a question, so the
   * structural nodes, choice leaves, honeypot and submit button fall out on their own.
   */
  readonly isQuestion: boolean;
}

function registryEntries(): readonly RegistryEntry[] {
  const registry = source("packages/ui/src/registry.tsx");
  const literal = between(registry, "return createRegistry(", "{ strict: true },");
  const flat = literal.replace(/\s+/gu, " ");
  return [...flat.matchAll(/(\w+): \{ component: \w+, schema: ([^}]+)\}/gu)].map((match) => ({
    type: match[1] ?? "",
    isQuestion: (match[2] ?? "").includes("withAuthorMessages("),
  }));
}

function registryVendoredDirectories(): ReadonlySet<string> {
  const registry = source("packages/ui/src/registry.tsx");
  const matches = registry.matchAll(/from "\.\/components\/a2ui\/([^"/]+)\/index\.ts"/gu);
  return new Set([...matches].map((match) => match[1] ?? ""));
}

function commitMomentRows(): ReadonlyMap<string, string> {
  const visible = source("apps/portal/lib/visible.ts");
  const table = between(visible, "const COMMIT_MOMENT_BY_CONTROL", "]);");
  const rows = new Map<string, string>();
  for (const match of table.matchAll(/\["(\w+)", "(\w+)"\]/gu)) {
    rows.set(match[1] ?? "", match[2] ?? "");
  }
  return rows;
}

function commitMomentValues(): ReadonlySet<string> {
  const visible = source("apps/portal/lib/visible.ts");
  const union = between(visible, "export type CommitMoment =", ";");
  return new Set(quotedStrings(union));
}

function defaultCommitMoment(): string {
  const visible = source("apps/portal/lib/visible.ts");
  return /export const DEFAULT_COMMIT_MOMENT: CommitMoment = "(\w+)"/u.exec(visible)?.[1] ?? "";
}

/**
 * Anchored on an upper-case initial because node types are PascalCase and the word `type`
 * is not reserved to them: an axe violation's `type: "tag"` is harvested unanchored.
 */
const A2UI_NODE_TYPE_JSON = /"type":\s*"([A-Z]\w*)"/gu;
const A2UI_NODE_TYPE_SOURCE = /type: "([A-Z]\w*)"/gu;

/**
 * Two sources, because the golden corpus is append-only: a control the corpus does not yet
 * exercise gets its document from the hand-written step fixtures instead.
 */
function renderedNodeTypes(): ReadonlySet<string> {
  const types = new Set<string>();
  const golden = join(REPO_ROOT, "packages/a2ui-compiler/golden");
  for (const file of trackedFilesUnder(golden, { match: /\.a2ui\.json$/u })) {
    for (const type of readFileSync(join(golden, file), "utf8").matchAll(A2UI_NODE_TYPE_JSON)) {
      types.add(type[1] ?? "");
    }
  }
  const support = join(REPO_ROOT, "packages/ui/src/test-support");
  for (const file of trackedFilesUnder(support, { match: /\.tsx?$/u })) {
    for (const type of readFileSync(join(support, file), "utf8").matchAll(A2UI_NODE_TYPE_SOURCE)) {
      types.add(type[1] ?? "");
    }
  }
  return types;
}

function gap(component: string, file: string, wanted: string): string {
  return `${component} -> ${file}: ${wanted}`;
}

function registrationGaps(): readonly string[] {
  const manifest = new Set(manifestComponents());
  const directories = vendoredDirectories();
  const kitExports = kitVendoredExports();
  const pinned = kitTestPinnedNames();
  const rendered = kitTestRenderedNames();
  const admin = adminKitExports();
  const contract = contractKitListing();
  const registry = registryEntries();
  const registryDirectories = registryVendoredDirectories();
  const moments = commitMomentRows();
  const documents = renderedNodeTypes();
  const kitDirectories = new Set(kitExports.values());

  const gaps: string[] = [];

  for (const directory of directories) {
    if (!manifest.has(directory)) {
      gaps.push(
        gap(
          directory,
          "packages/ui/a2ra-manifest.json",
          "run `node scripts/check-a2ra-fidelity.mjs --refresh` in the same change as the " +
            "pin move or the `a2ra add`, so the ADR-22 fidelity gate hashes this component " +
            "against upstream at the pinned commit",
        ),
      );
    }
    if (!kitDirectories.has(directory) && !registryDirectories.has(directory)) {
      gaps.push(
        gap(
          directory,
          "packages/ui/src/kit.ts or packages/ui/src/registry.tsx",
          "re-export the component from the kit barrel for admin screens, or register it in " +
            "`createRegistry` for the A2UI renderer, or both: vendored source that neither " +
            "door reaches is dead weight under an ADR-22 fidelity gate that will keep " +
            "checking it forever",
        ),
      );
    }
  }

  for (const [name, directory] of kitExports) {
    const label = `${directory}/${name}`;
    if (!pinned.has(name)) {
      gaps.push(
        gap(
          label,
          "packages/ui/src/kit.test.tsx",
          "add the name to the pinned export set, which is what proves at runtime that the " +
            "barrel exports exactly what it claims and no more",
        ),
      );
    }
    if (!rendered.has(name)) {
      gaps.push(
        gap(
          label,
          "packages/ui/src/kit.test.tsx",
          "add a `PRIMITIVES` row with the minimal props it needs, so the component is " +
            "rendered standalone and swept by axe before any screen consumes it",
        ),
      );
    }
    if (!admin.has(name)) {
      gaps.push(
        gap(
          label,
          "apps/admin/components/kit.tsx",
          're-export the name from the admin\'s single `"use client"` boundary: every kit ' +
            "component is interactive react-aria, so an admin server component cannot reach " +
            "it by any other route",
        ),
      );
    }
    if (!contract.has(name)) {
      gaps.push(
        gap(
          label,
          "docs/features/033-component-contract.md",
          "add the name to the `components/kit.tsx` exports line in the Kit reality section, " +
            "which is what an admin lane reads before reaching for a substitution",
        ),
      );
    }
  }

  // Asked of each question control rather than each directory, because one component
  // directory can serve both a question control and a choice leaf.
  for (const entry of registry) {
    if (!entry.isQuestion) continue;
    if (!moments.has(entry.type)) {
      gaps.push(
        gap(
          entry.type,
          "apps/portal/lib/visible.ts",
          "add a `COMMIT_MOMENT_BY_CONTROL` row choosing this control's ADR-31 commit " +
            "moment. The decision is `change`, `completion`, `blur` or `groupExit` and it is " +
            "reasoned from ADR-31, not defaulted: `DEFAULT_COMMIT_MOMENT` is runtime " +
            "resilience for a control the portal does not recognise, and a registry control " +
            "relying on it has skipped the decision. If no ADR-31 row fits, that is an " +
            "ADR-31 amendment (`docs/adr/portal.md`), not an improvised moment",
        ),
      );
    }
    if (!documents.has(entry.type)) {
      gaps.push(
        gap(
          entry.type,
          "packages/a2ui-compiler/golden or packages/ui/src/test-support",
          "give the control a document to render: APPEND a golden form that exercises it " +
            "(never edit one), or add a hand-written step fixture beside `select-step.ts`. " +
            "`conformance.test.tsx` and `required-marker.test.tsx` derive their per-type " +
            "sets from what the documents contain, so a control in neither is a control " +
            "those suites silently do not cover",
        ),
      );
    }
  }

  return gaps.sort((left, right) => left.localeCompare(right));
}

const HOW_TO_REGISTER = [
  "A vendored component under `packages/ui/src/components/a2ui/` is registered in eight",
  "places, and at least one place has not heard of at least one component. Each line below",
  "is one component and one place, with the entry that place wants.",
  "`docs/COMPONENT_GUIDELINES.md` states the whole add-a-control path in prose, including",
  "the steps this gate cannot see.",
].join("\n");

describe("every vendored component is registered in all eight places (issue #91)", () => {
  it("names every component and place that has not heard of the other, in one failure", () => {
    expect(registrationGaps(), HOW_TO_REGISTER).toEqual([]);
  });

  it("holds no component the vendored tree does not have", () => {
    const directories = new Set(vendoredDirectories());
    const kitExports = kitVendoredExports();
    const exported = kitAllExports();
    const registered = new Set(registryEntries().map((entry) => entry.type));

    const stale: string[] = [];
    for (const component of manifestComponents()) {
      if (!directories.has(component)) {
        stale.push(`packages/ui/a2ra-manifest.json lists ${component}, which is not vendored`);
      }
    }
    for (const [place, listed] of [
      ["packages/ui/src/kit.test.tsx pinned set", kitTestPinnedNames()],
      ["packages/ui/src/kit.test.tsx PRIMITIVES", kitTestRenderedNames()],
      ["apps/admin/components/kit.tsx", adminKitExports()],
      ["docs/features/033-component-contract.md", contractKitListing()],
    ] as const) {
      for (const name of listed) {
        if (!exported.has(name)) {
          stale.push(`${place} names ${name}, which the kit barrel does not export`);
        }
      }
    }
    for (const control of commitMomentRows().keys()) {
      if (!registered.has(control)) {
        stale.push(
          `apps/portal/lib/visible.ts gives ${control} a commit moment, but the registry has no such control`,
        );
      }
    }
    for (const directory of kitExports.values()) {
      if (!directories.has(directory)) {
        stale.push(`packages/ui/src/kit.ts re-exports from ${directory}, which is not vendored`);
      }
    }
    expect(stale.sort((left, right) => left.localeCompare(right))).toEqual([]);
  });
});

/**
 * The one translation nothing can derive. Keyed by MOMENT rather than by control, so
 * adding a control adds no row; a changed phrase in ADR-31 reds as an untranslatable
 * moment, which is the intended outcome for an amendment the code has not caught up with.
 */
const MOMENT_FOR_ADR_PHRASE: ReadonlyMap<string, string> = new Map([
  ["on change", "change"],
  ["on blur", "blur"],
  ["when editing ends and the date is complete", "completion"],
  ["when focus leaves the group", "groupExit"],
]);

function normalizeType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

/**
 * `QUESTION_TYPE_SET` carries `satisfies Record<QuestionType, true>`, so the build refuses
 * a missing or departed union member. That is what makes it the one enumeration of
 * question types that cannot quietly shrink.
 */
function kernelQuestionTypes(): ReadonlySet<string> {
  const definition = source("packages/core/src/question-definition.ts");
  const literal = between(definition, "const QUESTION_TYPE_SET = {", "} as const satisfies");
  return new Set(
    [...literal.matchAll(/(\w+): true/gu)].map((match) => normalizeType(match[1] ?? "")),
  );
}

function adrCommitMoments(): ReadonlyMap<string, string> {
  const adr = source("docs/adr/portal.md");
  const table = between(adr, "### ADR-31 - Answer commitment", "### ADR-39");
  const wanted = new Map<string, string>();
  for (const line of table.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    // A table row is `| controls | moment |`, so four cells with two empty edges.
    if (cells.length !== 4) continue;
    const moment = MOMENT_FOR_ADR_PHRASE.get(cells[2] ?? "");
    if (moment === undefined) continue;
    for (const type of (cells[1] ?? "").split(",")) {
      const normalized = normalizeType(type);
      if (normalized !== "") wanted.set(normalized, moment);
    }
  }
  return wanted;
}

/**
 * Bounded to the "Question-type mapping" section, because the honeypot section has a same-shaped
 * table. A type maps to a SET of controls: `singleChoice` has two renderings either side of the threshold.
 */
function controlForQuestionType(): ReadonlyMap<string, ReadonlySet<string>> {
  const mapping = between(
    source("docs/a2ui-mapping.md"),
    "## Question-type mapping",
    "### Documented choices",
  );
  const controls = new Map<string, Set<string>>();
  for (const line of mapping.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const type = /^`(\w+)`/u.exec(cells[1] ?? "")?.[1];
    const control = /^`(\w+)`/u.exec(cells[2] ?? "")?.[1];
    if (type === undefined || control === undefined) continue;
    const normalized = normalizeType(type);
    const existing = controls.get(normalized);
    if (existing === undefined) controls.set(normalized, new Set([control]));
    else existing.add(control);
  }
  return controls;
}

/**
 * Only the properties of the classification itself; date retraction, same-step visibility ordering
 * and retraction posting are behaviour, asserted elsewhere.
 */
describe("the ADR-31 commit-moment classification (issue #91)", () => {
  it("condition: every moment is one of the four ADR-31 admits", () => {
    const admitted = commitMomentValues();
    const wrong = [...commitMomentRows()]
      .filter(([, moment]) => !admitted.has(moment))
      .map(([control, moment]) => `${control} commits at "${moment}"`);
    expect(
      wrong,
      "ADR-31 has four commit moments and `CommitMoment` in `apps/portal/lib/visible.ts` " +
        "declares them. A row naming anything else is a moment the record does not have",
    ).toEqual([]);
  });

  it("condition: the fallback stays declared, and stays the conservative one", () => {
    // The fallback is only safe while it is the LATEST moment: anything earlier lets an
    // unclassified control post mid-entry, and deleting it loses the answer entirely.
    expect(
      defaultCommitMoment(),
      "`DEFAULT_COMMIT_MOMENT` in `apps/portal/lib/visible.ts` is ADR-31 runtime resilience " +
        "and must stay `blur`, the latest of the four moments",
    ).toBe("blur");
  });

  it("condition: every classified control commits at the moment ADR-31's table gives it", () => {
    const wanted = adrCommitMoments();
    const controls = controlForQuestionType();
    const rows = commitMomentRows();

    const disagreements: string[] = [];
    const compared = new Set<string>();
    for (const [type, moment] of wanted) {
      for (const control of controls.get(type) ?? []) {
        const actual = rows.get(control);
        if (actual === undefined) continue; // place 7 of the checklist reports the absence
        compared.add(control);
        if (actual !== moment) {
          disagreements.push(
            `${type} compiles to ${control}, which ADR-31 commits at "${moment}", but ` +
              `apps/portal/lib/visible.ts commits it at "${actual}"`,
          );
        }
      }
    }
    // A set of controls reached, not a count of pairs: a count has slack whenever one
    // question type maps to two controls, and `singleChoice` does.
    expect(
      [...rows.keys()].filter((control) => !compared.has(control)).sort(),
      "every control in `COMMIT_MOMENT_BY_CONTROL` must be reached through " +
        "`docs/a2ui-mapping.md`'s compilation table and checked against ADR-31's moment " +
        "for its question type. A control missing here is one whose agreement with the " +
        "record has silently stopped being checked, usually because the mapping row that " +
        "named it no longer parses",
    ).toEqual([]);
    expect(
      disagreements.sort((left, right) => left.localeCompare(right)),
      "`COMMIT_MOMENT_BY_CONTROL` in `apps/portal/lib/visible.ts` is keyed by CONTROL and " +
        "ADR-31's table is written by QUESTION TYPE; `docs/a2ui-mapping.md` is what pairs " +
        "them. A disagreement is either a wrong row or an ADR-31 amendment that the code " +
        "has not caught up with",
    ).toEqual([]);
  });

  it("condition: both documents reach every question type the KERNEL holds", () => {
    const kernel = kernelQuestionTypes();
    const mapped = controlForQuestionType();
    const wanted = adrCommitMoments();

    const gaps: string[] = [];
    for (const type of kernel) {
      if (!mapped.has(type)) {
        gaps.push(
          `${type} -> docs/a2ui-mapping.md: add a compilation row naming the control this ` +
            "question type compiles to, or its commit moment is checked against nothing",
        );
      }
      if (!wanted.has(type)) {
        gaps.push(
          `${type} -> docs/adr/portal.md: add a row to ADR-31's commitment table, or this ` +
            "type's control commits at a moment the record never decided",
        );
      }
    }
    for (const type of mapped.keys()) {
      if (!kernel.has(type)) {
        gaps.push(
          `${type} -> docs/a2ui-mapping.md: the compilation table names a question type ` +
            "`QUESTION_TYPE_SET` in `packages/core/src/question-definition.ts` does not have",
        );
      }
    }
    expect(gaps.sort((left, right) => left.localeCompare(right))).toEqual([]);
  });
});

describe("the derivations", () => {
  it("finds the same component set in the manifest and in the tree", () => {
    // Deliberately not a restated list of components: a list here would be a ninth place
    // to register one.
    expect(manifestComponents()).toEqual([...vendoredDirectories()]);
    expect(vendoredDirectories().length).toBeGreaterThan(1);
  });

  it("finds a barrel, a registry, a classification and a corpus, none of them empty", () => {
    expect(kernelQuestionTypes().size).toBeGreaterThan(1);
    expect(kitVendoredExports().size).toBeGreaterThan(1);
    expect(kitAllExports().size).toBeGreaterThan(kitVendoredExports().size);
    expect(kitTestPinnedNames().size).toBeGreaterThan(1);
    expect(kitTestRenderedNames().size).toBeGreaterThan(1);
    expect(adminKitExports().size).toBeGreaterThan(1);
    expect(contractKitListing().size).toBeGreaterThan(1);
    expect(registryEntries().length).toBeGreaterThan(1);
    expect(registryVendoredDirectories().size).toBeGreaterThan(1);
    expect(commitMomentRows().size).toBeGreaterThan(1);
    expect(commitMomentValues().size).toBe(MOMENT_FOR_ADR_PHRASE.size);
    expect(adrCommitMoments().size).toBeGreaterThan(1);
    expect(controlForQuestionType().size).toBeGreaterThan(1);
    expect(renderedNodeTypes().size).toBeGreaterThan(1);
  });

  it("tells a question control from a structural node without listing either", () => {
    const entries = registryEntries();
    const questions = entries.filter((entry) => entry.isQuestion).map((entry) => entry.type);
    const rest = entries.filter((entry) => !entry.isQuestion).map((entry) => entry.type);
    expect(questions.length).toBeGreaterThan(1);
    expect(rest).toContain("Form");
    expect(rest).toContain("Honeypot");
    expect(questions).not.toContain("Form");
    expect(questions).not.toContain("Honeypot");
  });
});
