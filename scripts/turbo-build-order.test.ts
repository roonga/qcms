import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "./docker.mjs";
import { isGeneratedCopy } from "./generated-copy.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * Every `dist` a program-shaped task reads is built before that task starts (issue
 * #765).
 *
 * ## What goes wrong without this
 *
 * `typecheck` and `lint` are program-shaped: both build a tsc program, so both read
 * the BUILT declarations of every workspace package the program reaches. A tsc
 * program is not bounded by the manifest. `apps/portal/tsconfig.json` includes
 * `**\/*.ts`, which takes in the Playwright harness, and two files there import
 * apps/api source by relative path, so the portal's program transitively contains the
 * API's source tree and therefore `@roonga/qcms-db`, `@roonga/qcms-csv` and `@roonga/qcms-a2ui-compiler` -
 * none of which the portal's manifest names. turbo cannot see that, so `^build`
 * ordered none of it.
 *
 * The admin hit this as issue #560 and got explicit `dependsOn` entries. `apps/e2e`
 * hit it and took the devDependency route. The portal had the same reach the whole
 * time and neither, which is how the same defect was fixed twice and shipped a third
 * time.
 *
 * ## Why it read as a flake rather than as a missing edge
 *
 * Since issue #494 every emitting package's build removes its own `dist` before `tsc`
 * writes into it. An undeclared read of a `dist` that simply sits there from a
 * previous build succeeds; the same read against a package that is mid-build fails.
 * So `turbo run typecheck --filter=qcms-admin --filter=qcms-portal --force` failed
 * with 40-odd TS2307s while either filter alone was green, because alone nothing asks
 * for `@roonga/qcms-db#build` and nothing removes its `dist`. The removal made a latent
 * missing edge observable; it is not itself the bug, and adding a retry or serializing
 * turbo would have hidden the finding rather than fixed it.
 *
 * ## How the claim is derived
 *
 * Both halves come from the tree rather than from a list in this file, because a list
 * stops covering the tree the moment it grows (the rule in `CONTRIBUTING.md`).
 *
 * - **What a task reads** is the relative-import walk below, seeded from every tracked
 *   `.ts`/`.tsx` in the package and followed across package boundaries, exactly as tsc
 *   follows them. The same shape as `packages/db/src/import-manifest.test.ts`.
 * - **What turbo orders** is asked of turbo, through `--dry=json`, and closed
 *   transitively. Re-deriving `dependsOn` here would mean a second implementation of
 *   turbo's resolution that agrees with turbo only until one of them changes.
 * - **Which packages are at risk** is the set whose build removes its own `dist`
 *   first, read from the build scripts. A package that stops doing that leaves the set
 *   on its own.
 */

/** turbo tasks that build a tsc program and therefore read built declarations. */
const PROGRAM_SHAPED_TASKS = ["typecheck", "lint"] as const;

/** A module specifier, as opposed to a fragment of prose a loose regex matched. */
const PLAUSIBLE_SPECIFIER = /^[^\s'"`;(){}]+$/;

/**
 * `from "x"`, `import "x"`, `import("x")`. Deliberately not a parser, and the two kinds
 * of candidate it yields are filtered differently, which is worth being exact about
 * because only one of them ever touches the disk.
 *
 * A **relative** specifier is filtered by {@link PLAUSIBLE_SPECIFIER} and then by
 * whether it resolves to a file, so a match inside a string or a comment that names no
 * real file is dropped and the walk does not follow it. A **bare `@roonga/qcms-*`** specifier
 * is filtered by {@link PLAUSIBLE_SPECIFIER} alone and then recorded: there is nothing
 * on disk to check it against, since the whole question is whether that package's
 * `dist` has been built yet.
 *
 * So the reached set is an over-approximation: a package name written in a comment or
 * a string, in a file the walk reaches, counts as a read. That direction is deliberate.
 * The claim is "every dist this program reads is built before it reads it", and an
 * over-approximation can only DEMAND a build edge that turns out to be unnecessary -
 * which fails loudly, naming the surplus edge, for a human to judge. The
 * under-approximation is the dangerous one: it lets a genuine missing edge through in
 * silence, which is the defect this file exists for.
 *
 * ## Two surplus demands have been judged, and both were names as data
 *
 * `create-qcms-app` (task 037) is the first package in this repository that writes
 * module specifiers it does not run, and it does so in two different shapes. Both
 * produced surplus edges here, and adding those edges would have been wrong: an edge
 * exists to make turbo wait for a `dist` that something opens, and nothing in this
 * package opens either one.
 *
 * Each shape is refused by its own rule below, because they are false for different
 * reasons. Neither rule is "skip this package": a genuine `@roonga/qcms-*` import written in
 * `packages/create-qcms-app/src/` is still counted, and a test asserts it.
 */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']|\brequire\(\s*["']([^"'\n]+)["']\s*\)/g;

/**
 * Whether the match at `index` began inside a string literal on its own line.
 *
 * The first shape of names-as-data: a fixture that HOLDS a program, as
 * `scripts/sync-templates.test.ts` does when it hands `assertImports` the text
 * `'import { x } from "@roonga/qcms-db";'` to scan. The inner specifier is in import position
 * within the quoted text and in string position within the file, so tsc never resolves
 * it and no `dist` is read.
 *
 * Counted rather than parsed, deliberately, because {@link SPECIFIER} is deliberately
 * not a parser either and a half-parser here would be the worse of both. Quotes are
 * counted on the match's own line up to the match: an odd count of one kind means the
 * match opened inside a still-open literal of that kind. That is cheap, and it errs
 * the safe way in both directions - a genuine `import` sits at the head of its line
 * with no quotes before it, so it is never mistaken for data.
 */
function insideStringLiteral(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const before = text.slice(lineStart, index);
  return ["'", '"', "`"].some(
    (quote) => before.split(quote).length - 1 > 0 && (before.split(quote).length - 1) % 2 === 1,
  );
}

/** How tsc resolves a relative specifier written the way this repository writes them. */
const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];

interface WorkspacePackage {
  readonly name: string;
  readonly directory: string;
  readonly scripts: Readonly<Record<string, string>>;
}

/** Every workspace package, from its tracked manifest. */
function workspacePackages(): WorkspacePackage[] {
  const manifests = trackedFilesUnder(REPOSITORY_ROOT, {
    match: /^(packages|apps)\/[^/]+\/package\.json$/,
  });
  return manifests.map((path) => {
    const parsed: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, path), "utf8"));
    const manifest = parsed as { name: string; scripts?: Record<string, string> };
    return {
      name: manifest.name,
      directory: join(REPOSITORY_ROOT, dirname(path)),
      scripts: manifest.scripts ?? {},
    };
  });
}

