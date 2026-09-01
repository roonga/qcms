/**
 * The published `@qcms/db/testing` subpath must be installable.
 *
 * Issue #156: the harness imported `@testcontainers/postgresql` and
 * `testcontainers`, both declared only as **devDependencies**. devDependencies
 * are not installed for consumers, so an adopter who installed `@qcms/db` and
 * imported the documented entry point got a bare `Cannot find package` naming
 * one of them, with no indication of what to install or why.
 *
 * These tests close the class rather than the instance: the first walks every
 * runtime import the subpath actually makes and requires the manifest to declare
 * it, so a future import added to the harness cannot silently reintroduce the
 * defect; the second keeps that walk honest by failing when the subpath grows a
 * source file the walk does not visit; the third pins the adopter-facing error
 * text.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as Manifest;

/** The directory holding this test and the sources of the `./testing` export. */
const TESTING_DIR = new URL("./", import.meta.url);

/**
 * Every source file **under `src/testing`** that the `./testing` export pulls in:
 * `harness.ts`, the file the export points at, plus what it imports from this
 * directory. Modules the harness reaches outside this directory (today
 * `../schema`) belong to the package's main entry point and are deliberately not
 * walked here. The completeness test below fails when a file under this directory
 * is imported but missing from this list.
 */
const SUBPATH_SOURCES = ["./harness.ts", "./docker-auth-config.ts"] as const;

