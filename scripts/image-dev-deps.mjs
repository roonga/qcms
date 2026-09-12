// @ts-check
/**
 * The dev-dependency boundary of a production image, asserted from its SBOM (issue #877).
 *
 * ## The defect this exists to catch
 *
 * The `qcms-api` image's SBOM listed 680 npm packages, among them `vitest`,
 * `@vitest/runner`, `@playwright/test`, `playwright`, `testcontainers`, `esbuild`,
 * `next` and `react`. Nothing in that tooling runs in the container. It inflated the
 * image and, worse, widened the surface every scheduled `pnpm audit` and SBOM scan
 * reports on, which contradicts the "the runtime stage is what is scanned" property
 * the front-end images have (SEC-11, `docs/SECURITY_DESIGN.md` §9).
 *
 * The cause was not a manifest mistake. `pnpm deploy --prod` does exactly what it
 * documents - "packages in `devDependencies` won't be installed" - and the deployed
 * tree's top-level `node_modules` held prod dependencies only. The test tooling
 * arrived through **resolved optional peer dependencies**: `better-auth@1.7.3`
 * declares optional peers on `vitest`, `next`, `react`, `react-dom` and `drizzle-kit`,
 * `next` declares one on `@playwright/test`, and `@roonga/qcms-db` declares them on
 * `testcontainers` and `@testcontainers/postgresql`. pnpm records each satisfied
 * optional peer under that snapshot's `optionalDependencies` in `pnpm-lock.yaml`, and
 * `--prod` prunes `devDependencies`, not `optionalDependencies`. So every
 * lockfile-honouring install put the whole tree back. `--no-optional` is the flag that
 * removes them (`docker/api.Dockerfile`).
 *
 * ## Why the gate is derived rather than a list of forbidden names
 *
 * A list of names is a list of the packages that were wrong once. The property worth
 * holding is "nothing that exists in this workspace only to develop it reaches a
 * published image", and that set is already written down: it is every name under a
 * `devDependencies` block of every workspace manifest, less every name any manifest
 * declares as a production dependency. Derived that way, adding a dev tool extends the
 * gate for free and moving one into `dependencies` narrows it deliberately, in a diff
 * a reviewer sees.
 *
 * **What that boundary deliberately does not cover.** A package some other workspace
 * package declares as a production dependency is not in the dev set, so `next` and
 * `react` - production dependencies of the two front ends - are outside this gate's
 * reach even in the API image, where they have no business. Fixing that needs the
 * lockfile's resolved closure per image rather than the manifests, and a second
 * implementation of pnpm's resolution is a worse bargain than this gate plus the
 * `--no-optional` boundary that removes them at the source. What the gate does cover
 * is where the test tooling lives: `vitest`, `@playwright/test`, `testcontainers`,
 * `@testcontainers/postgresql`, `drizzle-kit`, `typescript`, `eslint` and the rest are
 * dev-only everywhere in this workspace.
 *
 * **The one exemption, and why it is not a workaround.** `@types/*` packages are
 * excluded. They are dev-only in every workspace manifest and they are also genuine
 * `dependencies` of production packages upstream: `@opentelemetry/instrumentation-pg`
 * declares `@types/pg`, and `@types/pg` and `protobufjs` declare `@types/node`. No
 * install flag removes a declared runtime dependency, so a gate that failed on them
 * would be a gate nobody could make green. It costs nothing to exempt them: a
 * DefinitelyTyped package ships `.d.ts` files, a README and a LICENSE and no
 * executable code at all (verified on the pruned tree: 2.7 MB across the three, not
 * one non-declaration file), so there is no code path to reach and no advisory to
 * carry. Any OTHER name that turns up in this position is a finding, not an exemption
 * to widen.
 *
 * ## Why the SBOM is the input
 *
 * The build already generates one and already fails without it (task 036), so reading
 * the SBOM asks the question of the artifact an adopter receives rather than of a
 * directory listing on the builder. It also needs no container to run: an OCI
 * directory on disk answers it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expandGlobs, parseWorkspaceGlobs } from "./check-changeset.mjs";
import { REPOSITORY_ROOT } from "./docker.mjs";

/**
 * Every workspace manifest, the root's included.
 *
 * The globs come from `pnpm-workspace.yaml` through the reader the changeset gate
 * already owns, so a new workspace directory is covered here the moment pnpm sees it.
 *
 * @param {string} [root]
 * @returns {string[]} repo-relative, posix-separated manifest paths.
 */
