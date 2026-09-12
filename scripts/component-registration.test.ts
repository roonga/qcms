import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Plain JavaScript with a hand-written declaration file beside it, imported by relative
// path the way `apps/admin/lib/route-registration.test.ts` imports the same helper.
import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * A vendored `a2-react-aria` component is registered in eight places, and this is the one
 * red that names all eight (issue #91).
 *
 * ## Why this exists
 *
 * `docs/COMPONENT_GUIDELINES.md` is the prose checklist for adding a control, and it is
 * good; being good is what makes the gap worse, because a lane that reads it, writes the
 * two or three entries it remembers and runs `pnpm verify` gets a green. Most of the
 * places had no completeness check of their own: the kit barrel, the admin's client
 * boundary, the 033 contract listing and the conformance corpus each hold a hand-written
 * list that nothing compared to the vendored tree, so a component missing from one of
 * them does not fail - the list simply covers one component less than it claims to. That
 * is the shape issue #639 names, a guard structurally unable to see the defect.
 *
 * The one that DID have a check is the ADR-31 commit-moment classification, and it had
 * the opposite problem: `apps/portal/lib/visible.ts` falls back to `DEFAULT_COMMIT_MOMENT`
 * for a control it does not recognise, so a new control silently took `blur` and no gate
 * anywhere said the decision had not been made. That is the acceptance criterion issue #91
 * was filed for, and it is place 7 below.
 *
 * ## What this is NOT
 *
 * It is not a ninth registration table. It holds no per-component data of its own, which
 * is the property that keeps it from becoming one more row to write: it derives the
 * component set, derives what each of the eight places knows, and reports which place has
 * not heard of which component. Every place keeps its own test and its own reasons.
 *
 * The failure is collected rather than thrown at the first gap, so one run names every
 * missing pair at once.
 *
 * ## The anchor is the manifest
 *
 * `packages/ui/a2ra-manifest.json`'s `components` array is the anchor, and it is the right
 * one because it is the only list of vendored components that cannot be quietly satisfied:
 * `pnpm check:a2ra-fidelity` regenerates it from UPSTREAM content at the pinned commit
 * (`node scripts/check-a2ra-fidelity.mjs --refresh`, the one mode that needs the network),
 * so a component cannot appear in it without existing upstream, and the vendored tree
 * cannot hold a component the manifest does not list without that gate going red. A new
 * component therefore cannot pass unlisted, and everything below hangs off it.
 *
 * ## The enumeration is git's, not the filesystem's
 *
 * `trackedFilesUnder` rather than a directory walk (issue #641, CONTRIBUTING): a build
 * leaves compiled output beside source, and a walk reads it as a component.
 * `--others --exclude-standard` means a component directory added and not yet staged is
 * still in scope, so this fails while the work is in progress rather than after it is
 * committed.
 *
 * ## Sources are read as text, and what anchors that
 *
 * Each place's list is parsed out of its source rather than imported, because the eight
 * span four workspaces, two apps and a document, and no single Vitest project can load
 * all of them (`packages/ui` is jsdom and React, `apps/portal` is a Next app, and one of
 * the eight is Markdown). The route-registration gate reads its two Playwright specs the
 * same way and for the same reason.
 *
 * Parsing fails open, so every parser here has an anti-vacuity assertion of its own in
 * `describe("the derivations")` below: a regex that stops matching after a refactor
 * returns an empty set, and an empty set makes every claim over it vacuously true. The
 * kit barrel's parse is anchored harder than that: `packages/ui/src/kit.test.tsx` already
 * proves AT RUNTIME that the barrel's function exports are exactly the set pinned in it,
 * so this file comparing the parsed barrel against that same pinned set inherits the
 * runtime claim rather than restating it.
 */

/** The repository root, resolved from this file rather than from the process cwd. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The vendored upstream tree. Only `a2ui/` is upstream's; its siblings are QCMS-owned. */
const VENDORED_ROOT = join(REPO_ROOT, "packages/ui/src/components/a2ui");

/** Read one repo-relative source file. */
function source(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

/** Every double-quoted string in a fragment of source, in order. */
function quotedStrings(fragment: string): string[] {
  return [...fragment.matchAll(/"([^"]*)"/gu)].map((match) => match[1] ?? "");
}

/**
 * The fragment of `text` between `open` and the first `close` after it.
 *
 * Returns the empty string when either marker is absent, which the anti-vacuity
 * assertions below turn into a red rather than into a silent all-clear.
 */
function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  if (start === -1) return "";
  const from = start + open.length;
  const end = text.indexOf(close, from);
  return end === -1 ? "" : text.slice(from, end);
}

// --------------------------------------------------------------------------------------
// The component set: the anchor, and the tree it is anchored to.
// --------------------------------------------------------------------------------------

/** The vendored component directories the ADR-22 fidelity manifest records. */
function manifestComponents(): readonly string[] {
  const manifest: unknown = JSON.parse(source("packages/ui/a2ra-manifest.json"));
  const components = (manifest as { components?: unknown }).components;
  return Array.isArray(components) ? [...components].map(String).sort() : [];
}

/** The vendored component directories actually present in the tree, asked of git. */
function vendoredDirectories(): readonly string[] {
  const directories = new Set<string>();
  for (const file of trackedFilesUnder(VENDORED_ROOT)) {
    const [directory, ...rest] = file.split("/");
    // A file at the root of the vendored tree is shared source (`group-schema-fields.ts`),
    // not a component. The fidelity gate covers it; it has no registration of its own.
    if (directory === undefined || rest.length === 0) continue;
    directories.add(directory);
  }
  return [...directories].sort();
}

// --------------------------------------------------------------------------------------
// The places.
// --------------------------------------------------------------------------------------

/** One `export { ... } from "./components/a2ui/<dir>/index.ts"` statement in the barrel. */
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

/** Kit exports that come from the vendored tree, as export name -> component directory. */
function kitVendoredExports(): ReadonlyMap<string, string> {
  const barrel = source("packages/ui/src/kit.ts");
  const exports = new Map<string, string>();
  for (const match of barrel.matchAll(KIT_REEXPORT)) {
    // `export type` re-exports are the node and props types, not components: an admin
    // screen imports them, but they are not a control and have no registration path.
    if (match[1] !== undefined) continue;
    for (const name of exportedNames(match[2] ?? "")) exports.set(name, match[3] ?? "");
  }
  return exports;
}

/** Every value name the kit barrel exports, vendored or re-exported from the stack. */
function kitAllExports(): ReadonlySet<string> {
  const barrel = source("packages/ui/src/kit.ts");
  const names = new Set<string>(kitVendoredExports().keys());
  for (const match of barrel.matchAll(/export\s+\{([^}]*)\}\s+from\s+"react-aria-components"/gu)) {
    for (const name of exportedNames(match[1] ?? "")) names.add(name);
  }
  return names;
}

/** The export set `packages/ui/src/kit.test.tsx` pins, which it proves at runtime. */
function kitTestPinnedNames(): ReadonlySet<string> {
  const spec = source("packages/ui/src/kit.test.tsx");
  return new Set(quotedStrings(between(spec, "new Set([", "]),")));
}

/** The primitives `packages/ui/src/kit.test.tsx` renders and runs axe over. */
function kitTestRenderedNames(): ReadonlySet<string> {
  const spec = source("packages/ui/src/kit.test.tsx");
  const table = between(spec, "const PRIMITIVES = [", "] as const;");
  return new Set([...table.matchAll(/\[\s*"([A-Za-z]+)",/gu)].map((match) => match[1] ?? ""));
}

/** The kit names the admin's single `"use client"` boundary re-exports. */
function adminKitExports(): ReadonlySet<string> {
  const boundary = source("apps/admin/components/kit.tsx");
  const clause = between(boundary, "export {", '} from "@roonga/qcms-ui/kit";');
  return new Set(exportedNames(clause));
}

/** The kit names the 033 contract's "Kit reality" section lists. */
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

/** One A2UI node type the renderer registry serves. */
interface RegistryEntry {
  /** The node `type` the compiler emits, which is the registry key. */
  readonly type: string;
  /**
   * Whether this entry is a QUESTION control.
   *
   * Derived rather than listed: the registry wraps a control's schema in
   * `withAuthorMessages` exactly when the compiler may put ADR-32 author messages on the
   * node, and `packages/ui/src/author-messages.ts` states the rule that makes that the
   * same set - "a message belongs to a question, and a question is one control". So the
   * structural nodes (`Form`, `Flex`, `Text`), the choice leaves (`Radio`, `Checkbox`),
   * the honeypot and the submit button are excluded without anything here listing them.
   */
  readonly isQuestion: boolean;
}

/** Every entry of the v1 renderer registry, parsed from its `createRegistry` literal. */
function registryEntries(): readonly RegistryEntry[] {
  const registry = source("packages/ui/src/registry.tsx");
  const literal = between(registry, "return createRegistry(", "{ strict: true },");
  const flat = literal.replace(/\s+/gu, " ");
  return [...flat.matchAll(/(\w+): \{ component: \w+, schema: ([^}]+)\}/gu)].map((match) => ({
    type: match[1] ?? "",
    isQuestion: (match[2] ?? "").includes("withAuthorMessages("),
  }));
}

/** The vendored component directories the registry imports a control from. */
function registryVendoredDirectories(): ReadonlySet<string> {
  const registry = source("packages/ui/src/registry.tsx");
  const matches = registry.matchAll(/from "\.\/components\/a2ui\/([^"/]+)\/index\.ts"/gu);
  return new Set([...matches].map((match) => match[1] ?? ""));
}

