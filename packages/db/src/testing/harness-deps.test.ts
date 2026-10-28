/** No Docker is needed: every case reads the manifest or mocks the optional peer. */
import { existsSync, readFileSync } from "node:fs";
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

describe("the published @roonga/qcms-db/testing subpath", () => {
  it("keeps the Testcontainers packages optional, so runtime consumers do not install a Docker client", () => {
    for (const name of ["@testcontainers/postgresql", "testcontainers"]) {
      expect(manifest.peerDependencies?.[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
      // Still a devDependency, so this workspace's own suites keep them installed.
      expect(manifest.devDependencies?.[name]).toBeDefined();
    }
  });

  // A subpath pointing at raw TypeScript works under Vitest and fails for every
  // other consumer.
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
      // `test` depends on `build` in turbo.json, so this is a real precondition.
      for (const file of ["harness.js", "harness.d.ts", "docker-auth-config.js"]) {
        expect(existsSync(new URL(file, dist)), `dist/testing/${file} is missing`).toBe(true);
      }
    });

    it("keeps the optional peers out of the emitted declarations", () => {
      // Import positions only: the prose in these files names both packages.
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
      error: new Error(
        'Could not resolve "@testcontainers/postgresql" imported by "@roonga/qcms-db".',
      ),
    },
  ] as const;

  /**
   * Each case below imports the harness cold, which costs one transform of pg,
   * drizzle and the schema, and on a busy machine that outruns Vitest's 5 s default.
   */
  const MODULE_MOCK_TIMEOUT_MS = 30_000;

  it.each(resolutionFailures)(
    "names both packages and the install command when the optional peers are absent ($runner)",
    async ({ error }) => {
      vi.resetModules();
      vi.doMock("@testcontainers/postgresql", () => ({
        get PostgreSqlContainer(): never {
          throw error;
        },
      }));

      try {
        const { startTestDb } = await import("./harness.js");
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
    MODULE_MOCK_TIMEOUT_MS,
  );

  it(
    "rethrows a genuine fault inside Testcontainers rather than blaming the install",
    async () => {
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
    },
    MODULE_MOCK_TIMEOUT_MS,
  );
});
