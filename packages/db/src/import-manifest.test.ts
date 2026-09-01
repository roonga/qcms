/**
 * Every package `@qcms/db` imports must be declared in its own manifest, from
 * EVERY published entry point (issue #386).
 *
 * Issue #156 was the instance: the `./testing` subpath imported
 * `@testcontainers/postgresql` and `testcontainers`, both declared only as
 * devDependencies, which are not installed for consumers. It was invisible
 * in-repo precisely because it only broke consumers - the workspace symlink
 * supplied what the manifest did not declare - and PR #385 closed it with a walk
 * that started at `src/testing/harness.ts` and stopped at that directory's edge.
 *
 * This closes the class. The walk starts at every entry point the manifest's own
 * `exports` map publishes (`.`, `./testing`, `./migrate`) and follows relative
 * imports transitively, so an undeclared bare import anywhere under `src/` fails
 * a test rather than only under `src/testing`. Lower severity than #156 on the
 * main entry point - an undeclared import there breaks `pnpm build` for the
 * workspace, so it fails loudly and in-repo - but the property is the same one
 * and it is now checked in one place for all three entry points.
 *
 * Two properties keep the walk honest, both learned from #156's first draft,
 * which passed vacuously because it walked no files at all:
 *
 * 1. The entry points come from the manifest, not from a list here, so a fourth
 *    export cannot be published without being walked.
 * 2. The reachability test asserts the walk covers EVERY non-test source file
 *    under `src/`. A walk that quietly stops covering a file reports green
 *    otherwise, and that is exactly how a walk that covers zero files looks.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly exports?: Record<string, { readonly default?: string }>;
}

/** The package root (`packages/db/`) and its `src/`, as filesystem paths. */
const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("./", import.meta.url));

const manifest = JSON.parse(
  readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"),
) as Manifest;

/**
 * Every module specifier in `file`: `from "x"`, the side-effect `import "x"`, and
 * `import("x")`.
 *
 * Deliberately a regex rather than an AST walk, and these are its limits, written
 * down because an unstated limitation is how this file's own defect class starts:
 *
 * - `require("x")` and `import x = require("y")` are not recognized. That is safe
 *   only because `@qcms/db` is `"type": "module"` and neither form appears in the
 *   walked sources; a CommonJS source added under `src/` would slip past.
 * - Comment stripping is textual, so a `//` inside a string literal would truncate
 *   the rest of that line. No string in the walked files contains one, and the
 *   formatter gives every import its own line ahead of other statements, so no
 *   specifier can sit behind one.
 * - A string literal containing `from "x"` would be read as a real import. That
 *   direction fails loud (an undeclared package in the report) rather than
 *   silently, so it costs a reader a minute, not a missed regression.
 *
 * The trade is deliberate: a guard test earns its keep by being obviously correct
 * at a glance. If a walked source ever stops being plain ESM, swap this for a
 * `ts.createSourceFile` walk - `typescript` is already a workspace devDependency,
 * so that costs no new dependency, only the complexity this comment buys out.
 */
