import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  checkCitation,
  citationsIn,
  collapse,
  describeCitation,
  findPackageRoot,
  parseArgs,
  parseSpans,
  pinnedVersion,
  resolveShorthand,
} from "./vendor-cite.mjs";

/**
 * Tests for the citation reader (issue #864).
 *
 * **Every fixture is assembled from fragments rather than written out**, for the same
 * reason `check-vendor-pin.test.ts` interpolates its versions: this file is scanned by
 * the tool it tests and by `check:vendor-pin` beside it. A literal `dist/...` citation
 * here would be read against the real installed vendor - where these invented paths do
 * not exist - and a literal `better-auth@<version>` would be read as an assertion about
 * the pin. A gate that has to exempt its own test file has a hole exactly that shape.
 *
 * The package tree is **built in the test**, never the real `node_modules`: the point of
 * these cases is the resolution rule (which package owns a path, which version answers),
 * and a test that read the installed tree would go green or red for reasons that have
 * nothing to do with the rule.
 */

/** Assembled, so no literal citation appears in this file. */
const DIST = "dist";
/** Likewise the abbreviation prefix, which would otherwise resolve against nothing. */
const ABBREV = `${"."}..`;
/**
 * And the expectation marker, in halves, for the reason `check-harness-tags.mjs`
 * assembles its needles: a marker written out here would bind to a citation this file
 * only ever interpolates, and the gate beside it would report an expectation that
 * follows nothing. A fixture is data, and data that a scanner reads as a claim is the
 * one thing a self-scanning gate cannot have.
 */
const mark = (phrase: string): string => `${"<!"}-- expect: ${phrase} --${">"}`;
/** Likewise: a literal `name@version` here would read as an assertion about the pin. */
const AT = "@";
const VERSION = "9.9.9";
const OLDER = "9.9.8";

const CORE = "@better-auth/core";
const MAIN = "better-auth";

/** The context module, shipped by `better-auth` and by nothing else. */
const CONTEXT_PATH = `${DIST}/context/create-context.mjs`;
/**
 * The env module, shipped by `@better-auth/core` and by nothing else. This is the pair
 * issue #857 got wrong: prose writes the path without its scope, and reading it under
 * `better-auth` because of that is the defect.
 */
const ENV_PATH = `${DIST}/env/env-impl.mjs`;

const CONTEXT_SOURCE = [
  "const options = {};",
  "const rateLimit = {",
  "  enabled: options.rateLimit?.enabled ?? isProduction,",
  "};",
];
const ENV_SOURCE = [
  'const nodeENV = env.NODE_ENV ?? "";',
  'const isProduction = nodeENV === "production";',
];

const root = mkdtempSync(join(tmpdir(), "qcms-vendor-cite-"));
const nodeModules = join(root, "node_modules");

/** One package in the pnpm store, at an exact version, with a peer-hash suffix. */
function install(name: string, version: string, files: Record<string, string[]>): string {
  const directory = join(
    nodeModules,
    ".pnpm",
    `${name.replace("/", "+")}${AT}${version}_peerhash`,
    "node_modules",
    ...name.split("/"),
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version }));
  for (const [path, lines] of Object.entries(files)) {
    const file = join(directory, ...path.split("/"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, lines.join("\n"));
  }
  return directory;
}

const mainRoot = install(MAIN, VERSION, { [CONTEXT_PATH]: CONTEXT_SOURCE });
const coreRoot = install(CORE, VERSION, { [ENV_PATH]: ENV_SOURCE });
// A second copy of the same package at a different version. Nothing should ever read
// it: an exact-version match is what keeps a citation anchored to the asserted pin.
install(MAIN, OLDER, { [CONTEXT_PATH]: ["a different file entirely"] });

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The two roots, as `main()` resolves them, so a test can read like the tool does. */
function sourceOf(pkg: string | null, path: string): string[] | null {
  const owner = pkg ?? MAIN;
  const directory = owner === CORE ? coreRoot : owner === MAIN ? mainRoot : null;
  if (directory === null) return null;
  try {
    return readFileSync(join(directory, ...path.split("/")), "utf8").split("\n");
  } catch {
    return null;
  }
}

const exists = (pkg: string | null, path: string): boolean => sourceOf(pkg, path) !== null;