/**
 * The packages whose build removes its own `dist` before emitting into it, which is
 * what turns an undeclared read into a failure rather than a stale success.
 */
function packagesThatCleanTheirDist(packages: readonly WorkspacePackage[]): Set<string> {
  return new Set(
    packages.filter((pkg) => (pkg.scripts.build ?? "").includes("clean-dist")).map((p) => p.name),
  );
}

/** The file a relative specifier names, or `undefined` when it names none. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  const bases = [base];
  // The repository writes `.js` in source and lets the resolver find the `.ts`.
  if (base.endsWith(".js")) bases.push(base.slice(0, -3), `${base.slice(0, -3)}.ts`);
  if (base.endsWith(".jsx")) bases.push(`${base.slice(0, -4)}.tsx`);
  for (const candidate of bases) {
    for (const suffix of RESOLUTION_SUFFIXES) {
      const path = candidate + suffix;
      if (existsSync(path) && statSync(path).isFile()) return path;
    }
  }
  return undefined;
}

/**
 * Every `@roonga/qcms-*` package the tsc program rooted at `directory` reaches, following
 * relative imports across package boundaries the way tsc does.
 */
function workspaceImportsReachedFrom(directory: string): {
  packages: Set<string>;
  files: number;
  skippedAsData: number;
} {
  const queue = trackedFilesUnder(directory, { match: /\.tsx?$/ }).map((path) =>
    join(directory, path),
  );
  const seen = new Set<string>();
  const reached = new Set<string>();
  let skippedAsData = 0;
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    // The second shape of names-as-data: a whole tree that IS a program, held as
    // template content. `packages/create-qcms-app/templates/` is stamped into an
    // adopter's repository verbatim, so its files carry real `import` statements and
    // real `@roonga/qcms-*` specifiers, and this package compiles and lints none of them: its
    // `tsconfig.json` includes `src`, `scripts` and `e2e`, its `lint` names the same
    // three, and `eslint.config.js` ignores the tree. `tsc --listFiles` over that
    // program contains zero files from it. Reading them as reads demanded six build
    // edges for dists nothing opens. Filtered on the way OUT of the queue rather than
    // on the way in, so a relative import that reaches into the tree is refused too.
    if (isGeneratedCopy(relative(REPOSITORY_ROOT, file).replaceAll("\\", "/"))) {
      skippedAsData += 1;
      continue;
    }
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined || !PLAUSIBLE_SPECIFIER.test(specifier)) continue;
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (target !== undefined) queue.push(target);
      } else if (specifier.startsWith("@roonga/qcms-") && !insideStringLiteral(text, match.index)) {
        reached.add(specifier.split("/").slice(0, 2).join("/"));
      }
    }
  }
  return { packages: reached, files: seen.size, skippedAsData };
}

/**
 * turbo's own task graph for `task`, as `taskId -> direct dependencies`.
 *
 * Asked of turbo rather than re-derived from `turbo.json`: `dependsOn` resolution
 * (`^build`, explicit `<pkg>#<task>`, the per-package overrides) is turbo's, and a
 * second implementation of it here would agree with the real one only by luck.
 */
