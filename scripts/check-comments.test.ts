import { describe, expect, it } from "vitest";

import {
  ALLOWED_LINE,
  EXCLUDED_PATHS,
  filesInScope,
  HISTORY_MARKERS,
  isInScope,
  MAX_COMMENT_LINES,
  MAX_EXPORT_JSDOC_LINES,
  scanText,
} from "./check-comments.mjs";

type Hit = { line: number; rule: string; detail: string };

const scan = (source: string, path = "packages/x/src/a.ts"): Hit[] =>
  scanText(path, source) as Hit[];
const rules = (source: string, path?: string): string[] => scan(source, path).map((h) => h.rule);

const lines = (count: number, prefix = " * "): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}line ${String(i + 1)}`);
const block = (count: number): string => ["/*", ...lines(count), " */", "const a = 1;"].join("\n");
const jsdoc = (count: number, declaration: string, extra: string[] = []): string =>
  ["/**", ...lines(count), ...extra, " */", declaration].join("\n");

describe("comment length", () => {
  it("allows a block at the limit and fires one line over", () => {
    expect(rules(block(MAX_COMMENT_LINES))).toEqual([]);
    expect(scan(block(MAX_COMMENT_LINES + 1))).toEqual([
      expect.objectContaining({ line: 1, rule: "length" }),
    ]);
  });

  it("reads adjacent own-line line comments as one block", () => {
    expect(rules(lines(4, "// ").join("\n"))).toEqual(["length"]);
    expect(rules([...lines(3, "// "), "", ...lines(3, "// ")].join("\n"))).toEqual([]);
  });

  it("does not merge a trailing comment into the block below it", () => {
    expect(rules(["const a = 1; // tail", ...lines(3, "// ")].join("\n"))).toEqual([]);
  });

  it("does not count blank lines inside a block", () => {
    expect(rules(["/*", " * one", " *", " * two", " *", " * three", " */"].join("\n"))).toEqual([]);
  });

  it("holds non-exported JSDoc to the plain comment limit", () => {
    expect(rules(jsdoc(MAX_COMMENT_LINES + 1, "function f() {}"))).toEqual(["length"]);
  });

  it("never counts type tags, which carry the types of a checked JavaScript file", () => {
    const types = [" * @param {string} a", " * @returns {number}"];
    expect(rules(jsdoc(MAX_COMMENT_LINES, "function f(a) {}", types), "scripts/a.mjs")).toEqual([]);
  });

  it("gives exported JSDoc its own limit", () => {
    expect(rules(jsdoc(MAX_EXPORT_JSDOC_LINES, "export function f() {}"))).toEqual([]);
    expect(rules(jsdoc(MAX_EXPORT_JSDOC_LINES + 1, "export function f() {}"))).toEqual(["length"]);
    expect(rules(jsdoc(MAX_EXPORT_JSDOC_LINES, "export const a = 1;"))).toEqual([]);
    expect(rules(jsdoc(MAX_EXPORT_JSDOC_LINES, "export default function f() {}"))).toEqual([]);
  });

  it("treats a member of an exported declaration as exported, and of a private one as not", () => {
    const member = (keyword: string): string =>
      [`${keyword} interface I {`, jsdoc(MAX_EXPORT_JSDOC_LINES, "  a: string;"), "}"].join("\n");
    expect(rules(member("export"))).toEqual([]);
    expect(rules(member(""))).toEqual(["length"]);
  });

  it("excludes type tag lines and their continuations, but not other tags", () => {
    const tags = [" * @param a - the first", " *   continued", " * @returns the sum"];
    expect(rules(jsdoc(MAX_EXPORT_JSDOC_LINES, "export function f(a) {}", tags))).toEqual([]);
    expect(
      rules(jsdoc(MAX_EXPORT_JSDOC_LINES, "export function f() {}", [" * @example", " * f()"])),
    ).toEqual(["length"]);
  });

  it("finds comments in JavaScript and CSS", () => {
    expect(rules(block(4), "scripts/a.mjs")).toEqual(["length"]);
    const css = ["/*", ...lines(4), " */", 'a::after { content: "/* not */"; }'].join("\n");
    expect(scan(css, "apps/portal/app/a.css")).toEqual([
      expect.objectContaining({ line: 1, rule: "length" }),
    ]);
    expect(rules('a::after { content: "/* x\n * y\n * z\n * w */"; }', "apps/a.css")).toEqual([]);
  });

  it("never reads strings, templates, regex literals or JSX text as comments", () => {
    const source = [
      'const a = "// issue #1";',
      "const b = `/* issue #2 */ ${a} // issue #3`;",
      "const c = /\\/\\/ issue #4/;",
      "const d = <p>see // issue #5 and /* issue #6 */</p>;",
    ].join("\n");
    expect(scan(source, "packages/x/src/a.tsx")).toEqual([]);
  });
});