describe("finding the installed package", () => {
  it("resolves each package under its own root, at the exact pinned version", () => {
    expect(findPackageRoot(nodeModules, MAIN, VERSION)).toBe(mainRoot);
    expect(findPackageRoot(nodeModules, CORE, VERSION)).toBe(coreRoot);
  });

  it("does not answer with a copy at another version", () => {
    // The store holds better-auth twice. Asking for a version it does not have has to
    // be a miss rather than "the one that sorted first", or a citation would be read
    // against a version nobody asserted.
    expect(findPackageRoot(nodeModules, MAIN, "1.0.0")).toBeNull();
  });

  it("reports a package that is not installed at all", () => {
    expect(findPackageRoot(nodeModules, "@better-auth/utils", VERSION)).toBeNull();
  });

  it("refuses to guess when the lockfile resolves a package twice", () => {
    const two = new Map([[MAIN, new Set([VERSION, OLDER])]]);
    expect(pinnedVersion(two, MAIN)).toEqual({
      error: expect.stringContaining("cannot be read against an ambiguous tree"),
    });
    expect(pinnedVersion(new Map([[MAIN, new Set([VERSION])]]), MAIN)).toEqual({
      version: VERSION,
    });
    expect(pinnedVersion(new Map(), MAIN)).toEqual({
      error: expect.stringContaining("no version"),
    });
  });
});

describe("which package owns a cited path", () => {
  it("reads a scoped citation under its own package, not under better-auth", () => {
    // The whole of issue #857 in one assertion. The env module exists in
    // @better-auth/core and in no other package, and the citation says so.
    const [citation] = citationsIn(`\`${CORE}/${ENV_PATH}:2\``).citations;
    expect(citation?.pkg).toBe(CORE);
    const { failure } = checkCitation(citation!, sourceOf(citation!.pkg, citation!.path), false);
    expect(failure).toBeNull();
  });

  it("reads a bare citation under the default package", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:3\``).citations;
    expect(citation?.pkg).toBeNull();
    expect(checkCitation(citation!, sourceOf(null, citation!.path), false).failure).toBeNull();
  });

  it("fails a path the owning package does not ship", () => {
    // The same path, written bare, so it resolves under better-auth and is not there.
    const [citation] = citationsIn(`\`${ENV_PATH}:2\``).citations;
    expect(checkCitation(citation!, sourceOf(null, citation!.path), false)).toEqual({
      failure: "no such file",
      shown: [],
    });
    // ... and it is found under the package that does ship it, which is the hint the
    // failure message carries so the next reader does not repeat the mistake.
    expect(exists(CORE, citation!.path)).toBe(true);
  });
});

describe("reading the cited lines", () => {
  it("prints the cited line with two lines of context either side", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:3\``).citations;
    const { shown } = checkCitation(citation!, sourceOf(null, citation!.path), false);
    expect(shown).toHaveLength(4);
    expect(shown[2]).toContain("> ");
    expect(shown[2]).toContain("enabled: options.rateLimit?.enabled");
    expect(shown[0]).not.toContain("> ");
  });

  it("fails a line that has shifted past the end of the file", () => {
    // The shape a vendor bump produces when a file shrinks: the path still opens and
    // the line is gone. `check:vendor-pin` cannot see this at all.
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:9\``).citations;
    const { failure } = checkCitation(citation!, sourceOf(null, citation!.path), false);
    expect(failure).toBe("line 9 is past the end of the file (4 lines)");
  });

  it("checks every span of a comma list and every line of a range", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:1,2-9\``).citations;
    expect(citation?.spans).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 9 },
    ]);
    expect(checkCitation(citation!, sourceOf(null, citation!.path), false).failure).toContain(
      "past the end",
    );
  });

  it("checks a citation with no line as a path", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}\``).citations;
    expect(citation?.spans).toEqual([]);
    expect(checkCitation(citation!, sourceOf(null, citation!.path), false)).toEqual({
      failure: null,
      shown: [],
    });
    expect(checkCitation(citation!, null, false).failure).toBe("no such file");
  });
});

