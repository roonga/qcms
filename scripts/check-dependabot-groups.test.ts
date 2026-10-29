/**
 * The `@codemirror/*` packages must move as one set or pnpm resolves two copies of `@codemirror/view`.
 * Dependabot assigns the FIRST matching group and an excluded dependency falls through, so order is semantics.
 * https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#groups--
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const FAMILY_PREFIX = "@codemirror/";

const FAMILY_GROUP = "codemirror";

const CATCH_ALL_GROUP = "minor-and-patch";

const UPDATE_TYPES = ["major", "minor", "patch"] as const;

// No YAML parser is resolvable from this workspace, so this reads only the subset both
// `.github/dependabot.yml` and `pnpm-workspace.yaml` use: block mappings, block
// sequences, flow sequences of scalars and quoted scalars.

type YamlNode = string | YamlNode[] | Map<string, YamlNode>;

interface Line {
  /** Indent of the line's content; a sequence item's content sits two past its dash. */
  indent: number;
  startsItem: boolean;
  /** Indent of the dash itself, meaningful only when `startsItem`. */
  itemIndent: number;
  text: string;
}

/** Quote-aware, so a `#` inside a pattern survives. */
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

/** The key is unquoted, because `"codemirror":` is a legal spelling of the same key. */
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

interface Group {
  name: string;
  patterns: string[];
  excludePatterns: string[];
  /** Undefined means "every update level", which is what the codemirror group wants. */
  updateTypes: string[] | undefined;
  unknownKeys: string[];
}

interface EcosystemEntry {
  directory: string;
  groups: Group[];
  /** `exclude-paths` sits on the entry itself and is not a group criterion. */
  excludePaths: string[];
}

/**
 * An unlisted key is refused rather than ignored: `applies-to` and `dependency-type`
 * would change which updates a group claims, so reading past one would leave the suite
 * green while the config said something else.
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
 * Every entry rather than the first: a second `package-ecosystem: npm` entry carries its
 * own `groups:`, and a catch-all there could claim the family unread.
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
        excludePaths: asList(item?.get("exclude-paths")),
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

/** A group with no `patterns` claims everything at its update levels. */
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

/**
 * The anchoring is what keeps the generated scaffolding manifests out: a template path is
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

const npmGroups: Group[] = npmEntries[0]?.groups ?? [];

/** A mutation applied to a copy, so the repository's own config is never edited. */
function mutated(change: (groups: Group[]) => Group[]): EcosystemEntry[] {
  return [
    {
      directory: npmEntries[0]?.directory ?? "/",
      excludePaths: [...(npmEntries[0]?.excludePaths ?? [])],
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

const TEMPLATE_ROOT = "packages/create-qcms-app/templates/";

/**
 * Asks whether a manifest inside the tree is matched, not whether a literal string is
 * present, because the tree can be written three equivalent ways.
 */
export function templateExclusionProblems(excludePaths: string[]): string[] {
  const probes = ["admin", "api", "portal"].map(
    (app) => `${TEMPLATE_ROOT}common/apps/${app}/package.json`,
  );
  const covered = (path: string): boolean =>
    excludePaths.some((pattern) => matchesPathPattern(pattern, path));
  const missed = probes.filter((probe) => !covered(probe));
  if (missed.length === 0) return [];
  return [
    ".github/dependabot.yml's npm entry does not exclude the scaffolding templates, so " +
      `Dependabot scans ${missed.join(", ")} and opens a second pull request for every bump ` +
      "against generated files. Add the path to `exclude-paths` on that entry; see the " +
      `comment there. Declared: ${excludePaths.length === 0 ? "(none)" : excludePaths.join(", ")}.`,
  ];
}

/**
 * Not the `patterns` wildcard above: a path pattern has segments, so `*` stops at a `/`
 * and `**` does not. Collapsing the two would make `src/*` match `src/a/b`.
 */
function matchesPathPattern(pattern: string, path: string): boolean {
  const escape = (part: string): string => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const source = pattern
    .split("**")
    .map((between) =>
      between
        .split("*")
        .map((part) => escape(part))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

describe("the scaffolding templates stay out of Dependabot's npm scan (issue #1050)", () => {
  it("excludes the generated template manifests", () => {
    expect(npmEntries).toHaveLength(1);
    expect(templateExclusionProblems((npmEntries[0] as EcosystemEntry).excludePaths)).toEqual([]);
  });

  it("reads the exclusion out of the config text rather than from a literal here", () => {
    // Mutates the TEXT, because a defect in how `exclude-paths` becomes the list is
    // invisible to a mutation of the list.
    expect(dependabotText).toContain("exclude-paths:");
    expect((npmEntries[0] as EcosystemEntry).excludePaths).toContain(`${TEMPLATE_ROOT}**`);
  });

  it("fails when the exclusion is dropped", () => {
    expect(templateExclusionProblems([]).join("\n")).toContain("does not exclude the scaffolding");
  });

  it("fails when the exclusion is narrowed to one directory level", () => {
    expect(templateExclusionProblems([`${TEMPLATE_ROOT}*`]).join("\n")).toContain(
      "common/apps/admin/package.json",
    );
  });

  it("accepts an equivalent spelling, because the property is coverage and not a string", () => {
    expect(templateExclusionProblems(["packages/create-qcms-app/**"])).toEqual([]);
  });
});

describe("the codemirror Dependabot group", () => {
  it("holds every @codemirror/* package the workspace declares, at every update level", () => {
    expect(npmEntries).toHaveLength(1);
    expect(npmGroups.map((group) => group.name)).toContain(FAMILY_GROUP);
    expect(codemirrorPackages.length).toBeGreaterThan(0);
    expect(groupProblems(npmEntries, codemirrorPackages)).toStrictEqual([]);
  });

  it("is what apps/admin actually depends on, not a list written down here", () => {
    // Nothing pins the count, so a seventh package joining the family passes here and is
    // caught above only if the pattern misses it.
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
    // The exclusion is checked explicitly rather than left to the first-match simulation,
    // because it is the half that survives a later reorder for readability.
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
    // A TEXT mutation, because this defect lives in how the text becomes the group list
    // rather than in the list itself.
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
    // `applies-to` defaults to version updates, so `security-updates` would take the
    // group off the path this guard is about while leaving its patterns untouched.
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
  // better-auth must arrive alone, because `docs/SECURITY_DESIGN.md` and the auth slice
  // make version-specific claims about its compiled source.
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
    // and group names they explain, so a reader that counted them would report an
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
    expect("apps/admin/package.json").not.toMatch(pattern);
    expect("packages/create-qcms-app/templates/common/apps/admin/package.json").not.toMatch(
      pattern,
    );
  });

  it("selects the real workspace manifests, and only those", () => {
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
