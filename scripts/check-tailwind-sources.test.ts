import { describe, expect, it } from "vitest";

import { appsWithStylesheets, auditApp, sourceRootsIn } from "./check-tailwind-sources.mjs";

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
    // Tailwind accepts @source not directives that narrow scanning; ignoring one can falsely report an excluded
    // directory as covered.
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
    expect(appsWithStylesheets()).toEqual(["apps/admin", "apps/portal"]);
  });

  it.each(["apps/admin", "apps/portal"])("%s has every bundled source file scanned", (app) => {
    const { roots, missingRoots, unscanned } = auditApp(app);

    expect(roots.length).toBeGreaterThan(0);
    expect(missingRoots).toEqual([]);
    expect(unscanned).toEqual([]);
  });

  it("scans the shared component sources, which are the other half of each app's classes", () => {
    // `packages/ui/src` sits outside both apps, so the per-app sweep above cannot see it.
    for (const app of ["apps/admin", "apps/portal"]) {
      expect(auditApp(app).roots).toContain("packages/ui/src");
    }
  });
});