describe("history markers", () => {
  const samples = [
    "see issue #12",
    "from PR #34",
    "per the Code Owner",
    "decided 2026-10-24",
    "since task 042",
    "it was a list, now a map",
  ];

  it("fires each marker, one sample per pattern", () => {
    expect(samples).toHaveLength(HISTORY_MARKERS.length);
    for (const sample of samples) {
      expect(scan(`// ${sample}\nconst a = 1;`), sample).toEqual([
        expect.objectContaining({ line: 1, rule: "history" }),
      ]);
    }
  });

  it("catches a bare number", () => {
    for (const sample of ["pre-#331 spelling", "(#449)", "before #120"]) {
      expect(scan(`// ${sample}`), sample).toEqual([expect.objectContaining({ rule: "history" })]);
    }
  });

  it("reports the line inside a block", () => {
    expect(scan(["/*", " * fine", " * issue #9", " */"].join("\n"))).toEqual([
      expect.objectContaining({ line: 3, rule: "history" }),
    ]);
  });

  it("leaves near misses alone", () => {
    for (const sample of [
      "ADR-24 and SEC-8",
      "version 1.2.3",
      "a 2026-13-40 shape",
      "task 42",
      "colour #fff",
      "&#123;",
    ]) {
      expect(scan(`// ${sample}`), sample).toEqual([]);
    }
  });

  it("lets a TODO cite its issue and nothing else", () => {
    expect(scan("// TODO issue #12: drop once upstream ships")).toEqual([]);
    expect(rules("// TODO 2026-10-24")).toEqual(["history"]);
  });
});

describe("allowlist", () => {
  const directives = [
    "// eslint-disable-next-line no-console -- issue #1 explains",
    "// @ts-expect-error issue #1 upstream typing",
    "// @ts-check 2026-01-01",
    "/* c8 ignore next 2026-01-01 */",
    "// prettier-ignore 2026-01-01",
    '/// <reference types="vite/client" /> 2026-01-01',
    "// check-security-hygiene: allow issue #1 reason",
    "// <!-- expect: issue #1 vendor text -->",
    "// check-comments: allow issue #1 reason",
  ];

  it("exempts each directive from the history markers, one sample per pattern", () => {
    expect(directives).toHaveLength(ALLOWED_LINE.length);
    for (const directive of directives) expect(scan(directive), directive).toEqual([]);
  });

  it("does not count a directive line toward the length limit", () => {
    expect(rules([...lines(3, "// "), directives[0]].join("\n"))).toEqual([]);
  });

  it("exempts only the directive's own line", () => {
    expect(rules([directives[8], "// issue #2"].join("\n"))).toEqual(["history"]);
    expect(rules([...lines(4, "// "), directives[8]].join("\n"))).toEqual(["length"]);
  });

  it("needs a reason after an allow marker", () => {
    for (const marker of ["check-comments: allow", "check-security-hygiene: allow"]) {
      expect(rules([...lines(3, "// "), `// ${marker}`].join("\n")), marker).toEqual(["length"]);
      expect(rules([...lines(3, "// "), `// ${marker} why`].join("\n")), marker).toEqual([]);
    }
  });

  it("exempts a license header block and no other block", () => {
    const header = ["/*", " * Copyright (c) 2026 Example", ...lines(5), " */"].join("\n");
    expect(rules(header)).toEqual([]);
    expect(rules(`${header}\n${block(4)}`)).toEqual(["length"]);
    expect(rules("// SPDX-License-Identifier: MIT")).toEqual([]);
  });
});

describe("scope", () => {
  it("covers source roots and root configs", () => {
    for (const path of [
      "apps/api/src/a.ts",
      "apps/portal/app/a.tsx",
      "apps/portal/app/globals.css",
      "packages/core/src/a.ts",
      "scripts/a.mjs",
      "scripts/a.cjs",
      "tooling/x/a.js",
      "vitest.config.ts",
      "eslint.config.js",
    ]) {
      expect(isInScope(path), path).toBe(true);
    }
  });

  it("skips each documented exclusion and nothing beside it", () => {
    for (const { prefix } of EXCLUDED_PATHS) expect(isInScope(`${prefix}a.ts`), prefix).toBe(false);
    for (const path of [
      "packages/db/src/schema.generated.ts",
      "packages/ui/src/__snapshots__/a.ts",
      "docs/a.ts",
      ".github/a.mjs",
      "apps/api/migrations/0001.sql",
      "apps/api/src/a.json",
    ]) {
      expect(isInScope(path), path).toBe(false);
    }
    expect(isInScope("packages/ui/src/components/a2ui-legacy/a.ts")).toBe(true);
    expect(isInScope("apps/administer/a.ts")).toBe(true);
    expect(isInScope("packages/create-qcms-app/src/a.ts")).toBe(true);
  });

  it("lists real files, this gate among them", () => {
    const files = filesInScope();
    expect(files).toContain("scripts/check-comments.mjs");
    expect(files.some((path) => path.startsWith("apps/admin/"))).toBe(false);
  });
});
