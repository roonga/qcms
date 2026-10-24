/**
 * A scoped package defaults to restricted on npm, so a manifest with no
 * `publishConfig.access` can publish a private package that looks like a success.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
}

const REPO_ROOT = new URL("../", import.meta.url);

/**
 * `:(glob)` is load-bearing: a plain pathspec uses fnmatch without `FNM_PATHNAME`, so
 * its wildcard crosses a slash and the template manifests read back as packages.
 */
const PACKAGE_DIRS: readonly string[] = execFileSync(
  "git",
  ["ls-files", ":(glob)packages/*/package.json"],
  { cwd: fileURLToPath(REPO_ROOT), encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .map((file) => file.split("/")[1] ?? "");

function readManifest(dir: string): Manifest {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`packages/${dir}/package.json`, REPO_ROOT)), "utf8"),
  ) as Manifest;
}

function ignoredPackages(): readonly string[] {
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL(".changeset/config.json", REPO_ROOT)), "utf8"),
  ) as { ignore?: string[] };
  return config.ignore ?? [];
}

function publishablePackages(): readonly (readonly [string, Manifest])[] {
  const ignored = new Set(ignoredPackages());
  return PACKAGE_DIRS.map((dir) => [dir, readManifest(dir)] as const).filter(
    ([, manifest]) =>
      manifest.private !== true && typeof manifest.name === "string" && !ignored.has(manifest.name),
  );
}

describe("publishable package manifests", () => {
  const publishable = publishablePackages();

  it("finds every package that publishes", () => {
    expect(publishable.map(([, manifest]) => manifest.name).sort()).toEqual([
      "@roonga/qcms-a2ui-compiler",
      "@roonga/qcms-core",
      "@roonga/qcms-csv",
      "@roonga/qcms-db",
      "@roonga/qcms-observability",
      "@roonga/qcms-ui",
      "create-qcms-app",
    ]);
  });

  it.each(publishablePackages().map(([dir]) => dir))(
    "packages/%s declares publishConfig.access = public",
    (dir: string) => {
      const manifest = readManifest(dir);

      expect(
        manifest.publishConfig?.access,
        `${manifest.name ?? dir} would publish RESTRICTED: a scoped package defaults to` +
          ' private on npm. Add "publishConfig": { "access": "public" } to its manifest.',
      ).toBe("public");
    },
  );

  it("leaves private packages alone", () => {
    // Ranges over nothing today, and is kept for the next private package.
    for (const dir of PACKAGE_DIRS) {
      const manifest = readManifest(dir);
      if (manifest.private !== true) continue;
      expect(manifest.publishConfig).toBeUndefined();
    }
  });
});
