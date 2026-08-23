import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  isVendoredSource,
  lintScope,
  lintTargets,
  trackedMarkdownFiles,
  trackedManifests,
  trackedSourceFiles,
  uncovered,
} from "./check-lint-coverage.mjs";

/**
 * Tests for the lint-coverage gate itself (issue #413).
 *
 * This gate exists because three separate instances of "green over a file the linter
 * never opened" survived in this repo until somebody happened to read a command echo.
 * A gate against that failure mode must itself be proven able to go red, so the cases
 * below are mostly near-misses: the shapes that would make it quietly report OK.
 */

const temporaryRoots: string[] = [];

/** A throwaway tree, so scope resolution can be tested against real stat() calls. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "qcms-lint-coverage-"));
  temporaryRoots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe("reading lint scope out of a lint script", () => {
  it("reads every target of a plain eslint invocation", () => {
    expect(lintTargets("eslint src e2e scripts")).toEqual(["src", "e2e", "scripts"]);
  });

  it("reads the whole-directory form", () => {
    expect(lintTargets("eslint .")).toEqual(["."]);
  });

  it("reads through a pnpm exec or npx prefix", () => {
    expect(lintTargets("pnpm exec eslint src")).toEqual(["src"]);
    expect(lintTargets("npx eslint src")).toEqual(["src"]);
  });

  it("finds no coverage in a lint script that does not run eslint", () => {
    // The root package's own script. Reporting its targets as anything other than
    // empty would credit the root with coverage it does not have, which is exactly
    // the misreading issue #257 records.
    expect(lintTargets("turbo run lint && prettier --check . && node scripts/check.mjs")).toEqual(
      [],
    );
  });

  it("finds the eslint segment of a compound script and ignores the rest", () => {
    expect(lintTargets("tsc --noEmit && eslint src && prettier --check .")).toEqual(["src"]);
  });

  it("does not mistake a flag for a file", () => {
    expect(lintTargets("eslint src --max-warnings=0 --no-eslintrc")).toEqual(["src"]);
  });

  it("does not mistake a flag's VALUE for a file", () => {
    // The near-miss that matters: reading `custom.config.js` as a lint target would
    // silently widen apparent coverage by one path, and nothing would ever say so.
    expect(lintTargets("eslint --config custom.config.js src")).toEqual(["src"]);
    expect(lintTargets("eslint -f json src")).toEqual(["src"]);
  });
});

describe("resolving scope against the tree", () => {
  it("covers everything beneath a directory target, and nothing beside it", () => {
    const root = fixtureRoot({
      "package.json": JSON.stringify({ scripts: { lint: "eslint src" } }),
      "src/index.ts": "",
      "sr/other.ts": "",
    });
    const scope = lintScope(["package.json"], root);

    expect(scope.dirs).toEqual(["src/"]);
    expect(scope.missing).toEqual([]);
    // A prefix test must not let `sr/` be covered by a `src/` entry: the trailing
    // slash is what makes "starts with" safe here.
    expect(scope.dirs.some((dir) => "sr/other.ts".startsWith(dir))).toBe(false);
  });

  it("covers exactly the file a file target names", () => {
    const root = fixtureRoot({
      "package.json": JSON.stringify({ scripts: { lint: "eslint next.config.ts" } }),
      "next.config.ts": "",
    });
    const scope = lintScope(["package.json"], root);

    expect(scope.files.has("next.config.ts")).toBe(true);
    expect(scope.dirs).toEqual([]);
  });

  it("resolves a package's targets relative to that package, not the repo root", () => {
    const root = fixtureRoot({
      "apps/portal/package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
      "apps/portal/proxy.ts": "",
    });
    const scope = lintScope(["apps/portal/package.json"], root);

    expect(scope.dirs).toEqual(["apps/portal/"]);
  });

  it("reports a lint target that does not exist rather than ignoring it", () => {
    // A stale target is the #387 item 21 shape: a lint script nobody re-read. Left
    // unreported it reads as coverage.
    const root = fixtureRoot({
      "package.json": JSON.stringify({ scripts: { lint: "eslint src gone" } }),
      "src/index.ts": "",
    });
    const scope = lintScope(["package.json"], root);

    expect(scope.missing).toEqual([{ manifest: "package.json", target: "gone" }]);
  });

  it("credits a package with no lint script with no coverage", () => {
    const root = fixtureRoot({
      "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
      "src/index.ts": "",
    });
    const scope = lintScope(["package.json"], root);

    expect(scope.dirs).toEqual([]);
    expect(scope.files.size).toBe(0);
  });
});

describe("finding uncovered files", () => {
  const scope = { dirs: ["src/"], files: new Set(["next.config.ts"]) };

  it("flags a tracked source file no lint run reaches", () => {
    const result = uncovered(["stray.ts"], scope);
    expect(result).toEqual(["stray.ts"]);
  });

  it("passes a file inside a directory target or named exactly", () => {
    const result = uncovered(["src/a.ts", "next.config.ts"], scope);
    expect(result).toEqual([]);
  });

  it("treats every uncovered file as a violation", () => {
    const result = uncovered(["scripts/tool.mjs", "stray.ts"], scope);
    expect(result).toEqual(["scripts/tool.mjs", "stray.ts"]);
  });
});

describe("recognizing the vendored source boundary", () => {
  it("recognizes only files within the upstream component copy", () => {
    expect(isVendoredSource("packages/ui/src/components/a2ui/button/Button.tsx")).toBe(true);
    expect(isVendoredSource("packages/ui/src/components/action-context/index.ts")).toBe(false);
    expect(isVendoredSource("packages/ui/src/components.tsx")).toBe(false);
    expect(isVendoredSource("packages/ui/src/components-local/button.tsx")).toBe(false);
    expect(isVendoredSource("apps/admin/components/button.tsx")).toBe(false);
  });
});

describe("against this repository", () => {
  it("sees a non-trivial tree, so a passing run is not a run over nothing", () => {
    // A gate that silently scanned zero files would report OK forever. The count is
    // in the hundreds; the bound only has to rule out "empty".
    expect(trackedSourceFiles().length).toBeGreaterThan(100);
    expect(trackedMarkdownFiles().length).toBeGreaterThan(50);
    expect(trackedManifests()).toContain("package.json");
  });

  it("lints both Next.js apps by directory rather than by a hand-written file list", () => {
    // The #413 fix itself, asserted where it cannot silently regress: with `eslint .`
    // a new root-level file is covered; with an enumerated list it is not.
    // Derived from this file's own location rather than from cwd, so the assertion
    // is about the repository and not about where the runner happened to start.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const scope = lintScope(["apps/portal/package.json", "apps/admin/package.json"], repoRoot);

    expect(scope.dirs).toEqual(expect.arrayContaining(["apps/portal/", "apps/admin/"]));

    const hypothetical = ["apps/portal/new-root-file.ts", "apps/admin/new-root-file.ts"];
    const result = uncovered(hypothetical, scope);
    expect(result).toEqual([]);
  });
});