/**
 * Every module specifier in `module`: `from "x"`, the side-effect `import "x"`,
 * and `import("x")`.
 *
 * Deliberately a regex rather than an AST walk, and these are its limits, written
 * down because an unstated limitation is how this file's own defect class starts:
 *
 * - `require("x")` and `import x = require("y")` are not recognized. That is safe
 *   only because `@qcms/db` is `"type": "module"` and neither form appears in the
 *   walked sources; a CommonJS source added under `src/testing` would slip past.
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
function specifiers(module: URL): string[] {
  const text = readFileSync(fileURLToPath(module), "utf8")
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

/** Bare package specifiers imported by `module`, `node:` builtins excluded. */
function bareSpecifiers(module: URL): string[] {
  const found = new Set<string>();
  for (const specifier of specifiers(module)) {
    if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
    // `drizzle-orm/node-postgres` is declared as `drizzle-orm`.
    const scoped = specifier.startsWith("@");
    found.add(
      specifier
        .split("/")
        .slice(0, scoped ? 2 : 1)
        .join("/"),
    );
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** True when `candidate` is a file on disk (a directory is not a module). */
function isFile(candidate: URL): boolean {
  const path = fileURLToPath(candidate);
  return existsSync(path) && statSync(path).isFile();
}

/**
 * The file a relative specifier names on disk, or `undefined` if none matches.
 *
 * These sources are TypeScript emitting ESM, so an import writes the **emitted**
 * extension (`./x.js`) while the tree holds `./x.ts`. Nothing here assumes an
 * extension: it tries the candidates in resolution order and takes the first
 * that is a real file.
 */
function resolveOnDisk(specifier: string, importer: URL): URL | undefined {
  const target = new URL(specifier, importer);
  const candidates = [
    target,
    new URL(target.href.replace(/\.([cm]?)js$/, ".$1ts")),
    new URL(`${target.href}.ts`),
    new URL("index.ts", `${target.href}/`),
  ];
  return candidates.find((candidate) => isFile(candidate));
}

/** Files under `src/testing` that `source` imports and `SUBPATH_SOURCES` does not list. */
function unlistedImports(source: string, listed: ReadonlySet<string>): string[] {
  const importer = new URL(source, TESTING_DIR);
  const problems: string[] = [];

  for (const specifier of specifiers(importer).filter((found) => found.startsWith("."))) {
    const resolved = resolveOnDisk(specifier, importer);
    if (resolved === undefined) {
      problems.push(`${source} imports "${specifier}", which resolves to no file on disk`);
      continue;
    }
    // Resolved outside src/testing (today `../schema`): the main entry point's
    // territory, covered by the package's own dependency declarations.
    if (!resolved.href.startsWith(TESTING_DIR.href)) continue;
    if (listed.has(resolved.href)) continue;

    const entry = `./${resolved.href.slice(TESTING_DIR.href.length)}`;
    problems.push(
      `${source} imports "${specifier}", which is the unlisted src/testing source ${entry}:` +
        ` add "${entry}" to SUBPATH_SOURCES so its own imports are walked too`,
    );
  }

  return problems;
}

describe("the published @qcms/db/testing subpath", () => {
  it("declares every package it imports as a dependency or a peer dependency", () => {
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    const imported = SUBPATH_SOURCES.flatMap((source) =>
      bareSpecifiers(new URL(source, TESTING_DIR)),
    );

    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter((specifier) => !declared.has(specifier))).toEqual([]);
  });

  // Without this, the walk above is only as good as a hand-maintained list: a
  // new `./helper.js` imported by the harness, importing an undeclared package,
  // would never be read and the check above would pass.
  it("walks every source file the subpath reaches under src/testing", () => {
    const listed = new Set(
      SUBPATH_SOURCES.map((source) => resolveOnDisk(source, TESTING_DIR)?.href).filter(
        (href): href is string => href !== undefined,
      ),
    );
    expect(listed.size, "SUBPATH_SOURCES names a file that is not on disk").toBe(
      SUBPATH_SOURCES.length,
    );

    expect(SUBPATH_SOURCES.flatMap((source) => unlistedImports(source, listed))).toEqual([]);
  });

  it("keeps the Testcontainers packages optional, so runtime consumers do not install a Docker client", () => {
    for (const name of ["@testcontainers/postgresql", "testcontainers"]) {
      expect(manifest.peerDependencies?.[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
      // Still a devDependency, so this workspace's own suites keep them installed.
      expect(manifest.devDependencies?.[name]).toBeDefined();
    }
  });

  /**
   * Resolution and typecheck, the two halves of what "published" has to mean here
   * (issues #382 and #407).
   *
   * The subpath used to point at raw TypeScript. Vitest transformed it, so every
   * in-repo importer was happy and nothing said the entry point was Vitest-only: plain
   * `node` refused it with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (#382), and a
   * TypeScript adopter without the optional peers got six `TS2307`s out of the source
   * file, which is a wall in front of the actionable runtime message #156 wrote (#407).
   *
   * Both were one defect: the export condition. It now points at compiled output like
   * the main entry, so the runtime gets JavaScript and the typechecker gets a `.d.ts`.
   * These read the manifest and the emitted declarations rather than trusting either.
   */
  describe("resolves to built output, not to source", () => {
    const dist = new URL("../../dist/testing/", import.meta.url);

    const exportsMap = (
      manifest as unknown as {
        readonly exports?: Record<string, Record<string, string>>;
      }
    ).exports;

    it("points ./testing at dist, so any runner can load it", () => {
      const testing = exportsMap?.["./testing"];
      expect(testing?.types).toBe("./dist/testing/harness.d.ts");
      expect(testing?.default).toBe("./dist/testing/harness.js");
    });

    it("emits both files, so the export condition is not a promise about nothing", () => {
      // `test` depends on `build` in turbo.json, so this is a real precondition rather
      // than an ordering hope. A missing file here means the subpath was excluded from
      // the build again, which is exactly how #382 happened.
      for (const file of ["harness.js", "harness.d.ts", "docker-auth-config.js"]) {
        expect(existsSync(new URL(file, dist)), `dist/testing/${file} is missing`).toBe(true);
      }
    });

    it("keeps the optional peers out of the emitted declarations", () => {
      // The #407 regression net, and the reason `TestDb.container` is typed structurally
      // (see StartedTestPostgres in harness.ts). If either peer reappears in an import
      // position here, an adopter who has not installed them cannot run `tsc` at all,
      // and `skipLibCheck: true` would hide that from most of them while leaving it for
      // anyone strict - the outcome #407 calls the worse of the two, because it looks
      // resolved. Import positions only: the prose in the file's own comments names both
      // packages on purpose.
      const declarations = readFileSync(new URL("harness.d.ts", dist), "utf8");
      const specifiers = [...declarations.matchAll(/(?:from|import\()\s*["']([^"']+)["']/gu)].map(
        (match) => match[1],
      );
      expect(specifiers.length).toBeGreaterThan(0);
      expect(
        specifiers.filter((specifier) => specifier?.includes("testcontainers")),
        "an optional peer reached the exported declaration surface",
      ).toEqual([]);
    });
  });

  // The two wordings an absent peer actually produces: Node's own, and Vite's,
  // which is what a Vitest-based consumer sees. Both were observed against a
  // packed tarball installed outside this workspace (issue #156).
  const resolutionFailures = [
    {
      runner: "node",
      error: Object.assign(
        new Error("Cannot find package '@testcontainers/postgresql' imported from harness.ts"),
        { code: "ERR_MODULE_NOT_FOUND" },
      ),
    },
    {
      runner: "vitest/vite",
      error: new Error('Could not resolve "@testcontainers/postgresql" imported by "@qcms/db".'),
    },
  ] as const;

  it.each(resolutionFailures)(
    "names both packages and the install command when the optional peers are absent ($runner)",
    async ({ error }) => {
      vi.resetModules();
      // Raised where the harness touches the module, so the real catch/rewrite
      // path runs rather than a simulated one.
      vi.doMock("@testcontainers/postgresql", () => ({
        get PostgreSqlContainer(): never {
          throw error;
        },
      }));

      try {
        const { startTestDb } = await import("./harness.js");
        // Rejects before any Docker call, so this test boots no container.
        const failure = await startTestDb().then(
          () => undefined,
          (thrown: unknown) => thrown,
        );

        expect(failure).toBeInstanceOf(Error);
        const message = (failure as Error).message;
        expect(message).toContain("OPTIONAL PEER dependencies");
        expect(message).toContain("@testcontainers/postgresql");
        expect(message).toContain("testcontainers");
        expect(message).toContain("pnpm add -D @testcontainers/postgresql testcontainers");
      } finally {
        vi.doUnmock("@testcontainers/postgresql");
        vi.resetModules();
      }
    },
  );

  it("rethrows a genuine fault inside Testcontainers rather than blaming the install", async () => {
    vi.resetModules();
    vi.doMock("@testcontainers/postgresql", () => ({
      get PostgreSqlContainer(): never {
        throw new Error("boom from inside testcontainers");
      },
    }));

    try {
      const { startTestDb } = await import("./harness.js");
      await expect(startTestDb()).rejects.toThrow("boom from inside testcontainers");
    } finally {
      vi.doUnmock("@testcontainers/postgresql");
      vi.resetModules();
    }
  });
});
