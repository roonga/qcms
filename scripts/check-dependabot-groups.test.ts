import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * The `codemirror` Dependabot group is load-bearing, so deleting or reordering it is a
 * red (issue #889, raised by the #880 reviewer; refs #712, #852).
 *
 * `.github/dependabot.yml` is the ONLY thing keeping the `@codemirror/*` packages moving
 * as one set. The failure it prevents is recorded at length beside the group itself: the
 * packages are exact-pinned but depend on each other through `^6` ranges, so a bump that
 * moves a subset lets pnpm resolve two copies of `@codemirror/view`, whose two
 * structurally identical `KeyBinding` types do not unify, and `next build` fails with a
 * message that names types rather than versions. PR #852 is the near miss.
 *
 * Before this file nothing failed if the group were deleted, renamed, or moved below
 * `minor-and-patch`: the next grouped bump would simply arrive as a subset again, and the
 * only evidence would be a red build in an unrelated pull request. The better-auth half
 * of the same arrangement has `pnpm check:vendor-pin` behind it; this half had nothing.
 *
 * ## The property, and where it comes from
 *
 * Dependabot assigns a dependency to ONE group: "If a dependency matches more than one
 * rule, it's included in the first group that it matches", and "If a dependency matches
 * both a pattern and an exclude-pattern, then it is excluded from the group"
 * (https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#groups--,
 * read 2026-09-18). So declaration ORDER is semantics here, not style, and the four facts
 * the config depends on are one derived property: for every `@codemirror/*` package this
 * workspace declares, at every update level, the first matching group is `codemirror`.
 *
 * The reference's `patterns` row says only "Define one or more patterns to include
 * dependencies with matching names", so two behaviours this file models come from the
 * tutorial that row links to, Example 1 of "Optimizing the creation of pull requests for
 * Dependabot version updates"
 * (https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates,
 * read 2026-09-18). Its three groups are `production-dependencies` and
 * `development-dependencies`, which declare `dependency-type` and NO `patterns`, then
 * `rubocop`, which declares `patterns: ["rubocop*"]`. Of that arrangement the tutorial
 * says: "Due to the ordering, production dependencies matching `rubocop*` will be
 * included in the `production-dependencies` group" - so a group with no `patterns`
 * claims everything its other criteria admit. And: "Development dependencies matching
 * the pattern `rubocop*` are excluded from the `development-dependencies` group.
 * Instead, development dependencies matching `rubocop*` will be included in the
 * `rubocop` group" - so an exclusion falls THROUGH to the next matching group rather
 * than ending the search, which is what `firstMatchingGroup` does below.
 *
 * Those two sentences are why the `@codemirror/*` exclusion on `minor-and-patch` is the
 * other half of the group above it, and why it is asserted separately below.
 *
 * ## What is derived and what is written down
 *
 * The package list is derived from the workspace manifests, and derived from git: the
 * workspace globs in `pnpm-workspace.yaml` become a path pattern, and
 * `trackedFilesUnder` answers which manifests match it. Never a directory walk, per
 * CONTRIBUTING's rule for a test that asserts a property of every X in the codebase
 * (issues #635, #641) - a walk reads a checkout's build output as source and asserts a
 * property of the machine. So a seventh `@codemirror/*` package added to any workspace
 * member without joining the pattern is a red here. Only the `@codemirror/` prefix is
 * written down, because it is the subject of the guard rather than an input to it.
 *
 * `pnpm-workspace.yaml` stays in the reader's hands deliberately: it is the authority on
 * which manifests Dependabot's npm updater can edit, and hard-coding `packages|apps` here
 * would lose `tooling/*` the moment a package there took a dependency. It adds no shape
 * the reader does not already need for `.github/dependabot.yml`.
 *
 * The scaffolding templates under `packages/create-qcms-app/templates/` declare the same
 * six and are deliberately NOT scanned: they are generated from `apps/admin`, they are
 * not workspace members, and Dependabot's npm updater only edits workspace members
 * (issue #834, `scripts/dependabot-changeset.mjs`). A group cannot cover what the updater
 * cannot see.
 *
 * ## Why here
 *
 * The `tooling` Vitest project runs from the repo root and outside turbo, so it always
 * reads the tree as it is - the same reason `scripts/check-origin-guards.test.ts` and
 * `scripts/check-bff-config-guards.test.ts` live here. The assertions are pure functions
 * over a parsed config, so each one is proved non-vacuous below by mutating an in-memory
 * copy and watching it fail. Two cases mutate the config TEXT instead, because a defect
 * in how the text becomes that model is invisible to a mutation of the model.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The subject of the guard: the package family that must move as one set. */
const FAMILY_PREFIX = "@codemirror/";

/** The group that must claim that family. */
const FAMILY_GROUP = "codemirror";

/** The catch-all group it must sit above. */
const CATCH_ALL_GROUP = "minor-and-patch";

/** The update levels a version update can arrive at; the group must win at all three. */
const UPDATE_TYPES = ["major", "minor", "patch"] as const;

// ---------------------------------------------------------------------------
// The smallest YAML reader this needs.
//
// No YAML parser is resolvable from this repository - none is declared anywhere in the
// workspace - and the established answer here is to read the shape rather than add a
// dependency for a two-property read (`scripts/check-docker-job-guards.mjs` says so in
// as many words, and `scripts/check-ci-parity.mjs` does the same). This reader covers
// the subset both `.github/dependabot.yml` and `pnpm-workspace.yaml` use: block
// mappings, block sequences, flow sequences of scalars, and quoted scalars. It is
// exercised by its own cases below, so a file that outgrows it fails loudly rather than
// parsing to something plausible and wrong.
// ---------------------------------------------------------------------------

type YamlNode = string | YamlNode[] | Map<string, YamlNode>;

interface Line {
  /** Indent of the line's content; a sequence item's content sits two past its dash. */
  indent: number;
  /** True when the line opened a sequence item. */
  startsItem: boolean;
  /** Indent of the dash itself, meaningful only when `startsItem`. */
  itemIndent: number;
  text: string;
}

/**
 * Drop a comment, respecting quotes so a `#` inside a pattern survives.
 */
function stripComment(raw: string): string {
  let quote: string | undefined;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || raw[i - 1] === " ")) return raw.slice(0, i);
  }
  return raw;
}