function turboTaskGraph(task: string): Map<string, string[]> {
  const output = execFileSync("pnpm", ["exec", "turbo", "run", task, "--dry=json"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(output) as { tasks: { taskId: string; dependencies: string[] }[] };
  return new Map(parsed.tasks.map((entry) => [entry.taskId, entry.dependencies]));
}

/** Everything `taskId` waits for, transitively. */
function orderedBefore(graph: Map<string, string[]>, taskId: string): Set<string> {
  const closure = new Set<string>();
  const queue = [...(graph.get(taskId) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined || closure.has(next)) continue;
    closure.add(next);
    queue.push(...(graph.get(next) ?? []));
  }
  return closure;
}

describe("the two names-as-data rules, each proved to fire and each proved narrow", () => {
  // Both rules REMOVE demands, which is the direction this file calls dangerous: an
  // over-approximation fails loudly, an under-approximation is silent. So each is
  // pinned twice, once for the case it must refuse and once for the case it must not.

  it("reads an import at the head of its line as an import", () => {
    const text = 'import { db } from "@roonga/qcms-db";\n';
    expect(insideStringLiteral(text, text.indexOf("from"))).toBe(false);
  });

  it("reads a specifier inside a quoted fixture as data", () => {
    // The exact line in `scripts/sync-templates.test.ts` that demanded @roonga/qcms-db.
    const text = `tree.set("common/apps/portal/lib/rogue.ts", 'import { x } from "@roonga/qcms-db";');\n`;
    expect(insideStringLiteral(text, text.lastIndexOf("from"))).toBe(true);
  });

  it("does not blind itself to an import that merely follows a balanced string", () => {
    const text = 'const note = "see below";\nimport { db } from "@roonga/qcms-db";\n';
    expect(insideStringLiteral(text, text.indexOf("from", text.indexOf("import")))).toBe(false);
  });

  it("skips the generated template tree, and skips nothing else", () => {
    // Non-vacuous in both directions: the exclusion has to fire for the package it was
    // judged for, and fire for no other package at all.
    const reached = workspaceImportsReachedFrom(join(REPOSITORY_ROOT, "packages/create-qcms-app"));
    expect(reached.skippedAsData).toBeGreaterThan(0);
    expect(reached.files).toBeGreaterThan(0);
    for (const pkg of workspacePackages()) {
      if (pkg.name === "create-qcms-app") continue;
      expect(
        workspaceImportsReachedFrom(pkg.directory).skippedAsData,
        `${pkg.name} had files skipped as data, and only create-qcms-app stamps any`,
      ).toBe(0);
    }
  });

  it("rests on a tsconfig that genuinely excludes the tree", () => {
    // The whole justification for the second rule. If `templates` ever entered this
    // program, the files would be compiled and the demands would be real.
    const tsconfig = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, "packages/create-qcms-app/tsconfig.json"), "utf8"),
    ) as { include?: string[] };
    expect(tsconfig.include).toStrictEqual(["src", "scripts", "e2e"]);
  });

  it("still sees the packages a real program reaches, so the walk is not blind", () => {
    // The floor under both rules. If the walk stopped reaching anything, every
    // assertion in the suite below would pass while checking nothing.
    const admin = workspaceImportsReachedFrom(join(REPOSITORY_ROOT, "apps/admin"));
    expect(admin.packages.size).toBeGreaterThan(2);
    expect(admin.packages).toContain("@roonga/qcms-db");
  });
});

describe("turbo orders every dist a program-shaped task reads", () => {
  const packages = workspacePackages();
  const cleaned = packagesThatCleanTheirDist(packages);

  it("finds the packages whose build removes its own dist", () => {
    // The derivation's own floor. If this set went empty every assertion below would
    // pass while checking nothing, which is the fail-open shape the whole file is
    // about. `@roonga/qcms-db` is named because it is the package the reported failure was
    // about, so a rename that quietly drops it from the set is reported here.
    expect(cleaned.size).toBeGreaterThan(3);
    expect([...cleaned]).toContain("@roonga/qcms-db");
  });

  it.each(PROGRAM_SHAPED_TASKS)("builds every dist %s reads, before it reads it", (task) => {
    const graph = turboTaskGraph(task);
    expect(graph.size).toBeGreaterThan(0);

    const undeclared: string[] = [];
    let checked = 0;
    for (const pkg of packages) {
      if (pkg.scripts[task] === undefined) continue;
      const taskId = `${pkg.name}#${task}`;
      if (!graph.has(taskId)) continue;
      checked += 1;
      const reached = workspaceImportsReachedFrom(pkg.directory);
      // A walk that reaches nothing is a broken walk, not a clean package.
      expect(
        reached.files,
        `${relative(REPOSITORY_ROOT, pkg.directory)} reached no files`,
      ).toBeGreaterThan(0);
      const ordered = orderedBefore(graph, taskId);
      for (const dependency of reached.packages) {
        if (dependency === pkg.name || !cleaned.has(dependency)) continue;
        if (!ordered.has(`${dependency}#build`)) {
          undeclared.push(`${taskId} reads ${dependency} but does not wait for its build`);
        }
      }
    }

    expect(checked, `no ${task} task was checked`).toBeGreaterThan(0);
    expect(undeclared.sort()).toEqual([]);
  });
});
