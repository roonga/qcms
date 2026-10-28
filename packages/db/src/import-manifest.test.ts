/**
 * An undeclared import breaks only consumers: in-repo, the workspace symlink supplies
 * what the manifest does not declare.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly exports?: Record<string, { readonly default?: string }>;
  readonly bin?: Record<string, string>;
}

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("./", import.meta.url));

const manifest = JSON.parse(
  readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"),
) as Manifest;

/**
 * `require("x")` is not recognized, which is safe only while every walked source is plain
 * ESM; swap in a `ts.createSourceFile` walk if that stops holding.
 */
function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8")
    // Comments here quote import statements, which would count as real ones.
    .replaceAll(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, "")
    .replaceAll(/\/\/[^\n]*/g, "");
  // The optional paren is one group rather than two adjacent `\s*` runs, which backtrack
  // (sonarjs/super-linear-regex).
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*(?:\(\s*)?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function packageName(specifier: string): string {
  const scoped = specifier.startsWith("@");
  return specifier
    .split("/")
    .slice(0, scoped ? 2 : 1)
    .join("/");
}

/** An import writes the emitted extension (`./x.js`) while the tree holds `./x.ts`. */
function resolveOnDisk(specifier: string, importer: string): string | undefined {
  const target = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    target,
    target.replace(/\.([cm]?)js$/, ".$1ts"),
    `${target}.ts`,
    path.join(target, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

interface Walk {
  readonly files: ReadonlySet<string>;
  readonly packages: ReadonlySet<string>;
  readonly unresolved: readonly string[];
}

function walkFrom(entries: readonly string[]): Walk {
  const files = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];

  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of specifiers(file)) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        packages.add(packageName(specifier));
        continue;
      }
      const resolved = resolveOnDisk(specifier, file);
      if (resolved === undefined) {
        unresolved.push(`${path.relative(PACKAGE_DIR, file)} imports "${specifier}"`);
        continue;
      }
      visit(resolved);
    }
  };

  for (const entry of entries) visit(path.resolve(entry));
  return { files, packages, unresolved };
}

/** The dist-to-src translation is exact because the build is a flat `src` -> `dist` emit. */
function entryPointSources(): string[] {
  const entries = Object.entries(manifest.exports ?? {});
  const fromExports = entries.map(([subpath, condition]) => {
    const dist = condition.default;
    if (dist === undefined) throw new Error(`exports["${subpath}"] has no default condition`);
    const source = dist.replace(/^\.\/dist\//, "").replace(/\.js$/, ".ts");
    return path.join(SRC_DIR, source);
  });
  const fromBins = Object.values(manifest.bin ?? {}).map((dist) =>
    path.join(SRC_DIR, dist.replace(/^\.\/dist\//, "").replace(/\.js$/, ".ts")),
  );
  return [...fromExports, ...fromBins];
}

/**
 * `readdirSync` rather than `git ls-files`, because this package's lint forbids resolving
 * a command off `PATH` (`sonarjs/no-os-command-from-path`).
 */
function packageSources(dir = SRC_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...packageSources(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("@roonga/qcms-db's imports against its own manifest (issue #386)", () => {
  const walk = walkFrom(entryPointSources());

  it("declares every package any published entry point imports", () => {
    // devDependencies are not installed for a consumer; optional peers are, on request.
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);

    expect(walk.packages.size).toBeGreaterThan(0);
    expect([...walk.packages].filter((name) => !declared.has(name)).sort()).toEqual([]);
  });

  it("resolves every relative import it follows, so nothing is skipped in silence", () => {
    expect(walk.unresolved).toEqual([]);
  });

  it("reaches every non-test source under src/", () => {
    const unreached = packageSources()
      .filter((file) => !walk.files.has(file))
      .map((file) => path.relative(PACKAGE_DIR, file))
      .sort();
    expect(unreached).toEqual([]);
  });

  it("covers the entry points the manifest actually publishes", () => {
    const subpaths = Object.keys(manifest.exports ?? {}).sort();
    expect(subpaths).toEqual([".", "./environment", "./migrate", "./testing"]);
    expect(Object.keys(manifest.bin ?? {}).sort()).toEqual([
      "qcms-db-environment",
      "qcms-db-migrate",
    ]);
    for (const entry of entryPointSources()) {
      expect(existsSync(entry), `${entry} does not exist`).toBe(true);
    }
  });
});
