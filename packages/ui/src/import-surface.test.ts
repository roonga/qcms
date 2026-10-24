import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

// The exhaustive allow-list for ADR-22; the eslint rule is the fast fence. Test files
// are exempt.
const ALLOWED = new Set([
  "@a2ra/core",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-aria-components",
  "@internationalized/date",
  "zod",
]);

// Vitest may run from the repo root or the package dir.
function findUiSrc(): string {
  const marker = "A2UIStepRenderer.tsx";
  const direct = join(process.cwd(), "src");
  if (existsSync(join(direct, marker))) return direct;
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, "packages", "ui", "src");
    if (existsSync(join(candidate, marker))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate packages/ui/src from cwd");
}

const SRC_ROOT = findUiSrc();

function shippedSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test-support" || entry.name === "__snapshots__") continue;
      files.push(...shippedSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    files.push(full);
  }
  return files;
}

const IMPORT_RE = /\b(?:import|export)\b[^"'`]*?\bfrom\s*["']([^"']+)["']/g;
// The `(?<!@)` is load-bearing: a CSS `@import` inside a string literal is not a
// JavaScript import, and without the lookbehind it is reported as a forbidden
// dependency.
const SIDE_EFFECT_RE = /(?<!@)\bimport\s*["']([^"']+)["']/g;

function bareSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const spec = match[1];
      if (!spec.startsWith(".")) specs.add(spec);
    }
  }
  return [...specs];
}

describe("@roonga/qcms-ui import surface (ADR-22)", () => {
  const files = shippedSourceFiles(SRC_ROOT);

  it("scans the whole shipped tree (qcms code + vendored components)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("imports only the a2-react-aria stack - no other component library", () => {
    const offenders: Array<{ file: string; spec: string }> = [];
    for (const file of files) {
      for (const spec of bareSpecifiers(readFileSync(file, "utf8"))) {
        if (!ALLOWED.has(spec)) {
          offenders.push({ file: file.slice(SRC_ROOT.length + 1), spec });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
