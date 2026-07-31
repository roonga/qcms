import { describe, expect, it } from "vitest";

import {
  catalogValues,
  checkAdminTheme,
  findLiteralColours,
  literalColourFunctions,
  stripComments,
} from "./check-admin-theme.mjs";

/**
 * The gate has to fail on the shapes it exists to catch, and the only way to know
 * that is to feed it those shapes. A gate asserted only by "it passes on the current
 * tree" is indistinguishable from a gate that always passes, which is the failure
 * mode this file exists to rule out (task 055, exit criteria 1 and 3).
 */

describe("literal colour detection", () => {
  it("rejects the shapes that break light/dark/HC", () => {
    expect(findLiteralColours("a { color: #2456c6; }").map((h) => h.hit)).toEqual(["#2456c6"]);
    expect(findLiteralColours('<div className="bg-white" />').map((h) => h.hit)).toEqual([
      "bg-white",
    ]);
    expect(findLiteralColours('<div className="text-slate-700" />').map((h) => h.hit)).toEqual([
      "text-slate-700",
    ]);
    expect(literalColourFunctions("a { color: rgb(0 0 0 / 0.5); }")).toEqual(["rgb(0 0 0 / 0.5)"]);
  });

  it("accepts every token-derived form the app actually uses", () => {
    for (const line of [
      "a { color: var(--color-text); }",
      '<a href="#main-content">skip</a>',
      "a { box-shadow: 0 1px 2px hsl(var(--shadow-color) / 0.06); }",
      "a { background: color-mix(in srgb, var(--color-background) 88%, transparent); }",
      '<div className="text-(--color-text-muted) border-(--color-border)" />',
    ]) {
      expect(findLiteralColours(line), line).toEqual([]);
    }
  });

  it("reports the line the colour is on", () => {
    expect(findLiteralColours("a {\n  color: #fff;\n}")).toEqual([{ line: 2, hit: "#fff" }]);
  });
});

describe("comment stripping", () => {
  it("blanks comments without moving any line", () => {
    const stripped = stripComments("one\n/* two\n   three */\nfour // five\n", true);
    expect(stripped.split("\n")).toHaveLength(5);
    expect(stripped).not.toContain("three");
    expect(stripped).not.toContain("five");
    expect(stripped).toContain("four");
  });

  it("leaves a protocol-relative URL alone", () => {
    expect(stripComments('const u = "https://example.test";', true)).toContain("example.test");
  });
});

describe("catalog values", () => {
  const CATALOG = [
    "/** Admin shell message catalog - a comment, not a string anyone reads. */",
    "export const messages = {",
    '  "app.title": "QCMS",',
    '  "enroll.intro":',
    '    "Scan this code with your app.",',
    "} as const;",
  ].join("\n");

  it("reads values, not keys or comments", () => {
    expect(catalogValues(CATALOG).map((v) => v.text)).toEqual([
      "QCMS",
      "Scan this code with your app.",
    ]);
  });

  it("catches a user-facing name on a continuation line", () => {
    const bad = CATALOG.replace("Scan this code", "Scan this admin code");
    expect(catalogValues(bad).some((v) => /admin/i.test(v.text))).toBe(true);
  });
});

describe("the repository", () => {
  it("passes all three gates", () => {
    expect(checkAdminTheme()).toEqual([]);
  });
});