function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8")
    // Comments quote import statements (this package's own docs do), so strip
    // them first or a doc example counts as a real import.
    .replaceAll(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, "")
    .replaceAll(/\/\/[^\n]*/g, "");
  // The specifier is the only capture group. `import.meta.url` does not match:
  // a quote has to follow the keyword. The optional paren is one group rather
  // than two adjacent `\s*` runs, which backtrack (sonarjs/super-linear-regex).
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*(?:\(\s*)?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

/** A bare specifier reduced to the package name a manifest would declare. */
function packageName(specifier: string): string {
  // `drizzle-orm/node-postgres` is declared as `drizzle-orm`.
  const scoped = specifier.startsWith("@");
  return specifier
    .split("/")
    .slice(0, scoped ? 2 : 1)
    .join("/");
}

/**
 * The file a relative specifier names on disk, or `undefined` if none matches.
 *
 * These sources are TypeScript emitting ESM, so an import writes the **emitted**
 * extension (`./x.js`) while the tree holds `./x.ts`. Nothing here assumes an
 * extension: it tries the candidates in resolution order and takes the first that
 * is a real file, so a directory specifier is never mistaken for a module.
 */
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

/** What one transitive walk found: the files it read and the problems it hit. */
interface Walk {
  /** Every source file reached, entry points included. */
  readonly files: ReadonlySet<string>;
  /** Package names imported anywhere in that reachable set, `node:` excluded. */
  readonly packages: ReadonlySet<string>;
  /** Relative specifiers that resolve to nothing on disk, reported not ignored. */
  readonly unresolved: readonly string[];
}

/** Walk `entries` and everything they reach through relative imports. */
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

/**
 * The source file behind each published export, derived from the manifest.
 *
 * Read from `exports` rather than listed here so a fourth entry point cannot be
 * published without this walk covering it. The map points at built output
 * (`./dist/testing/harness.js`), which is the artefact a consumer loads; the walk
 * needs the source that produced it, and this package's build is a flat
 * `src` -> `dist` emit, so the path translation is exact rather than a guess.
 */
function entryPointSources(): string[] {
  const entries = Object.entries(manifest.exports ?? {});
  return entries.map(([subpath, condition]) => {
    const dist = condition.default;
    if (dist === undefined) throw new Error(`exports["${subpath}"] has no default condition`);
    const source = dist.replace(/^\.\/dist\//, "").replace(/\.js$/, ".ts");
    return path.join(SRC_DIR, source);
  });
}

/**
 * Every non-test TypeScript source under `src/`.
 *
 * A `readdirSync` walk rather than `git ls-files`, following the same trade
 * `packages/observability/src/otlp-log-allowlist.coverage.test.ts` documents: this
 * package's lint forbids resolving a command off `PATH`
 * (`sonarjs/no-os-command-from-path`), and an `eslint-disable` to spawn Git for a
 * list one recursive read produces is the wrong trade. The usual objection to a
 * walk is that it also reads build output an earlier gate left behind (issue
 * #629), and confining it to `src` is what answers it: `dist` is a SIBLING of
 * `src`, never inside it. The cost is that an untracked scratch file under `src`
 * is counted as if it shipped, which fails loudly and in the safe direction.
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

describe("@qcms/db's imports against its own manifest (issue #386)", () => {
  const walk = walkFrom(entryPointSources());

  it("declares every package any published entry point imports", () => {
    // devDependencies are deliberately NOT accepted: they are not installed for a
    // consumer, which is the whole of issue #156. Optional peers count, because
    // an adopter is told to install them and gets an actionable message if they
    // have not (see `src/testing/harness-deps.test.ts`).
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);

    // A walk that found nothing would satisfy the assertion below without
    // checking anything - the failure mode #156's first draft nearly shipped.
    expect(walk.packages.size).toBeGreaterThan(0);
    expect([...walk.packages].filter((name) => !declared.has(name)).sort()).toEqual([]);
  });

  it("resolves every relative import it follows, so nothing is skipped in silence", () => {
    expect(walk.unresolved).toEqual([]);
  });

  it("reaches every non-test source under src/", () => {
    // The completeness assertion. Without it the walk is only as good as its
    // reach: a source that stops being imported (or one the resolver quietly
    // fails to find) leaves its own imports unchecked, and the suite stays green.
    //
    // A file failing here is one of two things, and both want a human. Either it
    // is unreachable from every published entry point, which makes it dead code
    // rather than something this test should learn to skip, or the walk broke.
    const unreached = packageSources()
      .filter((file) => !walk.files.has(file))
      .map((file) => path.relative(PACKAGE_DIR, file))
      .sort();
    expect(unreached).toEqual([]);
  });

  it("covers the entry points the manifest actually publishes", () => {
    // `exports` is the input to the walk, so a typo that silently produced an
    // empty entry list would make everything above vacuous.
    const subpaths = Object.keys(manifest.exports ?? {}).sort();
    expect(subpaths).toEqual([".", "./migrate", "./testing"]);
    for (const entry of entryPointSources()) {
      expect(existsSync(entry), `${entry} does not exist`).toBe(true);
    }
  });
});
