import { describe, expect, it } from "vitest";

import {
  MINIMUM_SCANNED,
  TAIL_TOKENS,
  TOKEN_SHEET,
  checkFontTokens,
  checkSource,
  checkStylesheet,
  declarations,
  endsInTail,
  fontFaceRanges,
  scannedFiles,
} from "./check-font-tokens.mjs";
import { VENDORED_SOURCE_PREFIX } from "./vendored-source.mjs";

/**
 * Issue #27's gate, fed the declarations it exists to catch, VERBATIM.
 *
 * Ten declarations in this repository spelled a font-family list out, and between them
 * they said seven different things. Seven of the ten are shapes this gate judges: the
 * six stylesheet declarations in `REAL_DECLARATIONS` below, plus the one style object in
 * `REAL_STYLE_OBJECT`. All seven are copied byte for byte out of the merge base (commit
 * `a2602be8`), file and line recorded, so the fixtures cannot drift into
 * plausible-looking paraphrases of what was there. The gate must reject every one of
 * them, and the same file at the head must pass.
 *
 * The other three are the tails in `packages/ui/src/font-registry.ts` (`SANS_TAIL`,
 * `SERIF_TAIL`, `MONO_TAIL`) and are deliberately NOT this gate's business: they are TS
 * string constants, not a `font-family` declaration or a style object, and the manifest's
 * own suite polices them - `packages/ui/src/font-registry.test.ts` asserts that every
 * entry's tail is one of the three tail TOKENS.
 *
 * A gate asserted only by "it passes on the current tree" is indistinguishable from a
 * gate that always passes, which is why the fixtures are the real thing rather than a
 * sketch of it.
 */

/** The six real declarations, as they stood at the merge base. */
const REAL_DECLARATIONS = [
  {
    where: "apps/portal/app/globals.css:89",
    source: "body {\n  font-family: var(--font-portal, ui-sans-serif, system-ui, sans-serif);\n}",
    why: "an inline fallback on a token the sheet always declares: it can never fire",
  },
  {
    where: "apps/admin/app/globals.css:2531",
    source:
      ".qcms-preview-surface[data-qcms-theme-scope] {\n" +
      "  font-family: var(--font-portal, ui-sans-serif, system-ui, sans-serif);\n}",
    why: "the same unreachable list again, for the respondent preview island",
  },
  {
    where: "apps/admin/app/globals.css:1678",
    source:
      ".qcms-rule-sentence__value {\n  font-family: var(--font-mono, ui-monospace, monospace);\n}",
    why: "a third unreachable inline fallback, and a mono list nothing else had",
  },
  {
    where: "apps/admin/app/theme.css:57",
    source:
      ':root {\n  --font-admin: "Lexend", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,' +
      " sans-serif;\n}",
    why: "a full copy of the portal's sans tail, in the app's own token sheet",
  },
  {
    where: "apps/admin/app/theme.css:58",
    source:
      ':root {\n  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Consolas,' +
      " monospace;\n}",
    why: "a mono list with two faces the portal's did not have",
  },
  {
    where: "packages/ui/src/theme.css:69",
    source:
      ":is(:root, [data-qcms-theme-scope]) {\n" +
      '  --font-portal: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n}',
    why: "even the token sheet may only spell a list out under a --font-fallback-* name now",
  },
] as const;

/** The seventh shape, and the only one outside a stylesheet. */
const REAL_STYLE_OBJECT = {
  where: "apps/admin/components/forms/condition-json-pane.tsx:222",
  source:
    "const theme = {\n" +
    '  ".cm-content": {\n' +
    '    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",\n' +
    '    caretColor: "var(--color-text)",\n  },\n};',
  why: "a CodeMirror theme object, where no sweep of the stylesheets could have seen it",
};

describe("the real declarations that were in the repository", () => {
  for (const { where, source, why } of REAL_DECLARATIONS) {
    it(`rejects ${where}: ${why}`, () => {
      const [file] = where.split(":");
      const problems = checkStylesheet(file ?? "", source);
      expect(problems, `${where} was accepted`).toHaveLength(1);
      expect(problems[0]).toContain(file ?? "");
    });
  }

  it(`rejects ${REAL_STYLE_OBJECT.where}: ${REAL_STYLE_OBJECT.why}`, () => {
    const [file] = REAL_STYLE_OBJECT.where.split(":");
    expect(checkSource(file ?? "", REAL_STYLE_OBJECT.source)).toHaveLength(1);
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

  it("scans a corpus that cannot have gone quietly empty", () => {
    // CONTRIBUTING's companion clause to deriving the set from git: "each caller also
    // asserts that its scan reaches something". Without this, narrowing SCAN_DIRS or
    // SCAN_EXTENSIONS leaves all three rules vacuously true and the gate still green,
    // which is the one failure a gate cannot notice about itself.
    const files = scannedFiles();
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_SCANNED);

    // Every file the real declarations lived in is in scope, the token sheet included.
    // A narrowing that dropped any of them would be green about a tree it no longer reads.
    for (const where of [
      ...REAL_DECLARATIONS.map((entry) => entry.where),
      REAL_STYLE_OBJECT.where,
    ]) {
      const file = where.split(":")[0] ?? "";
      expect(files, `${file} is outside the scan`).toContain(file);
    }
  });

  it("leaves the vendor drop, the test files and the template copies out", () => {
    const files = scannedFiles();
    // ADR-22: a gate cannot ask a byte-for-byte upstream copy to change.
    expect(files.filter((file) => file.startsWith(VENDORED_SOURCE_PREFIX))).toEqual([]);
    expect(files.filter((file) => /\.(?:test|spec|pw)\.tsx?$/u.test(file))).toEqual([]);
    // The twins are byte-identical to the apps above and `check:templates` keeps them so.
    expect(files.filter((file) => file.includes("/templates/"))).toEqual([]);
  });

  it("reaches the .css, .ts and .tsx files and nothing else", () => {
    const other = scannedFiles().filter((file) => !/\.(?:css|ts|tsx)$/u.test(file));
    expect(other).toEqual([]);
    // Each extension is actually represented, so a rule that only ever sees one kind of
    // file is not mistaken for a rule that holds across the tree.
    for (const extension of [".css", ".ts", ".tsx"]) {
      expect(
        scannedFiles().some((file) => file.endsWith(extension)),
        `no ${extension} file in the scan`,
      ).toBe(true);
    }
  });
});
