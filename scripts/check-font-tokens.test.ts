import { describe, expect, it } from "vitest";

import {
  TAIL_TOKENS,
  TOKEN_SHEET,
  checkFontTokens,
  checkSource,
  checkStylesheet,
  declarations,
  endsInTail,
  fontFaceRanges,
} from "./check-font-tokens.mjs";

/**
 * Issue #27's gate, fed the shapes it exists to catch.
 *
 * Every case in the first block below is a real declaration that was in this
 * repository the day the gate was written: three sans tails, two mono tails and one
 * inline style object, none of them wrong on any machine that had the primary face.
 * A gate asserted only by "it passes on the current tree" is indistinguishable from
 * a gate that always passes, so the six offenders are the fixtures.
 */

describe("the six stacks that were in the repository", () => {
  it("rejects an inline fallback on a token that is always declared", () => {
    // Unreachable code that reads as a stack: `--font-portal` is declared in the
    // base anchor block of the token sheet, so the fallback arguments never fire.
    expect(
      checkStylesheet(
        "apps/portal/app/globals.css",
        "body { font-family: var(--font-portal, ui-sans-serif, system-ui, sans-serif); }",
      ),
    ).toHaveLength(1);
    expect(
      checkStylesheet(
        "apps/admin/app/globals.css",
        ".v { font-family: var(--font-mono, ui-monospace, monospace); }",
      ),
    ).toHaveLength(1);
  });

  it("rejects a bare family list, in a rule or in a custom property", () => {
    expect(
      checkStylesheet("apps/admin/app/globals.css", "body { font-family: Lexend, sans-serif; }"),
    ).toHaveLength(1);
    expect(
      checkStylesheet(
        "apps/admin/app/theme.css",
        ':root { --font-mono: ui-monospace, "SF Mono", Consolas, monospace; }',
      ),
    ).toHaveLength(1);
    expect(
      checkStylesheet(
        "apps/admin/app/theme.css",
        ':root { --font-admin: "Lexend", ui-sans-serif, system-ui, sans-serif; }',
      ),
    ).toHaveLength(1);
  });

  it("rejects a stack hidden in a style object, which no CSS sweep could see", () => {
    expect(
      checkSource(
        "apps/admin/components/forms/condition-json-pane.tsx",
        'const t = { ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } };',
      ),
    ).toHaveLength(1);
  });

  it("names every offender in one run rather than the first", () => {
    const problems = checkStylesheet(
      "apps/admin/app/globals.css",
      "a { font-family: Arial, sans-serif; }\nb { font-family: Georgia, serif; }\n" +
        ":root { --font-thing: Verdana, sans-serif; }",
    );
    expect(problems).toHaveLength(3);
    expect(problems.map((problem) => /:(?<line>\d+) /u.exec(problem)?.groups?.line)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});

describe("what the contract allows", () => {
  it("accepts a token with no inline fallback, and inherit", () => {
    expect(
      checkStylesheet(
        "apps/portal/app/globals.css",
        "body { font-family: var(--font-portal); }\ninput { font-family: inherit; }\n" +
          "code { font-family: var(--font-mono); }",
      ),
    ).toEqual([]);
  });

  it("accepts a family that delegates its tail to a tail token", () => {
    expect(
      checkStylesheet(
        "packages/ui/src/fonts.css",
        ':root.font-inter { --font-portal: "Inter", var(--font-fallback-sans); }',
      ),
    ).toEqual([]);
    expect(
      checkStylesheet(
        "apps/admin/app/theme.css",
        ':root { --font-admin: "Lexend", var(--font-fallback-sans); }',
      ),
    ).toEqual([]);
  });

  it("accepts @font-face, where font-family binds a name instead of selecting one", () => {
    expect(
      checkStylesheet(
        "packages/ui/src/fonts.css",
        '@font-face { font-family: "Inter"; src: url("./fonts/inter-400.woff2") format("woff2"); }',
      ),
    ).toEqual([]);
    // And the exemption stops at the closing brace.
    expect(
      checkStylesheet(
        "packages/ui/src/fonts.css",
        '@font-face { font-family: "Inter"; }\nbody { font-family: Inter, sans-serif; }',
      ),
    ).toHaveLength(1);
  });

  it("accepts the tail lists only in the token sheet", () => {
    const tails = ":root { --font-fallback-sans: ui-sans-serif, system-ui, sans-serif; }";
    expect(checkStylesheet(TOKEN_SHEET, tails)).toEqual([]);
    expect(checkStylesheet("apps/admin/app/theme.css", tails)).toHaveLength(1);
  });

  it("leaves the documented adopter override surface alone", () => {
    // It ships empty; overriding a tail there is how a deployment adds a face for
    // its own audience, which is the supported edit rather than a second copy.
    expect(
      checkStylesheet(
        "apps/portal/app/adopter-theme.css",
        ':root { --font-fallback-sans: "Noto Sans Devanagari", sans-serif; ' +
          '--font-portal: "Brand", var(--font-fallback-sans); }',
      ),
    ).toEqual([]);
  });
});

describe("Tailwind's own font utilities", () => {
  it("rejects the ones that resolve outside the contract", () => {
    expect(checkSource("a.tsx", '<p className="font-sans" />')).toHaveLength(1);
    expect(checkSource("a.tsx", '<p className="font-serif" />')).toHaveLength(1);
    expect(checkSource("a.tsx", '<p className="font-[Inter]" />')).toHaveLength(1);
    expect(checkSource("a.tsx", '<p className="font-(family-name:--brand)" />')).toHaveLength(1);
  });

  it("accepts font-mono, which reads the --font-mono token, and every weight utility", () => {
    expect(
      checkSource("a.tsx", '<p className="font-mono font-medium font-bold text-xs" />'),
    ).toEqual([]);
  });

  it("ignores prose in comments, so a note about font-sans is not an offence", () => {
    expect(checkSource("a.tsx", "// never use font-sans here\nconst x = 1;")).toEqual([]);
    expect(
      checkStylesheet("a.css", "/* font-family: Arial, sans-serif; */\nb { color: red; }"),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  it("endsInTail accepts the bare token and a family plus the token", () => {
    for (const token of TAIL_TOKENS) {
      expect(endsInTail(`var(${token})`)).toBe(true);
      expect(endsInTail(`"Face", var(${token})`)).toBe(true);
    }
    expect(endsInTail("var(--font-fallback-sans), Arial")).toBe(false);
    expect(endsInTail('"Face", sans-serif')).toBe(false);
  });

  it("reads a value Prettier has reflowed onto continuation lines", () => {
    const [first] = declarations(":root {\n  --font-fallback-sans:\n    a,\n    b;\n}", (name) =>
      name.startsWith("--font-"),
    );
    expect(first?.value).toBe("a, b");
    expect(first?.line).toBe(2);
  });

  it("finds every @font-face range, not only the first", () => {
    expect(fontFaceRanges("@font-face { a } x { b } @font-face { c }")).toHaveLength(2);
  });
});

describe("the shipped tree", () => {
  it("has one place a font-family list is written down", () => {
    expect(checkFontTokens()).toEqual([]);
  });
});
