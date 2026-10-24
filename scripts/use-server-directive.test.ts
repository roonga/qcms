import { describe, expect, it } from "vitest";

import { declaresUseServer } from "./use-server-directive.mjs";

/**
 * Do not reproduce the regular expression this scan replaced, even as an oracle: it is
 * the backtracking pattern the replacement removed, and CodeQL alerts on a test too.
 */

const WHITESPACE_PREFIXES: readonly { readonly name: string; readonly prefix: string }[] = [
  { name: "a space", prefix: " " },
  { name: "a tab", prefix: "\t" },
  { name: "a carriage return", prefix: "\r" },
  { name: "a newline", prefix: "\n" },
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
    // A loose budget on purpose: the claim is the complexity class, not a machine's speed.
    const pathological = `/*${"*//*".repeat(50_000)}`;
    const started = Date.now();
    expect(declaresUseServer(pathological)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
