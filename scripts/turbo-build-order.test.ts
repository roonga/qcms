import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "./docker.mjs";
import { isGeneratedCopy } from "./generated-copy.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";

/** turbo tasks that build a tsc program and therefore read built declarations. */
const PROGRAM_SHAPED_TASKS = ["build", "typecheck", "lint"] as const;

/** A module specifier, as opposed to a fragment of prose a loose regex matched. */
const PLAUSIBLE_SPECIFIER = /^[^\s'"`;(){}]+$/;

/**
 * Not a parser, so the reached set over-approximates. That direction is deliberate: a
 * surplus demand fails loudly naming the edge, while a missed one is silent.
 */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']|\brequire\(\s*["']([^"'\n]+)["']\s*\)/g;

/**
 * A specifier quoted inside another file's fixture text is data tsc never resolves.
 * Quotes are counted rather than parsed, which errs safely: a real `import` sits at
 * the head of its line with no quotes before it.
 */
function insideStringLiteral(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const before = text.slice(lineStart, index);
  return ["'", '"', "`"].some(
    (quote) => before.split(quote).length - 1 > 0 && (before.split(quote).length - 1) % 2 === 1,
  );
}

const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];

interface WorkspacePackage {
  readonly name: string;
  readonly directory: string;
  readonly scripts: Readonly<Record<string, string>>;
}

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

/** Removing `dist` first is what turns an undeclared read into a failure rather than a stale success. */
function packagesThatCleanTheirDist(packages: readonly WorkspacePackage[]): Set<string> {
  return new Set(
    packages.filter((pkg) => (pkg.scripts.build ?? "").includes("clean-dist")).map((p) => p.name),
  );
}

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
    // The template tree holds real import statements but is compiled and linted by
    // nothing, so its specifiers are data. Filtered on the way out so a relative import
    // reaching into the tree is refused too.
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
 * Asked of turbo rather than re-derived from `turbo.json`: a second implementation of
 * `dependsOn` resolution would agree with the real one only by luck.
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
  it("reads an import at the head of its line as an import", () => {
    const text = 'import { db } from "@roonga/qcms-db";\n';
    expect(insideStringLiteral(text, text.indexOf("from"))).toBe(false);
  });

  it("reads a specifier inside a quoted fixture as data", () => {
    const text = `tree.set("common/apps/portal/lib/rogue.ts", 'import { x } from "@roonga/qcms-db";');\n`;
    expect(insideStringLiteral(text, text.lastIndexOf("from"))).toBe(true);
  });

  it("does not blind itself to an import that merely follows a balanced string", () => {
    const text = 'const note = "see below";\nimport { db } from "@roonga/qcms-db";\n';
    expect(insideStringLiteral(text, text.indexOf("from", text.indexOf("import")))).toBe(false);
  });

  it("skips the generated template tree, and skips nothing else", () => {
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
    const tsconfig = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, "packages/create-qcms-app/tsconfig.json"), "utf8"),
    ) as { include?: string[] };
    expect(tsconfig.include).toStrictEqual(["src", "scripts", "e2e"]);
  });

  it("still sees the packages a real program reaches, so the walk is not blind", () => {
    // Vacuity floor: with the walk reaching nothing, every assertion below passes.
    const admin = workspaceImportsReachedFrom(join(REPOSITORY_ROOT, "apps/admin"));
    expect(admin.packages.size).toBeGreaterThan(2);
    expect(admin.packages).toContain("@roonga/qcms-db");
  });
});

describe("turbo orders every dist a program-shaped task reads", () => {
  const packages = workspacePackages();
  const cleaned = packagesThatCleanTheirDist(packages);

  it("finds the packages whose build removes its own dist", () => {
    // Vacuity floor: an empty set passes every assertion below.
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
