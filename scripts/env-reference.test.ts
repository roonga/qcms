import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "./docker.mjs";
import {
  apiRequirementFromParsers,
  BEGIN_MARKER,
  currentBlock,
  END_MARKER,
  ENV_REFERENCE,
  OPERATIONS_DOC,
  rateClassSuffixes,
  renderEnvReference,
  scanEnvNames,
  scanSourceText,
  stripComments,
} from "./env-reference.mjs";

/**
 * The env-reference drift gate (task 036, exit criterion 2: "env reference
 * generated and asserted against the config schema").
 *
 * `scripts/env-reference.mjs` holds a hand-written table of every variable an
 * operator can set, and renders it into `docs/operations.md`. A hand-written table
 * is the right shape (a useful description cannot be extracted from a parser call)
 * and the wrong shape (prose rots silently while the code moves). This file is the
 * seam between the two: **the machine owns the names and the requirement, the human
 * owns the prose.**
 *
 * That split is what makes the gate honest. Asserting the whole table against the
 * code would mean generating the descriptions too, and asserting nothing would let
 * 017's composition root grow a variable that no operator ever hears about. So the
 * two columns that drift silently are the two that are checked, in both directions:
 * a variable added to `apps/api/src/config.ts` fails here until it is documented,
 * and a variable deleted from the code fails here until its row goes.
 *
 * The document check is byte-for-byte rather than "contains the name", because the
 * generator is only trustworthy if running it is a no-op on a clean tree. Anyone
 * who edits the table and forgets `node scripts/env-reference.mjs --write` gets a
 * diff here rather than a stale table in the published docs.
 */

/** The processes whose source is scanned. Compose is checked separately, below. */
const APPLICATION_PROCESSES = ["api", "portal", "admin"] as const;

/** The table's rows for one process, as a sorted name list. */
function documented(process: string): string[] {
  return ENV_REFERENCE.filter((entry) => entry.process === process)
    .map((entry) => entry.name)
    .sort();
}

/** What the source actually reads, as a sorted name list. */
function scanned(process: string): string[] {
  return [...scanEnvNames(process)].sort();
}

describe("env reference matches the code that reads the variables", () => {
  it.each(APPLICATION_PROCESSES)("documents exactly what %s reads", (process) => {
    // Both directions in one assertion, so the failure message names the offending
    // variable rather than reporting two counts that differ by one.
    expect(documented(process)).toEqual(scanned(process));
  });

  it("agrees with the API parsers about which variables are required", () => {
    // The API's composition root is the only process whose requirement is machine
    // readable: every variable arrives through a `parseX(env, "NAME", ...)` helper,
    // and which helper it is decides whether a missing value is fatal. Portal and
    // admin read `process.env` directly, so their requirement column stays prose.
    const fromParsers = apiRequirementFromParsers();
    const fromTable = new Map(
      ENV_REFERENCE.filter((entry) => entry.process === "api").map((entry) => [
        entry.name,
        entry.requirement,
      ]),
    );
    // Not emptiness for its own sake: if the helper regex ever stops matching, every
    // per-variable check below vacuously passes and the gate silently stops working.
    // This guard has already earned its place once, catching a scan that returned
    // nothing while the loop below reported a clean bill of health.
    expect(fromParsers.size).toBeGreaterThan(10);
    for (const [name, requirement] of fromParsers) {
      expect(fromTable.get(name), `${name} requirement`).toBe(requirement);
    }
  });

  it("keeps a rate-class prefix's two real variables in the table", () => {
    // `parseRateClass(env, "PREFIX", ...)` reads `PREFIX_WINDOW_MS` and `PREFIX_MAX`.
    // The prefix itself is not a variable, so a table listing it would document a
    // name no operator can set. The suffixes are read out of the helper's own body,
    // and this asserts that read still returns something usable.
    const suffixes = rateClassSuffixes();
    expect(suffixes).toEqual(["_WINDOW_MS", "_MAX"]);
    const names = new Set(ENV_REFERENCE.map((entry) => entry.name));
    for (const name of names) {
      if (!name.endsWith("_WINDOW_MS")) continue;
      const prefix = name.slice(0, -"_WINDOW_MS".length);
      expect(names.has(`${prefix}_MAX`), `${prefix} documents a window but no max`).toBe(true);
    }
  });
});

