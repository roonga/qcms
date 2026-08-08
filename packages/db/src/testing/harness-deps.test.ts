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
 * defect; the second pins the adopter-facing error text.
 */
import { readFileSync } from "node:fs";
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

/** Every file the `./testing` export pulls in that is not itself under `src/testing`. */
const SUBPATH_SOURCES = ["./harness.ts", "./docker-auth-config.ts"] as const;

/** Bare package specifiers imported by `source`, static and dynamic, `node:` builtins excluded. */
function bareSpecifiers(source: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(source, import.meta.url)), "utf8")
    // Comments quote import statements (this package's own docs do), so strip
    // them first or a doc example counts as a real import.
    .replaceAll(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, "")
    .replaceAll(/\/\/[^\n]*/g, "");
  const found = new Set<string>();
  // Both `from "x"` and `import("x")`; the specifier is the only capture group.
  for (const match of text.matchAll(/(?:\bfrom|\bimport\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
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

describe("the published @qcms/db/testing subpath", () => {
  it("declares every package it imports as a dependency or a peer dependency", () => {
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    const imported = SUBPATH_SOURCES.flatMap((source) => bareSpecifiers(source));

    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter((specifier) => !declared.has(specifier))).toEqual([]);
  });

  it("keeps the Testcontainers packages optional, so runtime consumers do not install a Docker client", () => {
    for (const name of ["@testcontainers/postgresql", "testcontainers"]) {
      expect(manifest.peerDependencies?.[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
      // Still a devDependency, so this workspace's own suites keep them installed.
      expect(manifest.devDependencies?.[name]).toBeDefined();
    }
  });

  it("names both packages and the install command when the optional peers are absent", async () => {
    vi.resetModules();
    // Stands in for the resolution failure an adopter without the optional peer
    // hits: the same `Cannot find package` error, raised where the harness
    // touches the module, so the real catch/rewrite path runs.
    vi.doMock("@testcontainers/postgresql", () => ({
      get PostgreSqlContainer(): never {
        throw Object.assign(
          new Error("Cannot find package '@testcontainers/postgresql' imported from harness.ts"),
          { code: "ERR_MODULE_NOT_FOUND" },
        );
      },
    }));

    try {
      const { startTestDb } = await import("./harness.js");
      // Rejects before any Docker call, so this test boots no container.
      const failure = await startTestDb().then(
        () => undefined,
        (error: unknown) => error,
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
  });
});
