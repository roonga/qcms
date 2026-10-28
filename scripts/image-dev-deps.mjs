// @ts-check
/**
 * `pnpm deploy --prod` prunes `devDependencies` but not `optionalDependencies`, so
 * resolved optional peers put the whole test tooling back into a production image;
 * `--no-optional` is what removes them (`docker/api.Dockerfile`). The dev set is
 * derived from the manifests rather than listed, so it cannot be a list of the names
 * that were wrong once. It does not reach a package another workspace package declares
 * as a production dependency.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expandGlobs, parseWorkspaceGlobs } from "./check-changeset.mjs";
import { REPOSITORY_ROOT } from "./docker.mjs";

/**
 * @param {string} [root]
 * @returns {string[]}
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

/**
 * The one exemption: production packages upstream declare these as real dependencies,
 * so no install flag removes them, and they ship no executable code to reach.
 */
const TYPES_SCOPE = "@types/";

/**
 * `peerDependencies` is deliberately not an exemption: the pair the API image was found
 * carrying is declared exactly that way, so treating a peer as production would exempt
 * the defect.
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

const NPM_PURL = "pkg:npm/";

/**
 * Accepts the in-toto statement buildx attaches or the SPDX document inside it. The
 * name comes from the purl, not SPDX's `name` field: the purl is unambiguous about the
 * ecosystem and round-trips a percent-encoded scoped name.
 *
 * @param {any} document
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
      // A scoped name carries its own `@`, so only a split on the last one works.
      const at = purl.lastIndexOf("@");
      const name = at > 0 ? purl.slice(0, at) : purl;
      packages.push({ name, version: at > 0 ? purl.slice(at + 1) : "" });
      break;
    }
  }
  return packages;
}

/**
 * @param {any} document
 * @param {Set<string>} devOnly
 * @returns {string[]}
 */
export function devPackagesInSbom(document, devOnly) {
  const found = new Set();
  for (const { name, version } of sbomNpmPackages(document)) {
    if (devOnly.has(name)) found.add(version === "" ? name : `${name}@${version}`);
  }
  return [...found].sort();
}

/**
 * An SBOM listing no npm package at all fails rather than passing vacuously: that is
 * how this gate would otherwise go quietly green after a syft field change.
 *
 * @param {any} document
 * @param {string} name
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
