import { describe, expect, it } from "vitest";

// Plain JavaScript with `// @ts-check`, imported by relative path the way
// `check-ci-parity.test.ts` imports its gate.
import {
  ALLOWED,
  catalogIn,
  deadKeys,
  isReferenced,
  isTestFile,
  literalsIn,
  ownerOf,
  scanned,
} from "./check-dead-i18n-keys.mjs";

import ts from "typescript";

/**
 * Tests for the dead-i18n-key gate (issues #538, #756).
 *
 * A gate asserted only by "it passes on the current tree" is indistinguishable from a gate
 * that always passes, so every helper is driven with hand-built source and both directions
 * are covered: the shape that must be caught, and the near-miss that must not be.
 *
 * The near-misses are not invented. Each one is a shape #755 measured while deciding that
 * a regex could not do this job, or a shape this repository actually contains:
 *
 *  - `formPost(`...`)` in a portal test, which an unanchored `t(` + backtick pattern reads
 *    as a dynamic key (`apps/portal/lib/server/origin-guard.test.ts`).
 *  - `expect(source).not.toContain("forms.section.heading")`, an assertion that a key is
 *    ABSENT, which a text scan reads as a reference to it.
 *  - a key that never appears at a `t()` call at all because it travels through a
 *    `Record<string, MessageKey>` table (`apps/admin/lib/forms/errors.ts`).
 *  - `forms.history.compareRow${...}`, a dynamic prefix with NO dot before the hole.
 *  - a multi-line `tPlural(` call, which a line-based scan splits in half.
 */

/** Parse a fragment the way the gate does. */
function source(text: string, path = "fixture.ts"): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const CATALOG = `
export const messages = {
  "a.one": "One",
  "a.two": "Two",
  "b.only": "Only",
} as const;
export type MessageKey = keyof typeof messages;
`;

describe("finding a catalog", () => {
  it("reads the keys out of an `export const messages = {...} as const`", () => {
    expect(catalogIn(source(CATALOG))?.keys).toEqual(["a.one", "a.two", "b.only"]);
  });

  it("is not fooled by a module-private or differently named object", () => {
    expect(catalogIn(source(`const messages = { "a.one": "One" } as const;`))).toBeUndefined();
    expect(
      catalogIn(source(`export const labels = { "a.one": "One" } as const;`)),
    ).toBeUndefined();
  });

  it("finds no catalog in an ordinary module", () => {
    expect(catalogIn(source(`export function t(key: string) { return key; }`))).toBeUndefined();
  });
});

describe("collecting the literals a file states", () => {
  it("reads a plain argument, a table value and a ternary alike", () => {
    const found = literalsIn(
      source(`
        const TABLE: Record<string, MessageKey> = { CODE: "a.two" };
        export const x = t("a.one");
        export const y = t(flag ? "b.only" : "a.one");
      `),
      undefined,
    );
    expect(found.has("a.one")).toBe(true);
    expect(found.has("a.two")).toBe(true);
    expect(found.has("b.only")).toBe(true);
  });

  it("reads the static head of a template literal, which holds no string literal at all", () => {
    const found = literalsIn(source("export const x = t(`ops.status.${row.status}`);"), undefined);
    expect(found.has("ops.status.")).toBe(true);
  });

  it("survives a call split across lines", () => {
    const found = literalsIn(
      source(`
        export const x = tPlural(
          "a.one",
          "a.two",
          count,
        );
      `),
      undefined,
    );
    expect([...found].sort()).toEqual(["a.one", "a.two"]);
  });

  it("does not read a key out of a comment", () => {
    const found = literalsIn(source(`// a.one is gone\n/* a.two too */\nexport const x = 1;`), undefined);
    expect(found.size).toBe(0);
  });

  it("skips the catalog's own definition, so a catalog does not keep itself alive", () => {
    const file = source(CATALOG);
    const catalog = catalogIn(file);
    expect(literalsIn(file, catalog?.node).has("a.one")).toBe(false);
  });
});

