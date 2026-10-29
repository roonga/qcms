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

const APPLICATION_PROCESSES = ["api", "portal", "admin"] as const;

function documented(process: string): string[] {
  return ENV_REFERENCE.filter((entry) => entry.process === process)
    .map((entry) => entry.name)
    .sort();
}

function scanned(process: string): string[] {
  return [...scanEnvNames(process)].sort();
}

describe("env reference matches the code that reads the variables", () => {
  it.each(APPLICATION_PROCESSES)("documents exactly what %s reads", (process) => {
    expect(documented(process)).toEqual(scanned(process));
  });

  it.each(APPLICATION_PROCESSES.filter((name) => name !== "api"))(
    "keeps the framework-set NEXT_RUNTIME out of %s's operator table",
    (process) => {
      const source = readFileSync(
        join(REPOSITORY_ROOT, `apps/${process}/instrumentation.ts`),
        "utf8",
      );

      // The read is real but framework-set, so the scan drops it: if the read ever goes,
      // this fails and the exclusion should go with it.
      expect(scanSourceText(source).names).toContain("NEXT_RUNTIME");

      expect(scanned(process)).not.toContain("NEXT_RUNTIME");
      expect(documented(process)).not.toContain("NEXT_RUNTIME");
    },
  );

  it("agrees with the API parsers about which variables are required", () => {
    // Only the API's requirement is machine readable: portal and admin read
    // `process.env` directly, so their requirement column stays prose.
    const fromParsers = apiRequirementFromParsers();
    const fromTable = new Map(
      ENV_REFERENCE.filter((entry) => entry.process === "api").map((entry) => [
        entry.name,
        entry.requirement,
      ]),
    );
    // Without this floor, a helper regex that stops matching makes every check below
    // vacuously pass and the gate silently stops working.
    expect(fromParsers.size).toBeGreaterThan(10);
    for (const [name, requirement] of fromParsers) {
      expect(fromTable.get(name), `${name} requirement`).toBe(requirement);
    }
  });

  it("keeps a rate-class prefix's two real variables in the table", () => {
    // `parseRateClass(env, "PREFIX", ...)` reads `PREFIX_WINDOW_MS` and `PREFIX_MAX`;
    // the prefix itself is not a variable an operator can set.
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
    const applicationNames = new Set(APPLICATION_PROCESSES.flatMap((p) => scanned(p)));
    const composeOnly = [...scanEnvNames("compose")]
      .filter((name) => !applicationNames.has(name))
      .sort();
    expect(documented("compose")).toEqual(composeOnly);
  });

  it("gives every variable exactly one row per process that reads it", () => {
    const keys = ENV_REFERENCE.map((entry) => `${entry.process}:${entry.name}`);
    expect(keys).toEqual([...new Set(keys)]);
  });
});

describe("the operator-facing sample environment", () => {
  it("documents every variable .env.compose.example sets", () => {
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
    // The fix when this fails is `node scripts/env-reference.mjs --write`.
    expect(currentBlock()).toBe(renderEnvReference());
  });

  it("renders a secret's name without ever rendering a value", () => {
    // SEC-8: secrets are named, never echoed.
    const block = currentBlock();
    for (const entry of ENV_REFERENCE) {
      if (entry.secret !== true) continue;
      expect(block).toContain(`\`${entry.name}\` (secret)`);
    }
  });

  it("is the guide's one generated region, delimited once", () => {
    // Not `expect(doc).toContain(currentBlock())`: `currentBlock()` is a slice of this
    // very document, so that assertion cannot fail.
    const doc = readFileSync(join(REPOSITORY_ROOT, OPERATIONS_DOC), "utf8");
    expect(doc.split(BEGIN_MARKER)).toHaveLength(2);
    expect(doc.split(END_MARKER)).toHaveLength(2);
    expect(doc.indexOf(BEGIN_MARKER)).toBeLessThan(doc.indexOf(END_MARKER));
  });
});

describe("the comment stripper reads its own input correctly (issue #773)", () => {
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
    // The distance between the glob and the JSDoc terminator is the defect: a fixture
    // whose comment sits immediately before the JSDoc proves nothing.
    expect([...scanSourceText(URL_GLOB_IN_LINE_COMMENT).names].sort()).toEqual([
      "QCMS_AFTER_THE_JSDOC",
      "QCMS_GLOB_FOUR",
      "QCMS_GLOB_ONE",
      "QCMS_GLOB_THREE",
      "QCMS_GLOB_TWO",
    ]);
  });

  it("keeps the reads that follow a URL glob written in a string literal", () => {
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
    const source = [
      '// Superseded by QCMS_KEPT: "QCMS_NAMED_IN_LINE_COMMENT" is no longer read.',
      '/* Nor is "QCMS_NAMED_IN_BLOCK_COMMENT". */',
      'const kept = parseBool(env, "QCMS_KEPT", false);',
    ].join("\n");
    expect([...scanSourceText(source).names].sort()).toEqual(["QCMS_KEPT"]);
  });

  it("treats an apostrophe in JSX text as a character, not as a runaway string", () => {
    // An unterminated quote is not an error because `.tsx` is in scope, where a lone
    // apostrophe in element prose is ordinary.
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
    expect(() => stripComments("/* opened and never closed\nconst g = 1;")).toThrow(
      /unterminated block comment/,
    );
  });
});