function lex(source: string): Line[] {
  const lines: Line[] = [];
  for (const raw of source.split("\n")) {
    const stripped = stripComment(raw);
    if (stripped.trim() === "") continue;
    const indent = stripped.length - stripped.trimStart().length;
    const body = stripped.trimStart();
    if (body === "-" || body.startsWith("- ")) {
      lines.push({
        indent: indent + 2,
        startsItem: true,
        itemIndent: indent,
        text: body.slice(1).trim(),
      });
    } else {
      lines.push({ indent, startsItem: false, itemIndent: indent, text: body });
    }
  }
  return lines;
}

/**
 * `key: value` split, or undefined when the line is a plain scalar.
 *
 * The key is unquoted: `"codemirror":` is a legal spelling of the same key, and a
 * maintainer who tidied the file that way should not get a red naming a group that is
 * still there.
 */
function splitEntry(text: string): { key: string; value: string } | undefined {
  const match = /^([^\s:][^:]*):(?:\s+(.*))?$/.exec(text);
  if (match?.[1] === undefined) return undefined;
  return { key: unquote(match[1]), value: match[2] ?? "" };
}

function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') || trimmed.startsWith("'"))) {
    const quote = trimmed[0] as string;
    if (trimmed.endsWith(quote)) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function scalar(text: string): YamlNode {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((part) => unquote(part));
  }
  return unquote(trimmed);
}

/** The indent a key's nested block is parsed at, which differs for a sequence. */
function childIndent(line: Line | undefined, fallback: number): number {
  if (line === undefined) return fallback;
  return line.startsItem ? line.itemIndent : line.indent;
}

function parseValue(lines: Line[], indent: number): YamlNode {
  const first = lines[0];
  if (first === undefined) return "";
  if (first.startsItem && first.itemIndent === indent) return parseSequence(lines, indent);
  return parseMapping(lines);
}

