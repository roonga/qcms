import { readFileSync, readdirSync, statSync } from "node:fs";
import { declaresUseServer } from "../../../../scripts/use-server-directive.mjs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exit criterion 3 (R2 audit): the strict BFF stays a proxy. The portal imports
 * NOTHING from @roonga/qcms-core except types (rule evaluation lives server-side in the
 * API), and no client component pulls a server-only BFF module (config, api,
 * cookies) into the client bundle as a value - the session token and internal
 * API base URL never reach the browser.
 */

const PORTAL_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];
const EXTRA_FILES = ["proxy.ts", "instrumentation.ts"];

function isSource(entry: string): boolean {
  const isTs = entry.endsWith(".ts") || entry.endsWith(".tsx");
  const isTest = entry.endsWith(".test.ts") || entry.endsWith(".test.tsx");
  return isTs && !isTest;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (isSource(entry)) out.push(full);
  }
  return out;
}

function sourceFiles(): { path: string; text: string }[] {
  const files: string[] = [...EXTRA_FILES.map((f) => `${PORTAL_ROOT}${f}`)];
  for (const dir of SCAN_DIRS) files.push(...walk(`${PORTAL_ROOT}${dir}`));
  return files.map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/** A single import statement's specifier and whether it is a type-only import. */
interface ParsedImport {
  readonly spec: string;
  readonly isType: boolean;
}

// Linear extraction: pull the quoted specifier per import line and flag `import
// type`. Avoids a backtracking mega-regex (the specifier group has no nested
// quantifier).
const SPEC_RE = /from\s+["']([^"']+)["']/;

function importsOf(text: string): ParsedImport[] {
  const parsed: ParsedImport[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("import ")) continue;
    const match = SPEC_RE.exec(trimmed);
    if (match?.[1] === undefined) continue;
    parsed.push({ spec: match[1], isType: trimmed.startsWith("import type ") });
  }
  return parsed;
}

function isClientModule(text: string): boolean {
  const first = text.split("\n", 1)[0]?.trim() ?? "";
  return first === '"use client";' || first === "'use client';";
}

describe("R2 import surface (strict BFF)", () => {
  const files = sourceFiles();

  it("scans a non-trivial set of portal source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("imports nothing from @roonga/qcms-core except types (evaluation stays in the API)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec, isType } of importsOf(text)) {
        if (spec.startsWith("@roonga/qcms-core") && !isType) offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps server-only BFF modules out of client components (value imports)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      if (!isClientModule(text)) continue;
      for (const { spec, isType } of importsOf(text)) {
        if (spec.includes("lib/server/") && !isType) offenders.push(`${path} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The task 044 whole-step form-encoded BFF route is a proxy only: it maps form
  // fields to canonical answers and forwards them to the API, which stays the sole
  // validation + rule authority. It must import NOTHING from @roonga/qcms-core (not even
  // types) and must not re-implement any evaluation.
  it("the no-JS whole-step route imports nothing from @roonga/qcms-core (R2)", () => {
    const stepRoute = files.find((f) => f.path.endsWith("/step/route.ts"));
    expect(stepRoute, "the whole-step BFF route should be scanned").toBeDefined();
    const coreImports = importsOf(stepRoute!.text).filter((i) =>
      i.spec.startsWith("@roonga/qcms-core"),
    );
    expect(coreImports).toEqual([]);
    // Its only @roonga/qcms-ui *value* reach is a React-free transport-constants
    // subpath (a bare `@roonga/qcms-ui` type import is erased and harmless). There are
    // two of them now: `native-submit` for the `__qk__` and `__qa__` field markers, and
    // `repeat-node` for the instance-name separator and the `__qop` vocabulary (task
    // 073). Both are plain-data modules with no React import anywhere in their graph,
    // which is the property this assertion is about rather than the count.
    const REACT_FREE_SUBPATHS = new Set([
      "@roonga/qcms-ui/native-submit",
      "@roonga/qcms-ui/repeat-node",
    ]);
    for (const { spec, isType } of importsOf(stepRoute!.text)) {
      if (!isType && spec.startsWith("@roonga/qcms-ui")) {
        expect(REACT_FREE_SUBPATHS.has(spec), spec).toBe(true);
      }
    }
  });

  /**
   * A `"use server"` module must not reach the `@roonga/qcms-ui` BARREL for a value
   * (task 073).
   *
   * Not an R2 rule but a graph rule, and it is here because this is the file that
   * already reasons about which module may see which. A Server Action runs in the React
   * Server Component graph, and the barrel re-exports the renderer: a value import from
   * it pulls `createContext`, `useState` and `useSyncExternalStore` into a server
   * module, which Next refuses outright with "You're importing a module that depends on
   * `useState` into a React Server Component module". The whole portal then fails to
   * boot, which is how this was found - every spec in the suite red at once, with the
   * real cause four lines into a dev-server log.
   *
   * The React-free subpaths (`./native-submit`, `./repeat-node`) are what a server
   * module reads, and a bare `import type` is erased and harmless.
   */
  it("keeps a Server Action out of the @roonga/qcms-ui component graph (task 073)", () => {
    const REACT_FREE_SUBPATHS = new Set([
      "@roonga/qcms-ui/native-submit",
      "@roonga/qcms-ui/repeat-node",
    ]);
    const byPath = new Map(files.map((file) => [file.path, file.text]));
    /** Resolve a local specifier to a scanned file, or `undefined` for a package. */
    const resolve = (from: string, spec: string): string | undefined => {
      let base: string;
      if (spec.startsWith("@/")) base = `${PORTAL_ROOT}${spec.slice(2)}`;
      else if (spec.startsWith(".")) base = new URL(spec, `file://${from}`).pathname;
      else return undefined;
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (byPath.has(candidate)) return candidate;
      }
      return undefined;
    };
    // **The walk is the point.** The import that broke the build was not in the action
    // at all: it was two hops away, in a helper the action imports, and a check of the
    // action's own imports would have been green over it. So this follows every local
    // hop out of each `"use server"` module and holds the whole reachable set to the
    // rule, which is what "in the server graph" actually means.
    /** Every component-graph import reachable from one `"use server"` module. */
    const offendersFrom = (entry: string): string[] => {
      const found: string[] = [];
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length > 0) {
        const current = queue.pop() as string;
        for (const { spec, isType } of importsOf(byPath.get(current) ?? "")) {
          if (isType) continue;
          if (spec.startsWith("@roonga/qcms-ui") && !REACT_FREE_SUBPATHS.has(spec)) {
            found.push(`${entry} -> ${current} -> ${spec}`);
            continue;
          }
          const next = resolve(current, spec);
          if (next === undefined || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return found;
    };
    const offenders = files
      .filter(({ text }) => declaresUseServer(text))
      .flatMap(({ path }) => offendersFrom(path));
    expect(offenders).toEqual([]);
  });

  // The pure transport decoder must not reach into @roonga/qcms-core either - its kind
  // hints come from @roonga/qcms-ui's React-free subpath, and coercion is not validation.
  it("the step-form decoder is transport-only (no @roonga/qcms-core)", () => {
    const decoder = files.find((f) => f.path.endsWith("/server/step-form.ts"));
    expect(decoder, "the step-form decoder should be scanned").toBeDefined();
    const coreImports = importsOf(decoder!.text).filter((i) =>
      i.spec.startsWith("@roonga/qcms-core"),
    );
    expect(coreImports).toEqual([]);
  });
});
