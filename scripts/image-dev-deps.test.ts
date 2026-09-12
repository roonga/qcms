import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertNoDevDependencies,
  devOnlyDependencies,
  devPackagesInSbom,
  sbomNpmPackages,
  workspaceManifestPaths,
} from "./image-dev-deps.mjs";

/**
 * The image dev-dependency boundary (issue #877).
 *
 * Two halves are worth asserting cheaply, and neither needs Docker. The **derivation**
 * is the half that decides what the gate guards, and its one subtle rule is that a
 * `peerDependencies` entry does not exempt a name - which is exactly how
 * `testcontainers` reached the API image. The **extraction** is the half that decides
 * whether the gate can see anything at all, and its failure mode is silence: a syft
 * field that moves would leave a check that reports no offenders and passes forever.
 *
 * The real SBOM of a real build is asserted by `pnpm qcms:build-images`, which calls
 * the same functions through `assertNoDevPackages`.
 */

const workspaces: string[] = [];

afterAll(() => {
  for (const directory of workspaces) rmSync(directory, { recursive: true, force: true });
});

/** A throwaway workspace root: pnpm-workspace.yaml plus the manifests given. */
function workspace(manifests: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-dev-deps-"));
  workspaces.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  - "apps/*"\n');
  for (const [path, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(manifest));
  }
  return root;
}

/** An SPDX package entry in the shape syft writes, purl and all. */
function spdxPackage(name: string, version: string, ecosystem = "npm") {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return {
    name,
    versionInfo: version,
    externalRefs: [
      {
        referenceCategory: "SECURITY",
        referenceType: "cpe23Type",
        referenceLocator: `cpe:2.3:a:${name}:${name}:${version}:*:*:*:*:*:*:*`,
      },
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:${ecosystem}/${encoded}@${version}`,
      },
    ],
  };
}

/** The in-toto statement buildx attaches, wrapping an SPDX document. */
function statement(packages: ReturnType<typeof spdxPackage>[]) {
  return {
    _type: "https://in-toto.io/Statement/v0.1",
    predicateType: "https://spdx.dev/Document",
    predicate: { spdxVersion: "SPDX-2.3", packages },
  };
}

describe("the dev-only set", () => {
  it("covers every workspace manifest, the root's included", () => {
    const root = workspace({
      "package.json": { name: "root", devDependencies: { vitest: "^4" } },
      "packages/core/package.json": { name: "core", devDependencies: { typescript: "^5" } },
      "apps/api/package.json": { name: "api", devDependencies: { otplib: "^13" } },
    });
    expect(workspaceManifestPaths(root).sort()).toEqual([
      "apps/api/package.json",
      "package.json",
      "packages/core/package.json",
    ]);
    expect([...devOnlyDependencies(root)].sort()).toEqual(["otplib", "typescript", "vitest"]);
  });

  it("exempts a name any package declares as a production dependency", () => {
    // `zod` is a devDependency of one package and a dependency of another. It is a
    // production dependency of this workspace, so an image carrying it is not a defect.
    const root = workspace({
      "package.json": { name: "root", devDependencies: { zod: "^4", vitest: "^4" } },
      "packages/core/package.json": { name: "core", dependencies: { zod: "^4" } },
    });
    expect([...devOnlyDependencies(root)]).toEqual(["vitest"]);
  });

  it("exempts @types/*, which production packages upstream declare as real dependencies", () => {
    // Not a workaround: `@opentelemetry/instrumentation-pg` declares `@types/pg` under
    // `dependencies`, and `@types/pg` declares `@types/node`, so no install flag can
    // remove either from the API image. They cost nothing to keep - a DefinitelyTyped
    // package ships declarations, a README and a LICENSE and no executable code - and a
    // gate nobody can make green is a gate that gets deleted.
    const root = workspace({
      "package.json": {
        name: "root",
        devDependencies: { "@types/node": "^24", "@types/pg": "^8", vitest: "^4" },
      },
    });
    expect([...devOnlyDependencies(root)]).toEqual(["vitest"]);
  });

  it("does NOT let a peerDependencies entry exempt a dev-only name", () => {
    // This is issue #877's own shape. @roonga/qcms-db declares `testcontainers` as an
    // optional peer so a consumer can supply it for the `./testing` subpath, and that
    // is the pair the API image was found carrying. Treating a peer as production
    // would exempt the defect this gate exists to catch.
    const root = workspace({
      "package.json": { name: "root", devDependencies: { testcontainers: "^12" } },
      "packages/db/package.json": {
        name: "db",
        devDependencies: { testcontainers: "^12" },
        peerDependencies: { testcontainers: "^12" },
        peerDependenciesMeta: { testcontainers: { optional: true } },
      },
    });
    expect([...devOnlyDependencies(root)]).toEqual(["testcontainers"]);
  });
});

describe("SBOM extraction", () => {
  it("reads npm packages by purl and ignores other ecosystems", () => {
    const document = statement([
      spdxPackage("hono", "4.13.7"),
      spdxPackage("libssl3", "3.0.17-1", "deb"),
    ]);
    expect(sbomNpmPackages(document)).toEqual([{ name: "hono", version: "4.13.7" }]);
  });

  it("round-trips a scoped name out of its percent-encoded purl", () => {
    // syft writes `pkg:npm/%40vitest/runner@4.1.11`. Splitting on the FIRST `@` would
    // produce an empty name and never match the dev set, so the gate would pass.
    expect(sbomNpmPackages(statement([spdxPackage("@vitest/runner", "4.1.11")]))).toEqual([
      { name: "@vitest/runner", version: "4.1.11" },
    ]);
  });

  it("accepts the SPDX document on its own as well as the in-toto statement", () => {
    const document = statement([spdxPackage("pg", "8.23.0")]);
    expect(sbomNpmPackages(document.predicate)).toEqual(sbomNpmPackages(document));
  });
});

describe("the assertion", () => {
  const root = workspace({
    "package.json": { name: "root", devDependencies: { vitest: "^4", "@playwright/test": "^1" } },
    "apps/api/package.json": { name: "api", dependencies: { hono: "^4", pg: "^8" } },
  });

  it("passes an image that carries production dependencies only", () => {
    const document = statement([spdxPackage("hono", "4.13.7"), spdxPackage("pg", "8.23.0")]);
    expect(assertNoDevDependencies(document, "qcms-api", root)).toBe(2);
  });

  it("names every dev-only package it found", () => {
    const document = statement([
      spdxPackage("hono", "4.13.7"),
      spdxPackage("vitest", "4.1.11"),
      spdxPackage("@playwright/test", "1.63.0"),
    ]);
    expect(() => assertNoDevDependencies(document, "qcms-api", root)).toThrow(/vitest@4\.1\.11/);
    expect(() => assertNoDevDependencies(document, "qcms-api", root)).toThrow(
      /@playwright\/test@1\.63\.0/,
    );
    expect(devPackagesInSbom(document, devOnlyDependencies(root))).toEqual([
      "@playwright/test@1.63.0",
      "vitest@4.1.11",
    ]);
  });

  it("FAILS on an SBOM with no npm packages rather than passing vacuously", () => {
    // The failure mode a check like this dies of: a field moves, the extraction returns
    // nothing, and "no offenders found" is indistinguishable from a clean image.
    expect(() => assertNoDevDependencies(statement([]), "qcms-api", root)).toThrow(
      /lists no npm packages/,
    );
  });
});