function parseSequence(lines: Line[], indent: number): YamlNode[] {
  const items: YamlNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    i += 1;
    while (
      i < lines.length &&
      !(lines[i]?.startsItem === true && lines[i]?.itemIndent === indent)
    ) {
      i += 1;
    }
    const run = lines.slice(start, i);
    const head = run[0] as Line;
    if (run.length === 1 && splitEntry(head.text) === undefined) {
      items.push(scalar(head.text));
      continue;
    }
    const body =
      head.text === "" ? run.slice(1) : [{ ...head, startsItem: false }, ...run.slice(1)];
    items.push(parseValue(body, childIndent(body[0], indent + 2)));
  }
  return items;
}

function parseMapping(lines: Line[]): Map<string, YamlNode> {
  const map = new Map<string, YamlNode>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as Line;
    const entry = splitEntry(line.text);
    if (entry === undefined) {
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    while (i < lines.length && (lines[i] as Line).indent > line.indent) i += 1;
    const nested = lines.slice(start + 1, i);
    map.set(
      entry.key,
      entry.value === ""
        ? parseValue(nested, childIndent(nested[0], line.indent + 2))
        : scalar(entry.value),
    );
  }
  return map;
}

export function parseYaml(source: string): YamlNode {
  const lines = lex(source);
  return parseValue(lines, childIndent(lines[0], 0));
}

// ---------------------------------------------------------------------------
// The config, as the four facts see it.
// ---------------------------------------------------------------------------

interface Group {
  name: string;
  patterns: string[];
  excludePatterns: string[];
  /** Undefined means "every update level", which is what the codemirror group wants. */
  updateTypes: string[] | undefined;
  /** Keys this model does not read; see `KNOWN_GROUP_KEYS`. */
  unknownKeys: string[];
}

/** One `updates:` entry: everything about it this guard claims to understand. */
interface EcosystemEntry {
  directory: string;
  groups: Group[];
}

/**
 * The group criteria this model reads. Anything else is refused rather than ignored,
 * because the keys it would ignore change the answer: `applies-to` defaults to version
 * updates and can be set to `security-updates`, which would take the group out of the
 * path this guard is about, and `dependency-type` narrows a group the same way
 * `update-types` does (both are group criteria in Example 1 of the tutorial cited above).
 * Silently reading past either would leave the suite green while the config said
 * something else.
 */
const KNOWN_GROUP_KEYS = new Set(["patterns", "exclude-patterns", "update-types"]);

function asList(node: YamlNode | undefined): string[] {
  if (node === undefined) return [];
  if (typeof node === "string") return node === "" ? [] : [node];
  if (Array.isArray(node)) return node.filter((item): item is string => typeof item === "string");
  return [];
}

function asMap(node: YamlNode | undefined): Map<string, YamlNode> | undefined {
  return node instanceof Map ? node : undefined;
}

/**
 * EVERY `updates:` entry for one ecosystem, in declaration order, each with its groups in
 * declaration order.
 *
 * All of them rather than the first, because taking the first is the one way this guard
 * can be green while the config says otherwise: a second `package-ecosystem: npm` entry
 * carries its own `groups:`, and a catch-all there would claim the family for whatever
 * directory that entry covers. `groupProblems` refuses more than one instead of modelling
 * the pair; see the reason there.
 *
 * @param config parsed `.github/dependabot.yml`
 * @param ecosystem e.g. "npm"
 */
export function ecosystemEntries(config: YamlNode, ecosystem: string): EcosystemEntry[] {
  const updates = asMap(config)?.get("updates");
  if (!Array.isArray(updates)) return [];
  return updates
    .map((item) => asMap(item))
    .filter((item) => item?.get("package-ecosystem") === ecosystem)
    .map((item) => {
      const directory = item?.get("directory");
      const groups = asMap(item?.get("groups"));
      return {
        directory: typeof directory === "string" ? directory : "(unset)",
        groups:
          groups === undefined
            ? []
            : [...groups].map(([name, body]) => {
                const fields = asMap(body);
                const updateTypes = fields?.get("update-types");
                return {
                  name,
                  patterns: asList(fields?.get("patterns")),
                  excludePatterns: asList(fields?.get("exclude-patterns")),
                  updateTypes: updateTypes === undefined ? undefined : asList(updateTypes),
                  unknownKeys: [...(fields?.keys() ?? [])].filter(
                    (key) => !KNOWN_GROUP_KEYS.has(key),
                  ),
                };
              }),
      };
    });
}

