import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exit criterion 3 (R2 audit): the strict BFF stays a proxy. The portal imports
 * NOTHING from @qcms/core except types (rule evaluation lives server-side in the
 * API), and no client component pulls a server-only BFF module (config, api,
 * cookies) into the client bundle as a value - the session token and internal
 * API base URL never reach the browser.
 */

const PORTAL_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];
const EXTRA_FILES = ["middleware.ts"];

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

  it("imports nothing from @qcms/core except types (evaluation stays in the API)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec, isType } of importsOf(text)) {
        if (spec.startsWith("@qcms/core") && !isType) offenders.push(path);
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
});