/** ADR-31's classification as the portal holds it: control node type -> commit moment. */
function commitMomentRows(): ReadonlyMap<string, string> {
  const visible = source("apps/portal/lib/visible.ts");
  const table = between(visible, "const COMMIT_MOMENT_BY_CONTROL", "]);");
  const rows = new Map<string, string>();
  for (const match of table.matchAll(/\["(\w+)", "(\w+)"\]/gu)) {
    rows.set(match[1] ?? "", match[2] ?? "");
  }
  return rows;
}

/** The four moments `CommitMoment` admits, read from the union the portal declares. */
function commitMomentValues(): ReadonlySet<string> {
  const visible = source("apps/portal/lib/visible.ts");
  const union = between(visible, "export type CommitMoment =", ";");
  return new Set(quotedStrings(union));
}

/** The conservative fallback the portal keeps for an unrecognised control. */
function defaultCommitMoment(): string {
  const visible = source("apps/portal/lib/visible.ts");
  return /export const DEFAULT_COMMIT_MOMENT: CommitMoment = "(\w+)"/u.exec(visible)?.[1] ?? "";
}

/**
 * Every node type any conformance document renders.
 *
 * Two sources, because the corpus is append-only and Code-Owner-governed: the golden
 * corpus (`packages/a2ui-compiler/golden/**`), which is what `conformance.test.tsx` and
 * `required-marker.test.tsx` derive their per-type sets from, and the hand-written step
 * fixtures in `packages/ui/src/test-support/`, which is where a control the corpus does
 * not yet exercise gets its document. `Select` is the standing example of the second:
 * `singleChoice` above seven options appears in no golden form, so `select-step.ts`
 * carries it and `round-trip.test.tsx` renders it.
 */