describe("deciding whether a key is referenced", () => {
  it("takes an exact literal", () => {
    expect(isReferenced("a.one", new Set(["a.one"]))).toBe(true);
  });

  it("takes a dotted prefix, which is how a dynamic key is assembled", () => {
    expect(isReferenced("ops.status.pending", new Set(["ops.status."]))).toBe(true);
  });

  it("takes a prefix with no dot before the hole", () => {
    // `forms.history.compareRow${kindKey(row)}` is a real site in this repository.
    expect(isReferenced("forms.history.compareRowAdded", new Set(["forms.history.compareRow"]))).toBe(
      true,
    );
  });

  it("refuses an empty or undotted literal as a wildcard", () => {
    expect(isReferenced("a.one", new Set([""]))).toBe(false);
    expect(isReferenced("a.one", new Set(["a"]))).toBe(false);
  });

  it("refuses the key's own suffix and an unrelated literal", () => {
    expect(isReferenced("a.one", new Set(["one", "b.only"]))).toBe(false);
  });

  it("does not let a longer literal stand in for a shorter key", () => {
    // A prefix must be SHORTER than the key. `a.one.deep` is a different key, not a
    // reference to `a.one`.
    expect(isReferenced("a.one", new Set(["a.one.deep"]))).toBe(false);
  });
});

describe("what is not a reference", () => {
  it("classifies unit tests, Playwright specs, e2e scenarios and their support files", () => {
    expect(isTestFile("apps/admin/lib/forms/errors.test.ts")).toBe(true);
    expect(isTestFile("apps/admin/components/ops/webhook-config-rejects.test.tsx")).toBe(true);
    expect(isTestFile("apps/portal/e2e/theming.pw.ts")).toBe(true);
    expect(isTestFile("apps/api/e2e/security/03-db-least-privilege.e2e.ts")).toBe(true);
    expect(isTestFile("apps/portal/e2e/support/api-server.ts")).toBe(true);
    expect(isTestFile("apps/admin/lib/forms/errors.ts")).toBe(false);
    expect(isTestFile("apps/admin/components/ops/webhook-config.tsx")).toBe(false);
  });

  it("reads an absence assertion as what it is, which is not a reference", () => {
    // The exact line in `app/(shell)/section-headings.test.tsx` that a text scan misreads.
    const file = "apps/admin/app/(shell)/section-headings.test.tsx";
    expect(isTestFile(file)).toBe(true);
  });

  it("does not mistake a POST helper for a dynamic key", () => {
    // `appearanceRoute.POST(formPost(`${PORTAL_BASE}/appearance`, headers, form))` - the
    // site #755 measured. Its template head is a URL fragment with no dot, so it can never
    // be read as a key prefix even if the file were in scope.
    const found = literalsIn(
      source("appearanceRoute.POST(formPost(`${PORTAL_BASE}/appearance`, headers, form));"),
      undefined,
    );
    expect(isReferenced("appearance.mode.light", found)).toBe(false);
  });
});

describe("scoping", () => {
  it("attributes a file to its own app or package", () => {
    expect(ownerOf("apps/admin/lib/i18n/en.ts")).toBe("apps/admin");
    expect(ownerOf("packages/ui/src/kit.tsx")).toBe("packages/ui");
  });

  it("attributes nothing to a repo-root file", () => {
    expect(ownerOf("vitest.config.ts")).toBeUndefined();
    expect(ownerOf("apps/admin")).toBeUndefined();
  });

  it("never scans the generated template mirror, which would double every catalog", () => {
    const templated = scanned().filter((path) =>
      path.startsWith("packages/create-qcms-app/templates/"),
    );
    expect(templated).toEqual([]);
  });
});

describe("the repository", () => {
  it("has no dead catalog key", () => {
    expect(deadKeys()).toEqual([]);
  });

  it("carries no standing exemption", () => {
    // An entry here is a claim that a key is rendered through a shape the scan cannot
    // read. There is no such key today, and this line is what makes adding one deliberate.
    expect(ALLOWED).toEqual({});
  });

  it("finds both catalogs, so the scan is not silently scoped to one app", () => {
    const catalogs = scanned().filter((path) => path.endsWith("lib/i18n/en.ts"));
    expect(catalogs).toEqual(["apps/admin/lib/i18n/en.ts", "apps/portal/lib/i18n/en.ts"]);
  });
});