describe("--expect", () => {
  const cited = `\`${CONTEXT_PATH}:3\``;

  it("passes when the cited line contains the phrase", () => {
    const [citation] = citationsIn(`${cited} ${mark("?? isProduction")}`).citations;
    expect(citation?.expect).toBe("?? isProduction");
    expect(checkCitation(citation!, sourceOf(null, citation!.path), true).failure).toBeNull();
  });

  it("fails when it does not", () => {
    // A citation that still opens at a line that still exists, saying something else:
    // the failure `check:vendor-pin` is blind to and the reason this mode exists.
    const [citation] = citationsIn(`${cited} ${mark("?? isDevelopment")}`).citations;
    expect(checkCitation(citation!, sourceOf(null, citation!.path), true).failure).toBe(
      'does not contain "?? isDevelopment"',
    );
  });

  it("is inert without the flag, so a stale phrase never fails the plain read", () => {
    const [citation] = citationsIn(`${cited} ${mark("not in this file")}`).citations;
    expect(checkCitation(citation!, sourceOf(null, citation!.path), false).failure).toBeNull();
  });

  it("checks only the cited lines, not the rest of the file", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:1\` ${mark("rateLimit")}`).citations;
    expect(checkCitation(citation!, sourceOf(null, citation!.path), true).failure).toBe(
      'does not contain "rateLimit"',
    );
  });

  it("matches a phrase across a line the vendor's formatter wrapped", () => {
    expect(collapse("  a\n  b  c ")).toBe("a b c");
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:2-3\` ${mark("{ enabled:")}`).citations;
    expect(checkCitation(citation!, sourceOf(null, citation!.path), true).failure).toBeNull();
  });

  it("binds to the citation on its own line or the line above", () => {
    const same = citationsIn(`${cited} ${mark("enabled")}`);
    expect(same.citations[0]?.expect).toBe("enabled");
    const below = citationsIn(`${cited}\n${mark("enabled")}`);
    expect(below.citations[0]?.expect).toBe("enabled");
  });

  it("refuses an empty phrase instead of passing vacuously", () => {
    // `"".includes` is true of every line there is, so an empty marker passed whatever
    // the vendor did AND counted towards coverage - a marker that reads as checked and
    // is not, which is worse than no marker at all.
    const empty = citationsIn(`${cited} ${mark("")}`);
    expect(empty.citations[0]?.expect).toBeNull();
    expect(empty.problems).toEqual([expect.stringContaining("empty or too short")]);
  });

  it("refuses a phrase too short to assert anything, and takes the shortest that is", () => {
    expect(citationsIn(`${cited} ${mark("{")}`).problems).toEqual([
      expect.stringContaining("empty or too short"),
    ]);
    const enough = citationsIn(`${cited} ${mark("??\u0020isProduction")}`);
    expect(enough.problems).toEqual([]);
    expect(enough.citations[0]?.expect).toBe("?? isProduction");
  });

  it("refuses an expectation on a citation that names a path only", () => {
    // There are no cited lines to check it against, and falling back to the whole file
    // is a far weaker assertion wearing the same words.
    const [citation] = citationsIn(`\`${CONTEXT_PATH}\` ${mark("isProduction")}`).citations;
    expect(citation?.spans).toEqual([]);
    expect(checkCitation(citation!, sourceOf(null, citation!.path), true).failure).toBe(
      "an expectation needs a cited line; this citation names a path only",
    );
    // ... and the same citation without the flag is a perfectly good path check.
    expect(checkCitation(citation!, sourceOf(null, citation!.path), false).failure).toBeNull();
  });

  it("reports an expectation that binds to nothing rather than ignoring it", () => {
    // An expectation nothing checks is worse than none, because it reads like one that
    // is checked. Two lines below its citation is out of reach and says so.
    const far = citationsIn(`${cited}\n\n${mark("enabled")}`);
    expect(far.citations[0]?.expect).toBeNull();
    expect(far.problems).toEqual([expect.stringContaining("follows no citation")]);
  });

  it("counts coverage, which is how a half-covered file stays visible", () => {
    const { citations } = citationsIn(`${cited} ${mark("enabled")}\nand \`${CONTEXT_PATH}:1\` too`);
    expect(citations).toHaveLength(2);
    expect(citations.filter((citation) => citation.expect !== null)).toHaveLength(1);
  });
});

