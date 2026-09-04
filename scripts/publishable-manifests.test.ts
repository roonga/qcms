/**
 * Every publishable manifest says it publishes publicly (issue #430).
 *
 * A scoped package defaults to **restricted** on npm. With no
 * `publishConfig.access`, the first `npm publish` of `@qcms/*` either fails outright
 * ("You must sign up for private packages" on a free organisation) or, on a paid
 * plan, silently publishes a private package no adopter can install. The second
 * outcome is the dangerous one, because it looks like success.
 *
 * `.changeset/config.json` already passes `--access public` for a changesets-driven
 * release, so this is defence in depth rather than the only control: it covers a
 * `pnpm publish` run by hand, and it is the copy that lives beside the package.
 *
 * The set is derived the way `scripts/check-changeset.mjs` derives it - `private`
 * plus the changesets `ignore` list - so a fifth publishable package is covered on
 * the commit that adds it, rather than when someone remembers. That is the point:
 * this defect and issue #156 before it were both found by reading, because nothing
 * in a repository that never publishes exercises a publish.
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
 * Package directories under `packages/`, read from Git rather than from a directory
 * walk (a walk also reads build output an earlier gate left behind, issue #629) and
 * never written out, so a new package is covered the day it is added.
 *
 * `:(glob)` is load-bearing. A plain `packages/*\/package.json` pathspec uses fnmatch
 * WITHOUT `FNM_PATHNAME`, so its `*` crosses `/` and the pattern also matches
 * `packages/create-qcms-app/templates/common/apps/api/package.json`: the three
 * manifests the scaffolding generator stamps (task 037) each read back as a fourth
 * copy of `create-qcms-app`. With `:(glob)`, `*` stops at a slash, which is what this
 * pattern was always meant to say. Deduplicating instead would have hidden it.
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

/** Names changesets is configured to skip entirely. */
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
    // Guards the derivation: a filter that matched nothing would make the
    // assertion below vacuous, which is the shape of defect this repository keeps
    // meeting one level down. It is also what keeps the test below honest now that
    // nothing under `packages/` is private: a package flipping to `private` silently
    // fails HERE rather than quietly emptying the private-package check.
    expect(publishable.map(([, manifest]) => manifest.name).sort()).toEqual([
      "@qcms/a2ui-compiler",
      "@qcms/core",
      "@qcms/csv",
      "@qcms/db",
      "@qcms/observability",
      "@qcms/ui",
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
    // `publishConfig` on a package that never publishes is noise, and its presence
    // would suggest a publishing intent that the `private` flag denies. There are no
    // private packages under `packages/` today (`@qcms/csv` and `@qcms/observability`
    // became installable for task 037), so this currently ranges over nothing. It is
    // kept rather than deleted because the property is about the NEXT private package,
    // and the assertion above is what stops the emptiness from being silent.
    for (const dir of PACKAGE_DIRS) {
      const manifest = readManifest(dir);
      if (manifest.private !== true) continue;
      expect(manifest.publishConfig).toBeUndefined();
    }
  });
});
