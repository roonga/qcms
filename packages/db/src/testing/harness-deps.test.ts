/**
 * The published `@roonga/qcms-db/testing` subpath must be installable.
 *
 * Issue #156: the harness imported `@testcontainers/postgresql` and
 * `testcontainers`, both declared only as **devDependencies**. devDependencies
 * are not installed for consumers, so an adopter who installed `@roonga/qcms-db` and
 * imported the documented entry point got a bare `Cannot find package` naming
 * one of them, with no indication of what to install or why.
 *
 * These tests close the class rather than the instance: they keep the optional
 * peers optional, prove the subpath resolves to built output rather than to raw
 * TypeScript (issues #382, #407), and pin the adopter-facing error text.
 *
 * **The import-against-manifest walk that used to live here has moved.** It now
 * starts from every entry point the manifest publishes rather than from this
 * directory alone, so `src/schema` and `src/queries` are covered too:
 * `src/import-manifest.test.ts` (issue #386).
 */
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
      error: new Error(
        'Could not resolve "@testcontainers/postgresql" imported by "@roonga/qcms-db".',
      ),
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