export function workspaceManifestPaths(root = REPOSITORY_ROOT) {
  const globs = parseWorkspaceGlobs(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  const paths = ["package.json"];
  for (const dir of expandGlobs(root, globs)) {
    const manifest = `${dir}/package.json`;
    if (existsSync(join(root, manifest))) paths.push(manifest);
  }
  return paths;
}

/** Declaration-only packages: the one exemption, explained in the header. */
const TYPES_SCOPE = "@types/";

/**
 * The names that exist in this workspace only to develop it.
 *
 * A name is dev-only when some manifest lists it under `devDependencies` and no
 * manifest lists it under `dependencies` or `optionalDependencies`. `peerDependencies`
 * is deliberately NOT an exemption: `@roonga/qcms-db` declares `testcontainers` and
 * `@testcontainers/postgresql` as optional peers so that a consumer can supply them
 * for `@roonga/qcms-db/testing`, which is precisely the pair the API image was found
 * carrying. Treating a peer as production would exempt the defect.
 *
 * `@types/*` is the single exemption, for the reason the header records: those are
 * declaration-only packages that production packages upstream declare as real
 * dependencies, so they are neither removable nor a surface.
 *
 * @param {string} [root]
 * @returns {Set<string>}
 */
export function devOnlyDependencies(root = REPOSITORY_ROOT) {
  /** @type {Set<string>} */
  const dev = new Set();
  /** @type {Set<string>} */
  const production = new Set();
  for (const manifest of workspaceManifestPaths(root)) {
    const parsed = JSON.parse(readFileSync(join(root, manifest), "utf8"));
    for (const name of Object.keys(parsed.devDependencies ?? {})) dev.add(name);
    for (const name of Object.keys(parsed.dependencies ?? {})) production.add(name);
    for (const name of Object.keys(parsed.optionalDependencies ?? {})) production.add(name);
  }
  for (const name of production) dev.delete(name);
  for (const name of dev) {
    if (name.startsWith(TYPES_SCOPE)) dev.delete(name);
  }
  return dev;
}


/** The purl scheme for an npm package, which is the only ecosystem this gate reads. */
const NPM_PURL = "pkg:npm/";

/**
 * The npm packages an SBOM lists, as `{ name, version }`.
 *
 * The input is either the in-toto statement buildx attaches or the SPDX document
 * inside it, because the two callers hold different halves: a saved attestation file
 * is the statement, and a test fixture is easier to write as the document.
 *
 * The name comes from the purl rather than from SPDX's own `name` field. A purl is
 * unambiguous about the ecosystem - the base image's Debian packages carry
 * `pkg:deb/...` and share the field otherwise - and it round-trips a scoped name,
 * which syft percent-encodes as `pkg:npm/%40vitest/runner@4.1.11`.
 *
 * @param {any} document an in-toto SPDX statement, or the SPDX document itself.
 * @returns {{ name: string, version: string }[]}
 */
export function sbomNpmPackages(document) {
  const spdx = document?.predicate ?? document;
  /** @type {{ name: string, version: string }[]} */
  const packages = [];
  for (const entry of spdx?.packages ?? []) {
    for (const reference of entry.externalRefs ?? []) {
      const locator = reference.referenceLocator;
      if (typeof locator !== "string" || !locator.startsWith(NPM_PURL)) continue;
      const purl = decodeURIComponent(locator.slice(NPM_PURL.length)).split("?")[0];
      // A scoped name carries one `/` and a version is introduced by the LAST `@`,
      // so splitting on the last `@` is the only split that works for both shapes.
      const at = purl.lastIndexOf("@");
      const name = at > 0 ? purl.slice(0, at) : purl;
      packages.push({ name, version: at > 0 ? purl.slice(at + 1) : "" });
      break;
    }
  }
  return packages;
}

/**
 * The dev-only packages an SBOM lists, deduplicated and sorted.
 *
 * @param {any} document an in-toto SPDX statement, or the SPDX document itself.
 * @param {Set<string>} devOnly
 * @returns {string[]} `name@version` for each offender.
 */
export function devPackagesInSbom(document, devOnly) {
  const found = new Set();
  for (const { name, version } of sbomNpmPackages(document)) {
    if (devOnly.has(name)) found.add(version === "" ? name : `${name}@${version}`);
  }
  return [...found].sort();
}

/**
 * Fail when an image's SBOM lists a package this workspace only develops with.
 *
 * An SBOM with no npm packages at all FAILS rather than passing vacuously. That is the
 * failure mode a check like this dies of: syft changes a field, the extraction returns
 * nothing, and a gate that reads "no offenders found" goes quietly green forever.
 *
 * @param {any} document an in-toto SPDX statement, or the SPDX document itself.
 * @param {string} name the image, for the message.
 * @param {string} [root]
 */
export function assertNoDevDependencies(document, name, root = REPOSITORY_ROOT) {
  const npmPackages = sbomNpmPackages(document);
  if (npmPackages.length === 0) {
    throw new Error(
      `image-dev-deps: ${name} has an SBOM that lists no npm packages at all, so this gate cannot answer what is in the image. Check the SBOM shape before trusting a pass.`,
    );
  }
  const offenders = devPackagesInSbom(document, devOnlyDependencies(root));
  if (offenders.length > 0) {
    throw new Error(
      `image-dev-deps: ${name} carries ${String(offenders.length)} package(s) this workspace declares only as a devDependency:\n  ${offenders.join("\n  ")}\n` +
        `Nothing in that tooling runs in the container; it inflates the image and widens what every advisory scan reports on (SEC-11, issue #877). The usual cause is a resolved optional peer dependency, which \`--prod\` does not prune: see the deploy step in docker/api.Dockerfile.`,
    );
  }
  return npmPackages.length;
}