function renderedNodeTypes(): ReadonlySet<string> {
  const types = new Set<string>();
  const golden = join(REPO_ROOT, "packages/a2ui-compiler/golden");
  for (const file of trackedFilesUnder(golden, { match: /\.a2ui\.json$/u })) {
    for (const type of readFileSync(join(golden, file), "utf8").matchAll(/"type":\s*"(\w+)"/gu)) {
      types.add(type[1] ?? "");
    }
  }
  const support = join(REPO_ROOT, "packages/ui/src/test-support");
  for (const file of trackedFilesUnder(support, { match: /\.tsx?$/u })) {
    for (const type of readFileSync(join(support, file), "utf8").matchAll(/type: "(\w+)"/gu)) {
      types.add(type[1] ?? "");
    }
  }
  return types;
}

// --------------------------------------------------------------------------------------
// The checklist.
// --------------------------------------------------------------------------------------

/** One gap: a place, and the entry it wants for a component it has not heard of. */
function gap(component: string, file: string, wanted: string): string {
  return `${component} -> ${file}: ${wanted}`;
}

/** Everything the eight places have not heard of, as one list of sentences. */
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

  // Places 1 and 2 are asked of the component DIRECTORY, which is what the a2ra CLI adds.
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

  // Places 3 to 6 are asked of each EXPORT, so an existing component that gains one is
  // covered as well as a new component that arrives with one.
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

  // Places 7 and 8 are asked of each QUESTION control, which is a registry entry rather
  // than a directory: one component directory can serve a question control and a leaf.
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

