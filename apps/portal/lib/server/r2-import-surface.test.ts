import { readFileSync, readdirSync, statSync } from "node:fs";
import { declaresUseServer } from "../../../../scripts/use-server-directive.mjs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * R2's import surface: the portal imports nothing from `@roonga/qcms-core` except types,
 * and no client component pulls a server-only BFF module into the client bundle as a
 * value, so the session token and the internal API base URL never reach the browser.
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

interface ParsedImport {
  readonly spec: string;
  readonly isType: boolean;
}

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

  it("the no-JS whole-step route imports nothing from @roonga/qcms-core (R2)", () => {
    const stepRoute = files.find((f) => f.path.endsWith("/step/route.ts"));
    expect(stepRoute, "the whole-step BFF route should be scanned").toBeDefined();
    const coreImports = importsOf(stepRoute!.text).filter((i) =>
      i.spec.startsWith("@roonga/qcms-core"),
    );
    expect(coreImports).toEqual([]);
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
   * A graph rule rather than an R2 one, here because this is the file that already
   * reasons about which module may see which: a Server Action runs in the React Server
   * Component graph, and a value import from the `@roonga/qcms-ui` barrel pulls the
   * renderer's hooks into a server module, which Next refuses outright and which takes
   * the whole portal's boot with it.
   *
   * The React-free subpaths are what a server module reads, and a bare `import type` is
   * erased and harmless.
   */
  it("keeps a Server Action out of the @roonga/qcms-ui component graph (task 073)", () => {
    const REACT_FREE_SUBPATHS = new Set([
      "@roonga/qcms-ui/native-submit",
      "@roonga/qcms-ui/repeat-node",
    ]);
    const byPath = new Map(files.map((file) => [file.path, file.text]));
    /** `undefined` for a package specifier. */
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

  it("the step-form decoder is transport-only (no @roonga/qcms-core)", () => {
    const decoder = files.find((f) => f.path.endsWith("/server/step-form.ts"));
    expect(decoder, "the step-form decoder should be scanned").toBeDefined();
    const coreImports = importsOf(decoder!.text).filter((i) =>
      i.spec.startsWith("@roonga/qcms-core"),
    );
    expect(coreImports).toEqual([]);
  });
});
