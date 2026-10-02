import { describe, expect, it } from "vitest";

import { declaresUseServer } from "./use-server-directive.mjs";

/**
 * The shared `"use server"` directive scan (task 073).
 *
 * It exists because three gates derive the Server Action set from disk rather than
 * remembering it: the origin-guard gate enumerates every action across both Next apps and
 * asserts each one belts itself (R-B2), the portal's belt-log test holds each to a
 * `BeltRoute`, and its import-surface test walks the component graph out of each. A file
 * this scan does not recognise is an action none of those three reaches, so the cost of a
 * false negative is a whole rule silently not applying.
 *
 * **The expression it replaced is deliberately NOT reproduced here**, and the first draft of
 * this file got that wrong too: keeping it as an oracle to compare against re-introduced the
 * exact pattern the replacement existed to remove, and CodeQL raised a fourth alert on this
 * file (alert 25, after 22 to 24 were fixed). An alert in a test is still an alert on the
 * repository.
 *
 * What replaces it is stronger. The property under test is "whitespace means `\s`", and the
 * draft asserted it against ten hand-picked characters; the derived case below asserts it
 * across every code point up to U+3000 plus the BOM, in both directions, so no class can be
 * dropped unnoticed. That is what the narrowing review found (PR #1034) stated as a test
 * rather than as a comparison.
 */

/** Every prefix that is ECMAScript whitespace and must therefore be skipped. */
const WHITESPACE_PREFIXES: readonly { readonly name: string; readonly prefix: string }[] = [
  { name: "a space", prefix: " " },
  { name: "a tab", prefix: "\t" },
  { name: "a carriage return", prefix: "\r" },
  { name: "a newline", prefix: "\n" },
  // The four the first draft dropped. A BOM is what an editor on Windows adds without being
  // asked, and a no-break space is what a paste from a document carries in.
  { name: "a UTF-8 BOM", prefix: "﻿" },
  { name: "a no-break space", prefix: " " },
  { name: "a form feed", prefix: "\f" },
  { name: "a vertical tab", prefix: "\v" },
  { name: "a line separator", prefix: " " },
  { name: "a paragraph separator", prefix: " " },
];

describe("declaresUseServer", () => {
  it("recognises the directive as the first statement", () => {
    expect(declaresUseServer('"use server";\n')).toBe(true);
    expect(declaresUseServer("'use server';\n")).toBe(true);
    expect(declaresUseServer('"use server"\n')).toBe(true);
  });

  it.each(WHITESPACE_PREFIXES)("skips $name before the directive", ({ prefix }) => {
    expect(declaresUseServer(`${prefix}"use server";\n`)).toBe(true);
  });

  it("skips leading line and block comments, in any order", () => {
    expect(declaresUseServer('// a\n/* b */\n"use server";')).toBe(true);
    expect(declaresUseServer('/* a */ /* b */ "use server"')).toBe(true);
    expect(declaresUseServer('/*\n * many\n * lines\n */\n"use server";')).toBe(true);
  });

  it("refuses a mention that is not the first statement", () => {
    // The whole distinction the three gates need: a module that merely talks about actions
    // is not one, and a route handler whose docblock quotes the directive is not one either.
    expect(declaresUseServer('import x from "y";\n"use server";\n')).toBe(false);
    expect(declaresUseServer('const s = "use server";\n')).toBe(false);
    expect(declaresUseServer("export const NOTE = 'use server';\n")).toBe(false);
    expect(declaresUseServer('"use client";\n')).toBe(false);
  });

  it("refuses a file that never gets past its own comment", () => {
    expect(declaresUseServer("/* unterminated")).toBe(false);
    expect(declaresUseServer("// only a comment")).toBe(false);
    expect(declaresUseServer("")).toBe(false);
    expect(declaresUseServer("   \n\t")).toBe(false);
  });

  it("treats exactly ECMAScript whitespace as skippable, derived rather than listed", () => {
    // The assertion the narrowing would have failed, and it is derived from `\s` itself so
    // that no class can be left out of a hand-written list. Both directions matter: a
    // whitespace character must be SKIPPED, because a module beginning with one still has the
    // directive as its first statement, and a non-whitespace character must STOP the walk,
    // because otherwise some other first statement would read as the directive.
    const codePoints = [...Array.from({ length: 0x3001 }, (_unused, code) => code), 0xfeff];
    const disagreed: string[] = [];
    for (const code of codePoints) {
      const char = String.fromCodePoint(code);
      const isWhitespace = /\s/.test(char);
      if (declaresUseServer(`${char}"use server";`) !== isWhitespace) {
        disagreed.push(`U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
    expect(disagreed, "code points where the walk and `\\s` disagree").toEqual([]);
  });

  it("is linear on the input that made the expression backtrack", () => {
    // The CodeQL alert's own shape: a block-comment open followed by many closes and opens.
    // The expression takes exponential time on this; the walk is O(n). The budget is loose
    // on purpose, because what is being asserted is the complexity class rather than a
    // machine's speed, and an exponential implementation would not finish at all.
    const pathological = `/*${"*//*".repeat(50_000)}`;
    const started = Date.now();
    expect(declaresUseServer(pathological)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