/** What a lane is told when a component is not registered everywhere it has to be. */
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
    // The other direction, and the cheaper half to get wrong: an entry left behind by a
    // component that was removed does not fail as a missing entry does. It sits in a list
    // claiming coverage of something that is gone.
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

// --------------------------------------------------------------------------------------
// ADR-31, beyond the presence of a row.
// --------------------------------------------------------------------------------------

/**
 * ADR-31's four moments, in the record's own words, mapped to the enum the portal spells
 * them with.
 *
 * This is the one translation nothing can derive, and it is deliberately keyed by MOMENT
 * rather than by control: ADR-31 has four moments and adding a control adds no row here.
 * The whole table is `docs/adr/portal.md`'s right-hand column; if a phrase there changes,
 * the parse below finds a moment it cannot translate and says so, which is the intended
 * outcome for a record amendment that the code has not caught up with.
 */
const MOMENT_FOR_ADR_PHRASE: ReadonlyMap<string, string> = new Map([
  ["on change", "change"],
  ["on blur", "blur"],
  ["when editing ends and the date is complete", "completion"],
  ["when focus leaves the group", "groupExit"],
]);

/** `singleChoice` and "single choice" and "multi-choice" compared as one spelling. */
function normalizeType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

/** ADR-31's commitment table: question type (normalized) -> the enum moment it names. */
function adrCommitMoments(): ReadonlyMap<string, string> {
  const adr = source("docs/adr/portal.md");
  const table = between(adr, "### ADR-31 - Answer commitment", "### ADR-39");
  const wanted = new Map<string, string>();
  for (const line of table.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    // A table row is `| controls | moment |`, so four cells with two empty edges. The
    // header and the `---` separator are dropped by the phrase lookup below.
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
 * The compiler's question type -> control mapping, from `docs/a2ui-mapping.md`'s table.
 *
 * Bounded to the "Question-type mapping" section rather than run over the whole document,
 * because the honeypot section further down carries a table of the same shape whose first
 * column is a node type and whose second is a props list. Read unbounded, it contributes a
 * `honeypot` question type that compiles to a control called `name`.
 *
 * A type maps to a SET of controls rather than to one, because `singleChoice` has two
 * renderings either side of the seven-option threshold and both have to commit at the
 * moment ADR-31 gives the type. Keeping only the last row would silently stop checking the
 * `RadioGroup` half.
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
 * ADR-31's enumerated conditions, checked at the one moment they can be: the commit
 * moment a control is classified with.
 *
 * The exhaustiveness condition itself - every registry question control has an explicit
 * row - is place 7 of the checklist above rather than a second red here. What is left is
 * everything ADR-31 says about the rows THEMSELVES, and each condition below fails with
 * its own name so a red says which one.
 *
 * Three of ADR-31's conditions are not here and cannot be, because they are behaviour at
 * a moment rather than a property of the classification. Stated rather than approximated:
 *
 *   - "Clearing or partially editing a previously answered date commits a retraction" is
 *     proved by `packages/ui/src/date-retraction.test.tsx` and `apps/portal/e2e/commit-moments.pw.ts`.
 *   - "Same-step visibility updates only after the relevant commit" is a browser-level
 *     ordering claim, proved in `apps/portal/e2e/commit-moments.pw.ts`.
 *   - "A retraction is posted only when the control holds an answer the record shows the
 *     server has" (the 2026-09-02 note) is a property of the post the host makes, proved
 *     by the portal's own answer-flow tests.
 *
 * The date row's trigger is the same kind of thing one level down: `completion` is the
 * classification, and "editing ends AND the value is complete" is what the DatePicker
 * adapter does with it. The word in the map cannot carry that, and this gate does not
 * pretend it does.
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
    // ADR-31 leaves the portal free to meet an unrecognised control, and place 7 of the
    // checklist is what stops that freedom being used as a way past the decision. The
    // fallback is only resilient while it is the LATEST moment: anything earlier would
    // let an unclassified control post mid-entry, which is the churn ADR-31 exists to
    // prevent. Deleting it is the other failure - then an unrecognised control posts at
    // no moment at all, and the answer is silently lost.
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
    let compared = 0;
    for (const [type, moment] of wanted) {
      for (const control of controls.get(type) ?? []) {
        const actual = rows.get(control);
        if (actual === undefined) continue; // place 7 of the checklist reports the absence
        compared += 1;
        if (actual !== moment) {
          disagreements.push(
            `${type} compiles to ${control}, which ADR-31 commits at "${moment}", but ` +
              `apps/portal/lib/visible.ts commits it at "${actual}"`,
          );
        }
      }
    }
    // The claim is over pairs the three sources agree exist, so a parse that stops
    // matching would satisfy it by comparing nothing. Every classified control is one
    // pair at least, which is the floor a silent parse regression cannot clear.
    expect(compared).toBeGreaterThanOrEqual(rows.size);
    expect(
      disagreements.sort((left, right) => left.localeCompare(right)),
      "`COMMIT_MOMENT_BY_CONTROL` in `apps/portal/lib/visible.ts` is keyed by CONTROL and " +
        "ADR-31's table is written by QUESTION TYPE; `docs/a2ui-mapping.md` is what pairs " +
        "them. A disagreement is either a wrong row or an ADR-31 amendment that the code " +
        "has not caught up with",
    ).toEqual([]);
  });

  it("condition: ADR-31's table reaches every question type the compiler can emit", () => {
    // The condition that keeps the one above from going quiet. It compares two documents
    // rather than a document and the code, so it catches the amendment that adds a
    // question type to the mapping and forgets to give it a commit moment - which would
    // otherwise leave the type simply skipped by the loop above.
    const unclassified = [...controlForQuestionType().keys()]
      .filter((type) => !adrCommitMoments().has(type))
      .sort((left, right) => left.localeCompare(right));
    expect(
      unclassified,
      "every question type in `docs/a2ui-mapping.md`'s compilation table needs a row in " +
        "ADR-31's commitment table (`docs/adr/portal.md`), or its control commits at a " +
        "moment the record never decided",
    ).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// The parsers, which fail open and are therefore asserted on directly.
// --------------------------------------------------------------------------------------

describe("the derivations", () => {
  it("finds the same component set in the manifest and in the tree", () => {
    // The anti-vacuity anchor, and deliberately NOT a restated list of components: a list
    // here would be a ninth place to register one, which is the cost this file exists to
    // remove. The manifest is generated from upstream at the pinned commit, so a green
    // here is two independent enumerations agreeing rather than one echoing the other.
    expect(manifestComponents()).toEqual([...vendoredDirectories()]);
    expect(vendoredDirectories().length).toBeGreaterThan(1);
  });

  it("finds a barrel, a registry, a classification and a corpus, none of them empty", () => {
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
    // The `withAuthorMessages` derivation is the one inference in this file that a reader
    // has to take on trust, so it is asserted rather than explained: the registry's
    // question controls are the ones a respondent answers, and its other entries are the
    // form, the layout, the copy, the choice leaves, the honeypot and the submit button.
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