/** Dependabot patterns support `*` as a wildcard; nothing else is special. */
function matchesPattern(pattern: string, name: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join(".*");
  return new RegExp(`^${source}$`).test(name);
}

/**
 * The group Dependabot would put `name` in for an update of `updateType`, or undefined
 * when no group claims it and it arrives on its own.
 *
 * A group with no `patterns` claims everything at its update levels; see the file
 * comment for where that comes from.
 */
export function firstMatchingGroup(
  groups: Group[],
  name: string,
  updateType: string,
): string | undefined {
  for (const group of groups) {
    if (group.updateTypes !== undefined && !group.updateTypes.includes(updateType)) continue;
    const included =
      group.patterns.length === 0 || group.patterns.some((p) => matchesPattern(p, name));
    if (!included) continue;
    if (group.excludePatterns.some((p) => matchesPattern(p, name))) continue;
    return group.name;
  }
  return undefined;
}

/**
 * Every way the arrangement can be wrong, in one list so a mutation can be shown to
 * break exactly the assertion it should.
 *
 * @param groups the npm ecosystem's groups, in declaration order
 * @param packages the `@codemirror/*` packages this workspace declares
 */
export function groupProblems(entries: EcosystemEntry[], packages: string[]): string[] {
  const problems: string[] = [];

  // A derivation that found nothing would make every assertion below vacuously true.
  if (packages.length === 0) {
    problems.push(
      `no ${FAMILY_PREFIX}* package is declared by any workspace manifest, so this guard ` +
        "would assert nothing. If the family is genuinely gone, delete the group and this file.",
    );
    return problems;
  }

  // Exactly one npm entry, and it is refused rather than modelled when there are two.
  // A second entry carries its own `groups:` for its own directories, so the arrangement
  // below would describe part of the config while the rest went unread - the guard would
  // assert less than the file says. Modelling both would mean resolving each entry's
  // directories against the manifests, which is machinery for an arrangement this
  // repository does not have: one npm entry at `/`, covering the whole pnpm workspace.
  if (entries.length === 0) {
    problems.push(
      ".github/dependabot.yml declares no `package-ecosystem: npm` entry, so nothing " +
        "below has a subject and this guard would assert nothing.",
    );
    return problems;
  }
  if (entries.length > 1) {
    problems.push(
      `.github/dependabot.yml declares ${entries.length} \`package-ecosystem: npm\` entries ` +
        `(directories: ${entries.map((entry) => entry.directory).join(", ")}). This guard ` +
        "models one, so it would assert less than the file says: a second entry carries " +
        "its own groups, and a catch-all there can claim the family. Fold them into one " +
        "entry, or teach this guard which entry covers apps/admin.",
    );
    return problems;
  }

  const groups = (entries[0] as EcosystemEntry).groups;

  // A group criterion this model does not read changes the answer rather than decorating
  // it, so it is a refusal (see `KNOWN_GROUP_KEYS`).
  for (const group of groups) {
    for (const key of group.unknownKeys) {
      problems.push(
        `the "${group.name}" group declares \`${key}\`, which this guard does not model. ` +
          "A group criterion it cannot read can change which dependencies the group " +
          "claims, so teach it the key or drop the key.",
      );
    }
  }

  const familyIndex = groups.findIndex((group) => group.name === FAMILY_GROUP);
  const catchAllIndex = groups.findIndex((group) => group.name === CATCH_ALL_GROUP);
  const family = groups[familyIndex];

  if (family === undefined) {
    problems.push(
      `.github/dependabot.yml declares no npm group named "${FAMILY_GROUP}", so the ` +
        `${packages.length} ${FAMILY_PREFIX}* packages can split across bumps (issue #712).`,
    );
  } else {
    for (const name of packages) {
      if (!family.patterns.some((pattern) => matchesPattern(pattern, name))) {
        problems.push(
          `${name} is declared by a workspace manifest and matches no pattern of the ` +
            `"${FAMILY_GROUP}" group, so it would be bumped apart from the rest of the set.`,
        );
      }
    }
  }

  if (familyIndex !== -1 && catchAllIndex !== -1 && familyIndex > catchAllIndex) {
    problems.push(
      `"${FAMILY_GROUP}" is declared after "${CATCH_ALL_GROUP}". Dependabot uses the FIRST ` +
        "matching group, so that order hands the set to the catch-all at minor and patch.",
    );
  }

  const catchAll = groups[catchAllIndex];
  if (catchAll !== undefined) {
    for (const name of packages) {
      if (!catchAll.excludePatterns.some((pattern) => matchesPattern(pattern, name))) {
        problems.push(
          `"${CATCH_ALL_GROUP}" does not exclude ${name}. It declares no patterns, so it ` +
            "claims everything at its update levels and the exclusion is the other half of " +
            `the "${FAMILY_GROUP}" group.`,
        );
      }
    }
  }

  for (const name of packages) {
    for (const updateType of UPDATE_TYPES) {
      const claimed = firstMatchingGroup(groups, name, updateType);
      if (claimed !== FAMILY_GROUP) {
        problems.push(
          `a ${updateType} update of ${name} would be grouped as ` +
            `${claimed ?? "(no group: its own pull request)"} rather than "${FAMILY_GROUP}".`,
        );
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Reading the repository.
// ---------------------------------------------------------------------------

/**
 * The path pattern that selects a workspace member's manifest, built from
 * `pnpm-workspace.yaml`'s own globs plus the root manifest.
 *
 * A pattern rather than a listing, because the listing comes from git: this is what gets
 * handed to `trackedFilesUnder`, which is how CONTRIBUTING requires a derived set to be
 * enumerated (issues #635, #641). The anchoring is what keeps the generated scaffolding
 * manifests out: `packages/create-qcms-app/templates/common/apps/admin/package.json` is
 * four segments deeper than `packages/<member>/package.json` and does not match.
 */
export function workspaceManifestPattern(workspaceYaml: string): RegExp {
  const globs = asList(asMap(parseYaml(workspaceYaml))?.get("packages"));
  const alternatives = [String.raw`package\.json`];
  for (const glob of globs) {
    const escaped = glob
      .split("*")
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join("[^/]+");
    alternatives.push(String.raw`${escaped}/package\.json`);
  }
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

/** Every dependency name a manifest declares, in any of the four dependency fields. */
export function declaredDependencies(manifestText: string): string[] {
  const manifest: Record<string, unknown> = JSON.parse(manifestText);
  const names = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = manifest[field];
    if (typeof block !== "object" || block === null) continue;
    for (const name of Object.keys(block)) names.add(name);
  }
  return [...names];
}

/** The declared packages of one family, across every manifest, sorted and de-duplicated. */
export function familyPackages(manifestTexts: string[], prefix: string): string[] {
  const names = new Set<string>();
  for (const text of manifestTexts) {
    for (const name of declaredDependencies(text)) {
      if (name.startsWith(prefix)) names.add(name);
    }
  }
  return [...names].sort();
}

function readRepoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

const dependabotText = readRepoFile(".github/dependabot.yml");
const npmEntries = ecosystemEntries(parseYaml(dependabotText), "npm");
const manifestPaths = trackedFilesUnder(REPO_ROOT, {
  match: workspaceManifestPattern(readRepoFile("pnpm-workspace.yaml")),
});
const manifestTexts = manifestPaths.map((path) => readRepoFile(path));
const codemirrorPackages = familyPackages(manifestTexts, FAMILY_PREFIX);

/** The one npm entry, which every assertion below is about. */
const npmGroups: Group[] = npmEntries[0]?.groups ?? [];

/** A mutation applied to a copy, so the repository's own config is never edited. */
function mutated(change: (groups: Group[]) => Group[]): EcosystemEntry[] {
  return [
    {
      directory: npmEntries[0]?.directory ?? "/",
      groups: change(
        npmGroups.map((group) => ({
          ...group,
          patterns: [...group.patterns],
          excludePatterns: [...group.excludePatterns],
          updateTypes: group.updateTypes === undefined ? undefined : [...group.updateTypes],
          unknownKeys: [...group.unknownKeys],
        })),
      ),
    },
  ];
}

describe("the codemirror Dependabot group", () => {
  it("holds every @codemirror/* package the workspace declares, at every update level", () => {
    // The whole guard, over the real config and the real manifests. Its own inputs are
    // asserted too: a config that parsed to nothing, or a manifest scan that found
    // nothing, would satisfy the property by having no subject.
    expect(npmEntries).toHaveLength(1);
    expect(npmGroups.map((group) => group.name)).toContain(FAMILY_GROUP);
    expect(codemirrorPackages.length).toBeGreaterThan(0);
    expect(groupProblems(npmEntries, codemirrorPackages)).toStrictEqual([]);
  });

  it("is what apps/admin actually depends on, not a list written down here", () => {
    // The derivation reaches the manifest that matters. Nothing pins the count: a
    // seventh package joining the family should pass here and be caught above only if
    // the pattern misses it.
    const admin = declaredDependencies(readRepoFile("apps/admin/package.json"));
    expect(admin.filter((name) => name.startsWith(FAMILY_PREFIX)).sort()).toStrictEqual(
      codemirrorPackages,
    );
  });

  it("fails when the group is deleted", () => {
    const problems = groupProblems(
      mutated((groups) => groups.filter((group) => group.name !== FAMILY_GROUP)),
      codemirrorPackages,
    );
    expect(problems.join("\n")).toContain(`declares no npm group named "${FAMILY_GROUP}"`);
    expect(problems.join("\n")).toContain(`rather than "${FAMILY_GROUP}"`);
  });

  it("fails when the group is reordered below the catch-all", () => {
    // The silent one. Every group still exists and every pattern still matches; only the
    // order moved, and at minor and patch the catch-all would claim the set first.
    const problems = groupProblems(
      mutated((groups) => [
        ...groups.filter((group) => group.name !== FAMILY_GROUP),
        ...groups.filter((group) => group.name === FAMILY_GROUP),
      ]),
      codemirrorPackages,
    );
    expect(problems.join("\n")).toContain(`"${FAMILY_GROUP}" is declared after`);
  });

  it("fails when the catch-all stops excluding the family", () => {
    // Order alone would still hold the set together here, so the first-match simulation
    // stays quiet and this is the assertion that has to fire on its own. That is why the
    // exclusion is checked explicitly rather than left to the simulation: it is the half
    // that survives if someone later reorders the groups for readability.
    const problems = groupProblems(
      mutated((groups) =>
        groups.map((group) =>
          group.name === CATCH_ALL_GROUP
            ? {
                ...group,
                excludePatterns: group.excludePatterns.filter(
                  (pattern) => !pattern.startsWith(FAMILY_PREFIX),
                ),
              }
            : group,
        ),
      ),
      codemirrorPackages,
    );
    expect(problems.join("\n")).toContain(`does not exclude ${codemirrorPackages[0] as string}`);
  });

  it("fails when a package of the family is not covered by the pattern", () => {
    // A seventh @codemirror/* package added to the admin without joining the pattern is
    // the same shape: here the pattern is narrowed instead, because the packages are
    // read from the real manifests.
    const problems = groupProblems(
      mutated((groups) =>
        groups.map((group) =>
          group.name === FAMILY_GROUP
            ? { ...group, patterns: [codemirrorPackages[0] as string] }
            : group,
        ),
      ),
      codemirrorPackages,
    );
    for (const name of codemirrorPackages.slice(1)) {
      expect(problems.join("\n")).toContain(`${name} is declared by a workspace manifest`);
    }
  });

  it("fails when the config declares a second npm entry", () => {
    // A TEXT mutation, not a mutation of the parsed group list, and deliberately so: this
    // is the one defect the in-memory cases above cannot see, because it lives in how the
    // text becomes that list rather than in the list. A second `package-ecosystem: npm`
    // entry carries its own groups for its own directories, and a catch-all there can
    // claim the family while every group above stays exactly as it is.
    const withSecondEntry = `${dependabotText}
  - package-ecosystem: npm
    directory: /apps/admin
    schedule:
      interval: weekly
    groups:
      everything:
        patterns: ["*"]
`;
    const entries = ecosystemEntries(parseYaml(withSecondEntry), "npm");
    expect(entries).toHaveLength(2);
    expect(groupProblems(entries, codemirrorPackages).join("\n")).toContain(
      "declares 2 `package-ecosystem: npm` entries",
    );
  });

  it("fails when a group declares a criterion this guard does not model", () => {
    // The other text mutation, and the same shape as the one above: `applies-to` defaults
    // to version updates, so setting it to `security-updates` would take the group off the
    // path this guard is about while leaving its patterns untouched. `dependency-type` is
    // the same kind of key. Refused rather than read past.
    const withAppliesTo = dependabotText.replace(
      "      codemirror:\n        patterns:",
      "      codemirror:\n        applies-to: security-updates\n        patterns:",
    );
    expect(withAppliesTo).not.toBe(dependabotText);
    const problems = groupProblems(
      ecosystemEntries(parseYaml(withAppliesTo), "npm"),
      codemirrorPackages,
    );
    expect(problems.join("\n")).toContain("declares `applies-to`, which this guard does not model");
  });

  it("fails when the config declares no npm entry at all", () => {
    expect(groupProblems([], codemirrorPackages).join("\n")).toContain(
      "declares no `package-ecosystem: npm` entry",
    );
  });

  it("fails when the family stops being declared at all", () => {
    expect(groupProblems(npmEntries, []).join("\n")).toContain("would assert nothing");
  });
});

describe("better-auth stays out of every group", () => {
  // Free to assert with the same machinery, and the same shape of defect (issue #606):
  // better-auth must arrive ALONE because `docs/SECURITY_DESIGN.md`, the developer guide
  // and the auth slice make version-specific claims about its compiled source.
  // `pnpm check:vendor-pin` catches the prose drift afterwards; nothing until now caught
  // the exclusion being dropped, which is what lets the bump hide in an 18-package table
  // in the first place (PR #716, issue #483).
  const betterAuth = familyPackages(manifestTexts, "better-auth").concat(
    familyPackages(manifestTexts, "@better-auth/"),
  );

  it("is declared somewhere, so the assertion below has a subject", () => {
    expect(betterAuth.length).toBeGreaterThan(0);
  });

  it("matches no group at any update level", () => {
    for (const name of betterAuth) {
      for (const updateType of UPDATE_TYPES) {
        expect(firstMatchingGroup(npmGroups, name, updateType)).toBeUndefined();
      }
    }
  });

  it("would be caught if the exclusion were dropped", () => {
    const withoutExclusion = mutated((groups) =>
      groups.map((group) =>
        group.name === CATCH_ALL_GROUP
          ? {
              ...group,
              excludePatterns: group.excludePatterns.filter(
                (pattern) => !pattern.includes("better-auth"),
              ),
            }
          : group,
      ),
    );
    const groups = (withoutExclusion[0] as EcosystemEntry).groups;
    expect(firstMatchingGroup(groups, betterAuth[0] as string, "minor")).toBe(CATCH_ALL_GROUP);
  });
});

describe("the YAML subset reader", () => {
  // The reader is the one thing here that could be wrong quietly: a config it mis-parses
  // could satisfy every assertion above while the real file says something else. These
  // pin the shapes `.github/dependabot.yml` and `pnpm-workspace.yaml` actually use.

  it("reads a sequence of mappings, nested sequences, and flow sequences", () => {
    const config = parseYaml(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: npm",
        "    directory: /",
        "    groups:",
        "      first:",
        "        patterns:",
        '          - "@scope/*"',
        "      second:",
        '        update-types: ["minor", "patch"]',
        "        exclude-patterns:",
        '          - "@scope/*"',
        "",
      ].join("\n"),
    );
    const groups = ecosystemEntries(config, "npm")[0]?.groups;
    expect(groups).toStrictEqual([
      {
        name: "first",
        patterns: ["@scope/*"],
        excludePatterns: [],
        updateTypes: undefined,
        unknownKeys: [],
      },
      {
        name: "second",
        patterns: [],
        excludePatterns: ["@scope/*"],
        updateTypes: ["minor", "patch"],
        unknownKeys: [],
      },
    ]);
  });

  it("keeps group order, which is the semantics rather than the formatting", () => {
    expect(npmGroups.indexOf(npmGroups.find((g) => g.name === FAMILY_GROUP) as Group)).toBeLessThan(
      npmGroups.indexOf(npmGroups.find((g) => g.name === CATCH_ALL_GROUP) as Group),
    );
  });

  it("ignores comments, including one that names a group or a pattern in prose", () => {
    // `.github/dependabot.yml` is mostly comment, and those comments quote the patterns
    // and group names they explain. A reader that counted them would report an
    // arrangement the file does not have.
    const config = parseYaml(
      [
        "# groups:",
        "#   codemirror:",
        '#     patterns: ["@codemirror/*"]',
        "updates:",
        "  # a real one",
        "  - package-ecosystem: npm",
        "    groups:",
        "      only:",
        '        patterns: ["left*"]',
        "",
      ].join("\n"),
    );
    expect(ecosystemEntries(config, "npm")[0]?.groups.map((group) => group.name)).toStrictEqual([
      "only",
    ]);
  });

  it("reads a quoted mapping key as the same key", () => {
    // `"codemirror":` is a legal spelling. A reader that kept the quotes would red on a
    // reformat that changed nothing, and send a maintainer looking for a group that is
    // still there.
    const config = parseYaml(
      [
        "updates:",
        '  - package-ecosystem: "npm"',
        "    groups:",
        '      "codemirror":',
        '        patterns: ["@codemirror/*"]',
        "",
      ].join("\n"),
    );
    expect(ecosystemEntries(config, "npm")[0]?.groups.map((group) => group.name)).toStrictEqual([
      FAMILY_GROUP,
    ]);
  });

  it("turns the workspace globs into the manifest pattern git is asked for", () => {
    const pattern = workspaceManifestPattern(
      ['packages:\n  - "packages/*"\n  - "tooling/*"\n', "overrides:\n  postcss: ^8.5.23\n"].join(
        "",
      ),
    );
    expect("package.json").toMatch(pattern);
    expect("packages/core/package.json").toMatch(pattern);
    expect("tooling/eslint-config/package.json").toMatch(pattern);
    // Not a workspace member: an app the globs do not name, and the generated scaffolding
    // manifest that declares the same six @codemirror/* packages.
    expect("apps/admin/package.json").not.toMatch(pattern);
    expect("packages/create-qcms-app/templates/common/apps/admin/package.json").not.toMatch(
      pattern,
    );
  });

  it("selects the real workspace manifests, and only those", () => {
    // The live derivation, asked of git rather than of the working directory
    // (CONTRIBUTING, issues #635, #641). Nothing pins the count; what is pinned is that
    // it reaches the manifest the family lives in and stops at the workspace boundary.
    expect(manifestPaths).toContain("apps/admin/package.json");
    expect(manifestPaths).toContain("package.json");
    expect(manifestPaths).not.toContain(
      "packages/create-qcms-app/templates/common/apps/admin/package.json",
    );
  });

  it("matches a wildcard pattern the way Dependabot documents it", () => {
    expect(
      firstMatchingGroup(
        [
          {
            name: "g",
            patterns: ["@scope/*"],
            excludePatterns: [],
            updateTypes: undefined,
            unknownKeys: [],
          },
        ],
        "@scope/thing",
        "minor",
      ),
    ).toBe("g");
    expect(
      firstMatchingGroup(
        [
          {
            name: "g",
            patterns: ["@scope/*"],
            excludePatterns: [],
            updateTypes: undefined,
            unknownKeys: [],
          },
        ],
        "@scope-other/thing",
        "minor",
      ),
    ).toBeUndefined();
  });
});
