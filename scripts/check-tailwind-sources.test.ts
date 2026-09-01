import { describe, expect, it } from "vitest";

import { appsWithStylesheets, auditApp, sourceRootsIn } from "./check-tailwind-sources.mjs";

/**
 * Tests for the Tailwind `@source` coverage gate (issue #591).
 *
 * The failure this gate exists for is silent by construction - a class outside the scanned
 * set compiles to nothing, with a green build, a green typecheck and a green lint - so the
 * case that matters most here is the FALSE NEGATIVE: a gate that reports coverage it does
 * not have would certify the omission rather than merely miss it. Three shapes are driven
 * directly, because each fails open in its own way: a directive form the parser cannot
 * read, an app enumeration that could come back empty, and a root list that could be empty
 * while every assertion over it stays vacuously true.
 */

describe("reading the @source list", () => {
  it("resolves each directive against the stylesheet's own directory", () => {
    expect(
      sourceRootsIn(
        '@source "../app";\n@source "../../../packages/ui/src";',
        "apps/admin/app/globals.css",
      ),
    ).toEqual(["apps/admin/app", "packages/ui/src"]);
  });

  it("ignores everything that is not an @source directive", () => {
    const css = '/* @source "../lib" in a comment */\n@import "tailwindcss";\n@source "../app";';
    expect(sourceRootsIn(css, "apps/admin/app/globals.css")).toEqual(["apps/admin/app"]);
  });

  it("REFUSES a directive form it does not model rather than skipping it", () => {
    // The fail-open case, and the reason this throws. Tailwind v4 also accepts
    // `@source not "..."`, which NARROWS the scan: silently ignoring one would leave this
    // gate reporting a directory as covered at the exact moment it stopped being.
    expect(() =>
      sourceRootsIn('@source not "../lib/generated";', "apps/admin/app/globals.css"),
    ).toThrow(/cannot read this @source directive/);
    expect(() =>
      sourceRootsIn('@source inline("underline");', "apps/admin/app/globals.css"),
    ).toThrow(/cannot read this @source directive/);
  });
});

describe("the repository itself", () => {
  it("finds every app that carries its own Tailwind entry stylesheet", () => {
    // Discovered rather than listed, so a third app is covered the day it exists. Both of
    // today's are asserted by name, because an empty or halved result is exactly how a
    // git-backed enumeration fails open.
    expect(appsWithStylesheets()).toEqual(["apps/admin", "apps/portal"]);
  });

  it.each(["apps/admin", "apps/portal"])("%s has every bundled source file scanned", (app) => {
    const { roots, missingRoots, unscanned } = auditApp(app);

    // A positive control first: an empty root list would make the assertion below
    // vacuously true, and a stale root makes the list look broader than it is.
    expect(roots.length).toBeGreaterThan(0);
    expect(missingRoots).toEqual([]);
    expect(unscanned).toEqual([]);
  });

  it("scans the shared component sources, which are the other half of each app's classes", () => {
    // `packages/ui/src` sits outside both apps, so the per-app sweep above cannot see it
    // and its absence would be invisible. It is where every vendored control's class
    // strings live.
    for (const app of ["apps/admin", "apps/portal"]) {
      expect(auditApp(app).roots).toContain("packages/ui/src");
    }
  });
});
