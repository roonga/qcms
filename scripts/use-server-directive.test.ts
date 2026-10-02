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
 * The expression it replaced is kept here as the ORACLE. That is the point of this file:
 * the replacement was made to remove a CodeQL backtracking alert (alerts 22 to 24 on
 * PR #1034), not to change behaviour, and the first draft narrowed the whitespace set
 * without anyone noticing until review. Comparing against the expression is the only
 * assertion that would have caught that.
 */
const ORACLE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;

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
    const source = `${prefix}"use server";\n`;
    expect(declaresUseServer(source)).toBe(true);
    // And agrees with the expression, which is what "no behaviour change" means.
    expect(declaresUseServer(source)).toBe(ORACLE.test(source));
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

  it("agrees with the expression it replaced on every case above", () => {
    const sources = [
      '"use server";\n',
      "'use server';\n",
      '// a\n/* b */\n"use server";',
      '/* a */ /* b */ "use server"',
      'import x from "y";\n"use server";\n',
      'const s = "use server";\n',
      '"use client";\n',
      "/* unterminated",
      "// only a comment",
      "",
      ...WHITESPACE_PREFIXES.map(({ prefix }) => `${prefix}"use server";`),
    ];
    for (const source of sources) {
      expect(declaresUseServer(source), JSON.stringify(source)).toBe(ORACLE.test(source));
    }
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
