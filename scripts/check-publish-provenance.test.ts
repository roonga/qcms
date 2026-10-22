import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * Every publishable package carries what npm provenance requires (task 040, SEC-11).
 *
 * ## The defect this exists for
 *
 * SEC-11 says npm publishing uses "provenance attestations (`npm publish --provenance`)
 * for all `@roonga/qcms-*` packages". The 2026-10-23 security review found that none of
 * the seven publishable manifests carried a `repository` field, which npm documents as a
 * hard prerequisite rather than a nicety: generating a provenance statement requires "a
 * public `repository` that matches (case-sensitive)" the publishing source
 * (docs.npmjs.com, "Generating provenance statements", read 2026-10-23). A publish with
 * `--provenance` and no `repository` fails, and a publish with `publishConfig.provenance`
 * and no `repository` fails the same way.
 *
 * That is a gate-shaped problem rather than a one-time fix. The next publishable package
 * added to `packages/` would ship with no `repository` and no provenance declaration, and
 * nothing would say so: the publish either fails on a release day or succeeds without the
 * attestation SEC-11 promises adopters. Neither failure is visible in review, because what
 * is missing is a field nobody looks for.
 *
 * ## Why the set is derived
 *
 * A hard-coded list of the seven packages would not break when the eighth arrives; it
 * would silently stop covering it (CONTRIBUTING, "A test that asserts a property of every
 * X in the codebase derives the set of X, and derives it from git"). So the set comes from
 * `trackedFilesUnder`, which reads `git ls-files` and throws on an empty enumeration, and
 * the publishable subset is decided by the manifest's own `private` field rather than by
 * name. An unpublishable package is skipped and a newly publishable one is covered from
 * the commit that flips the field.
 *
 * `apps/` is deliberately out of scope: `qcms-api`, `qcms-portal` and `qcms-admin` are
 * private and are in `.changeset/config.json`'s `ignore` list.
 *
 * ## What it does not claim
 *
 * It asserts the manifest fields and nothing about the registry. Whether a package has
 * ever been published, whether the organisation exists, and whether a real publish
 * attached a real attestation are all outside any local gate. They are issue #360 and the
 * Code Owner checklist in `docs/security-review-2026-10-23.md` section 11.
 */

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The repository every published manifest must point at, exactly. */
const REPOSITORY_URL = "git+https://github.com/roonga/qcms.git";

/** Where an adopter reports a vulnerability or a bug, from a registry page. */
const BUGS_URL = "https://github.com/roonga/qcms/issues";

type Manifest = {
  name?: unknown;
  private?: unknown;
  repository?: unknown;
  homepage?: unknown;
  bugs?: unknown;
  publishConfig?: unknown;
};

/**
 * Every `packages/<name>/package.json` git knows about, as a directory and its manifest.
 *
 * The match is anchored on both sides so a nested manifest (a template tree, a fixture)
 * cannot enter the corpus: only `packages/<one segment>/package.json` qualifies.
 */
function packageManifests(): { dir: string; manifest: Manifest }[] {
  const tracked = trackedFilesUnder(join(REPO_ROOT, "packages"), {
    match: /^[^/]+\/package\.json$/,
  });

  return tracked.map((relative) => {
    const dir = `packages/${relative.replace(/\/package\.json$/, "")}`;
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", relative), "utf8"),
    ) as Manifest;
    return { dir, manifest };
  });
}

/** The ones npm would accept a publish for: `private` is absent or `false`. */
function publishable(): { dir: string; name: string; manifest: Manifest }[] {
  return packageManifests()
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ dir, manifest }) => ({ dir, name: String(manifest.name), manifest }));
}

describe("every publishable package is ready to publish with provenance", () => {
  // The fail-open guard. `trackedFilesUnder` throws on an empty tree, but a pattern that
  // matched nothing would leave every assertion below vacuously true, so the corpus is
  // asserted to reach something before anything is asserted about it.
  it("finds the packages it is supposed to be checking", () => {
    const found = publishable().map(({ name }) => name);
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual(
      expect.arrayContaining([
        "@roonga/qcms-core",
        "@roonga/qcms-db",
        "@roonga/qcms-ui",
        "create-qcms-app",
      ]),
    );
  });

  it.each(publishable())(
    "$name declares the repository npm needs to generate a provenance statement",
    ({ dir, manifest }) => {
      expect(manifest.repository).toEqual({
        type: "git",
        url: REPOSITORY_URL,
        // The subdirectory, so a registry page links at the package and not at the root.
        directory: dir,
      });
    },
  );

  it.each(publishable())("$name opts in to provenance in publishConfig", ({ manifest }) => {
    // `access: "public"` is the scope's own requirement: a scoped package is restricted by
    // default and a restricted package gets no public provenance statement.
    expect(manifest.publishConfig).toEqual({ access: "public", provenance: true });
  });

  it.each(publishable())("$name tells a registry reader where to report a bug", ({ manifest }) => {
    expect(manifest.bugs).toEqual({ url: BUGS_URL });
  });

  it.each(publishable())("$name has a homepage inside this repository", ({ dir, manifest }) => {
    expect(manifest.homepage).toBe(`https://github.com/roonga/qcms/tree/main/${dir}#readme`);
  });
});