describe("group membership", () => {
  it("files a shared variable under the application, never twice", () => {
    // A name both an app and the Compose files read (QCMS_LINK_KEYS is the obvious
    // one) belongs to the app group: that is where its meaning lives. The compose
    // group is therefore the compose scan MINUS the three app scans, and a row
    // appearing in both groups would render the same variable twice in one document.
    const applicationNames = new Set(APPLICATION_PROCESSES.flatMap((p) => scanned(p)));
    const composeOnly = [...scanEnvNames("compose")]
      .filter((name) => !applicationNames.has(name))
      .sort();
    expect(documented("compose")).toEqual(composeOnly);
  });

  it("gives every variable exactly one row per process that reads it", () => {
    // Uniqueness is per (name, process), not per name. Eleven variables are read by
    // more than one process (`QCMS_INTERNAL_TOKEN` by all three, `NODE_ENV` likewise),
    // and each gets its own row because what an operator needs to know differs by
    // process: the API's `QCMS_ADMIN_BASE_URL` is the origin better-auth trusts, the
    // admin's is its own public identity. Collapsing them would lose that.
    const keys = ENV_REFERENCE.map((entry) => `${entry.process}:${entry.name}`);
    expect(keys).toEqual([...new Set(keys)]);
  });
});

describe("the operator-facing sample environment", () => {
  it("documents every variable .env.compose.example sets", () => {
    // The sample file is what an adopter copies. A variable it sets that the
    // reference never mentions is a variable nobody can look up.
    const sample = readFileSync(join(REPOSITORY_ROOT, ".env.compose.example"), "utf8");
    const assigned = [...sample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    expect(assigned.length).toBeGreaterThan(0);
    const documentedNames = new Set(ENV_REFERENCE.map((entry) => entry.name));
    for (const name of assigned) {
      expect(documentedNames.has(name), `${name} is set in the sample but undocumented`).toBe(true);
    }
  });
});

describe("the generated block in the operations guide", () => {
  it("is byte-for-byte what the generator produces", () => {
    // Equivalent to running `node scripts/env-reference.mjs --write` and finding no
    // diff. The fix when this fails is exactly that command.
    expect(currentBlock()).toBe(renderEnvReference());
  });

  it("renders a secret's name without ever rendering a value", () => {
    // SEC-8: secrets are named, never echoed. The table has a `secret` flag and no
    // value column at all, and the sample values live in .env.compose.example.
    const block = currentBlock();
    for (const entry of ENV_REFERENCE) {
      if (entry.secret !== true) continue;
      expect(block).toContain(`\`${entry.name}\` (secret)`);
    }
  });

  it("is the guide's one generated region, delimited once", () => {
    // Deliberately NOT `expect(doc).toContain(currentBlock())`: `currentBlock()` is a
    // slice of this very document, so that assertion cannot fail and reads as coverage
    // it does not provide. What is worth asserting is that there is exactly one region
    // to slice. A second copy of either marker would leave `currentBlock()` describing
    // one region while a reader read the other, and the drift test above would then
    // pass while the visible table rotted.
    const doc = readFileSync(join(REPOSITORY_ROOT, OPERATIONS_DOC), "utf8");
    expect(doc.split(BEGIN_MARKER)).toHaveLength(2);
    expect(doc.split(END_MARKER)).toHaveLength(2);
    expect(doc.indexOf(BEGIN_MARKER)).toBeLessThan(doc.indexOf(END_MARKER));
  });
});

describe("the comment stripper reads its own input correctly (issue #773)", () => {
  /**
   * The exact shape from PR #772, reduced. A URL glob inside an ordinary line
   * comment, then a JSDoc block, then the reads.
   *
   * The two-pass stripper removed block comments FIRST, so the `/*` inside the line
   * comment opened one, the JSDoc's terminator closed it, and every read in between
   * was gone from the scanned set with nothing reported. Four `parseBool` reads
   * disappeared that way and the gate went red naming variables whose reads were
   * still on disk.
   */
  const URL_GLOB_IN_LINE_COMMENT = [
    "// The BFF forwards /api/auth/* to the API, so these four are read here.",
    'const a = parseBool(env, "QCMS_GLOB_ONE", false);',
    'const b = parseBool(env, "QCMS_GLOB_TWO", false);',
    'const c = parseBool(env, "QCMS_GLOB_THREE", false);',
    'const d = parseBool(env, "QCMS_GLOB_FOUR", false);',
    "/** The next thing that happens to be documented. */",
    'const e = parseBool(env, "QCMS_AFTER_THE_JSDOC", false);',
  ].join("\n");

  it("keeps the reads that follow a URL glob written in a line comment", () => {
    // The distance between the glob and the JSDoc terminator is the whole defect:
    // the reads inside it are what vanished. A fixture whose comment is immediately
    // followed by the JSDoc passes under the old stripper too and proves nothing.
    expect([...scanSourceText(URL_GLOB_IN_LINE_COMMENT).names].sort()).toEqual([
      "QCMS_AFTER_THE_JSDOC",
      "QCMS_GLOB_FOUR",
      "QCMS_GLOB_ONE",
      "QCMS_GLOB_THREE",
      "QCMS_GLOB_TWO",
    ]);
  });

  it("keeps the reads that follow a URL glob written in a string literal", () => {
    // The mirror of the case above, and the one that survives simply reordering the
    // two passes: a glob in a string opens a block comment for either ordering.
    const source = [
      'const forwarded = "/api/auth/*";',
      'const f = parseBool(env, "QCMS_STRING_GLOB", false);',
      "/** Whatever is documented next closes the comment that was never opened. */",
      'const g = parseBool(env, "QCMS_STRING_GLOB_TWO", false);',
    ].join("\n");
    expect([...scanSourceText(source).names].sort()).toEqual([
      "QCMS_STRING_GLOB",
      "QCMS_STRING_GLOB_TWO",
    ]);
  });

  it("still ignores a variable that is only NAMED in prose", () => {
    // The property the stripper exists for, kept: a name written in either kind of
    // comment is documentation, not a read, and counting it would put a row in the
    // operator's table for a knob nothing consults.
    const source = [
      '// Superseded by QCMS_KEPT: "QCMS_NAMED_IN_LINE_COMMENT" is no longer read.',
      '/* Nor is "QCMS_NAMED_IN_BLOCK_COMMENT". */',
      'const kept = parseBool(env, "QCMS_KEPT", false);',
    ].join("\n");
    expect([...scanSourceText(source).names].sort()).toEqual(["QCMS_KEPT"]);
  });

  it("treats an apostrophe in JSX text as a character, not as a runaway string", () => {
    // The reason an unterminated quote is not an error: `.tsx` under apps/portal and
    // apps/admin is in scope, and prose in an element is where a lone apostrophe
    // lives. Consuming the rest of the file from it would be the same silent shrink
    // this whole scanner is being fixed for.
    const source = [
      "const view = <p>The session doesn't exist.</p>;",
      'const f = parseBool(env, "QCMS_AFTER_APOSTROPHE", false);',
    ].join("\n");
    expect([...scanSourceText(source).names].sort()).toEqual(["QCMS_AFTER_APOSTROPHE"]);
  });

  it("preserves line numbers so a position in the result points into the original", () => {
    const source = ["const before = 1;", "/* two", "   lines */", "const after = 2;"].join("\n");
    expect(stripComments(source).split("\n")).toHaveLength(4);
  });

  it("refuses an unterminated block comment rather than swallowing the rest", () => {
    // Fail closed. The whole cost of #773 was that the failure was invisible: the
    // corpus shrank, nothing was reported, and the red surfaced hundreds of lines
    // from the cause.
    expect(() => stripComments("/* opened and never closed\nconst g = 1;")).toThrow(
      /unterminated block comment/,
    );
  });
});