describe("the abbreviated and line-only shapes", () => {
  const backupCodes = `${DIST}/plugins/two-factor/backup-codes/index.mjs`;
  const twoFactor = `${DIST}/plugins/two-factor/index.mjs`;

  it("resolves `...` against a path the same file already cited in full", () => {
    const { citations } = citationsIn(
      `\`${backupCodes}:1\` and \`${ABBREV}/backup-codes/index.mjs:2\``,
    );
    expect(citations.map((citation) => citation.path)).toEqual([backupCodes, backupCodes]);
  });

  it("resolves `...` against a sibling's directory when nothing cited it in full", () => {
    // How the abbreviation reads in a document that only ever wrote out the
    // two-factor plugin's own index. The filesystem breaks the tie, so the rule is
    // checked against a tree rather than guessed from the text.
    const owns = (_pkg: string | null, path: string): boolean => path === backupCodes;
    const { citations, problems } = citationsIn(
      `\`${twoFactor}:1\` and \`${ABBREV}/backup-codes/index.mjs:2\``,
      owns,
    );
    expect(problems).toEqual([]);
    expect(citations[1]?.path).toBe(backupCodes);
  });

  it("reports an abbreviation nothing in the file can resolve", () => {
    const { citations, problems } = citationsIn(`\`${ABBREV}/backup-codes/index.mjs:2\``);
    expect(citations).toEqual([]);
    expect(problems).toEqual([expect.stringContaining("abbreviates a path no earlier citation")]);
  });

  it("carries a line-only reference onto the citation before it", () => {
    const { citations } = citationsIn(`\`${CONTEXT_PATH}:1\` and \`:3\``);
    expect(citations.map((citation) => [citation.path, citation.spans])).toEqual([
      [CONTEXT_PATH, [{ from: 1, to: 1 }]],
      [CONTEXT_PATH, [{ from: 3, to: 3 }]],
    ]);
  });

  it("leaves a line-only reference that follows nothing as ordinary prose", () => {
    // `:80` in a document about ports is not a citation. Reading it as one is how a
    // gate earns a false positive and gets switched off.
    expect(citationsIn("the API answers on `:80` in that deployment").citations).toEqual([]);
    expect(citationsIn(`\`${CONTEXT_PATH}:1\`\n\nlater, \`:80\``).citations).toHaveLength(1);
  });

  it("ignores both shorthands outside backticks, where they are ordinary prose", () => {
    // A URL template and a shell path, both real lines in this repository.
    expect(citationsIn(`POST ${ABBREV}/draft/validate`).citations).toEqual([]);
    expect(citationsIn(`node ${ABBREV}/dist/migrate.js`).citations).toEqual([]);
    expect(citationsIn("see :3 of that file").citations).toEqual([]);
  });

  it("resolves the shorthand rules directly, both in order", () => {
    const earlier = citationsIn(`\`${backupCodes}:1\` \`${twoFactor}:1\``).citations;
    // Rule 1 wins on suffix even though the more recent citation is the other file.
    expect(resolveShorthand("backup-codes/index.mjs", earlier, () => false)).toEqual({
      pkg: null,
      path: backupCodes,
    });
    expect(resolveShorthand("nothing/like-it.mjs", earlier, () => false)).toBeNull();
  });
});

describe("naming a citation in output", () => {
  it("prints a scoped citation's owner once, not twice", () => {
    // Echoing the written text produced the scope twice over, once as the owner and
    // once inside the path it was resolved from.
    const [citation] = citationsIn(`\`${CORE}/${ENV_PATH}:32\``).citations;
    expect(describeCitation(citation!, CORE)).toBe(`${CORE} ${ENV_PATH}:32`);
  });

  it("names the resolved path of an abbreviation, and what the file actually wrote", () => {
    const backupCodes = `${DIST}/plugins/two-factor/backup-codes/index.mjs`;
    const { citations } = citationsIn(
      `\`${backupCodes}:1\` and \`${ABBREV}/backup-codes/index.mjs:215\``,
    );
    expect(describeCitation(citations[1]!, MAIN)).toBe(
      `${MAIN} ${backupCodes}:215 (written \`${ABBREV}/backup-codes/index.mjs:215\`)`,
    );
  });

  it("says when a citation names a path and no line", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}\``).citations;
    expect(describeCitation(citation!, MAIN)).toBe(`${MAIN} ${CONTEXT_PATH} (path only)`);
  });

  it("renders a comma list and a range the way they were written", () => {
    const [citation] = citationsIn(`\`${CONTEXT_PATH}:1,3-4\``).citations;
    expect(describeCitation(citation!, MAIN)).toBe(`${MAIN} ${CONTEXT_PATH}:1,3-4`);
  });
});

describe("parsing", () => {
  it("reads a line reference in each shape this repository writes", () => {
    expect(parseSpans("76")).toEqual([{ from: 76, to: 76 }]);
    expect(parseSpans("135-138")).toEqual([{ from: 135, to: 138 }]);
    expect(parseSpans("518,529")).toEqual([
      { from: 518, to: 518 },
      { from: 529, to: 529 },
    ]);
    expect(parseSpans(undefined)).toEqual([]);
  });

  it("records the line of the citing file, which is what a failure has to name", () => {
    const { citations } = citationsIn(`intro\n\n\`${CONTEXT_PATH}:1\``);
    expect(citations[0]?.line).toBe(3);
  });

  it("takes the options the gate and a human each use", () => {
    expect(parseArgs([])).toEqual({ pkg: "better-auth", expect: false, quiet: false });
    expect(parseArgs(["--expect", "--quiet"])).toEqual({
      pkg: "better-auth",
      expect: true,
      quiet: true,
    });
    expect(parseArgs(["--package", CORE]).pkg).toBe(CORE);
    expect(parseArgs([`--package=${CORE}`]).pkg).toBe(CORE);
    expect(() => parseArgs(["--package", "hono"])).toThrow(/must be better-auth/);
    expect(() => parseArgs(["--verbose"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--package"])).toThrow(/requires a value/);
  });
});
