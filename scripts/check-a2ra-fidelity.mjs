#!/usr/bin/env node
// @ts-check
/**
 * The manifest holds hashes of the UPSTREAM bytes at the pin, never of what is on disk.
 * A self-generated manifest would be a mirror: edit a vendored file, regenerate, and the
 * gate goes green having checked nothing (ADR-22).
 *
 * `--refresh` is the only mode that opens a socket, which is what lets the verify mode
 * run offline. It cannot prove the manifest itself was generated honestly; that is review.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const A2RA_CONFIG = "packages/ui/a2ra.json";

const MANIFEST = "packages/ui/a2ra-manifest.json";

const UI_PACKAGE = "packages/ui";

/**
 * Empty is the intended state. An entry claims upstream owns a vendored file by some
 * route other than the registry, and needs its reason here; prefer fixing the registry
 * upstream so no mapping is needed.
 *
 * @type {Record<string, string>}
 */
const UPSTREAM_REPO_SOURCES = {};

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * `a2ra.json` is the authority; the manifest's own `pin` is only a record of the last
 * refresh, so a mismatch between them is how a pin move that forgot the refresh goes red
 * instead of measuring the tree against the wrong upstream. An unparseable URL is an
 * error rather than a skip.
 */
export function upstreamPin(configText) {
  /** @type {{ componentsDir?: unknown; registry?: unknown }} */
  const config = JSON.parse(configText);
  const registry = config.registry;
  const componentsDir = config.componentsDir;
  if (typeof registry !== "string" || typeof componentsDir !== "string") {
    throw new TypeError(`${A2RA_CONFIG} must carry string "registry" and "componentsDir" fields`);
  }
  const match =
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(?:.*)$/.exec(
      registry,
    );
  if (match === null) {
    throw new Error(
      `${A2RA_CONFIG}: "registry" is not a raw.githubusercontent.com URL pinned to a full ` +
        `40-character commit sha (got ${registry}). ADR-22 requires an immutable pin, and ` +
        "this gate cannot say which commit it is checking without one.",
    );
  }
  return {
    owner: match[1] ?? "",
    repo: match[2] ?? "",
    pin: match[3] ?? "",
    registry,
    componentsDir,
  };
}

/**
 * Derived from git rather than walked: a walk would read a stray editor backup as a
 * vendored file and report drift about the machine rather than the repository.
 */
export function vendoredFiles(vendoredRoot) {
  return trackedFilesUnder(vendoredRoot);
}

/**
 * Read from the tree rather than from a list, so adding or removing a component cannot
 * leave the refresh fetching a stale set.
 */
export function installedComponents(files) {
  const names = new Set();
  for (const file of files) {
    const slash = file.indexOf("/");
    if (slash > 0) names.add(file.slice(0, slash));
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function compare(manifest, actual) {
  const changed = [];
  const missing = [];
  const recorded = new Set();

  for (const entry of manifest.files) {
    recorded.add(entry.path);
    const hash = actual.get(entry.path);
    if (hash === undefined) {
      missing.push(entry.path);
    } else if (hash !== entry.sha256) {
      changed.push(
        `${entry.path}  (upstream ${entry.sha256.slice(0, 12)}, here ${hash.slice(0, 12)})`,
      );
    }
  }

  const extra = [...actual.keys()].filter((path) => !recorded.has(path)).sort();
  return { changed, missing, extra };
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} -> HTTP ${String(response.status)}`);
  }
  return await response.text();
}

async function refreshManifest(pin, files) {
  const components = installedComponents(files);
  /** @type {{ path: string; sha256: string; origin: string }[]} */
  const entries = [];
  /** @type {Set<string>} */
  const fromRegistry = new Set();

  for (const component of components) {
    const registryFile = await fetchText(`${pin.registry}/${component}.json`);
    /** @type {{ files?: { path?: unknown; content?: unknown }[] }} */
    const parsed = JSON.parse(registryFile);
    for (const file of parsed.files ?? []) {
      if (typeof file.path !== "string" || typeof file.content !== "string") continue;
      if (fromRegistry.has(file.path)) continue;
      fromRegistry.add(file.path);
      entries.push({
        path: file.path,
        sha256: sha256(file.content),
        origin: `registry:${component}`,
      });
    }
  }

  const blobBase = `https://raw.githubusercontent.com/${pin.owner}/${pin.repo}/${pin.pin}`;
  for (const file of files) {
    if (fromRegistry.has(file)) continue;
    const repoPath = UPSTREAM_REPO_SOURCES[file];
    if (repoPath === undefined) {
      throw new Error(
        `${file} is in the vendored tree and no upstream source accounts for it: it is in no ` +
          "installed component's registry entry and has no UPSTREAM_REPO_SOURCES mapping. Either " +
          "it is local source that does not belong under a tree ADR-22 says is upstream's, or " +
          "upstream ships it outside the registry and this script needs the mapping with its reason.",
      );
    }
    entries.push({
      path: file,
      sha256: sha256(await fetchText(`${blobBase}/${repoPath}`)),
      origin: `repo:${repoPath}`,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    comment:
      "Generated by `node scripts/check-a2ra-fidelity.mjs --refresh`. Hashes are of UPSTREAM " +
      "content at the pin below, not of the local files, which is what makes the gate a check " +
      "rather than a mirror. Do not hand-edit: refresh it when a2ra.json's pin moves.",
    repository: `${pin.owner}/${pin.repo}`,
    pin: pin.pin,
    registry: pin.registry,
    componentsDir: `${UI_PACKAGE}/${pin.componentsDir}`,
    algorithm: "sha256",
    components,
    files: entries,
  };
}

export async function main(args = []) {
  const pin = upstreamPin(readFileSync(join(REPO_ROOT, A2RA_CONFIG), "utf8"));
  const vendoredDir = `${UI_PACKAGE}/${pin.componentsDir}`;
  const vendoredRoot = join(REPO_ROOT, vendoredDir);
  const files = vendoredFiles(vendoredRoot);

  if (args.includes("--refresh")) {
    const manifest = await refreshManifest(pin, files);
    writeFileSync(join(REPO_ROOT, MANIFEST), `${JSON.stringify(manifest, undefined, 2)}\n`, "utf8");
    console.log(
      `check-a2ra-fidelity: wrote ${MANIFEST} - ${String(manifest.files.length)} upstream file ` +
        `hashes across ${String(manifest.components.length)} components at ${pin.pin.slice(0, 12)}.`,
    );
    return 0;
  }

  /** @type {{ pin?: unknown; componentsDir?: unknown; files?: unknown }} */
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST), "utf8"));

  // First, because a manifest generated at a different commit says nothing about this
  // one: comparing anyway reports stale-record drift or a clean tree against the wrong
  // upstream.
  if (manifest.pin !== pin.pin || manifest.componentsDir !== vendoredDir) {
    console.error(
      [
        `check-a2ra-fidelity: ${MANIFEST} was generated for a different vendoring.`,
        "",
        `  ${A2RA_CONFIG}:  pin ${pin.pin}  dir ${vendoredDir}`,
        `  ${MANIFEST}:  pin ${String(manifest.pin)}  dir ${String(manifest.componentsDir)}`,
        "",
        "A pin move re-vendors every component, so the manifest is refreshed in the same",
        "change: `node scripts/check-a2ra-fidelity.mjs --refresh` (this is the one mode that",
        "needs the network). Refresh `packages/ui/a2ra-diff.md` alongside it.",
      ].join("\n"),
    );
    return 1;
  }

  /** @type {Map<string, string>} */
  const actual = new Map();
  for (const file of files)
    actual.set(file, sha256(readFileSync(join(vendoredRoot, file), "utf8")));

  const { changed, missing, extra } = compare(
    /** @type {{ files: { path: string; sha256: string; origin: string }[] }} */ (manifest),
    actual,
  );

  if (changed.length === 0 && missing.length === 0 && extra.length === 0) {
    console.log(
      `check-a2ra-fidelity: OK - ${String(actual.size)} vendored files byte-identical to ` +
        `${pin.owner}/${pin.repo} @ ${pin.pin.slice(0, 12)} (ADR-22).`,
    );
    return 0;
  }

  console.error(
    "check-a2ra-fidelity: the vendored tree is not the pinned upstream tree (ADR-22):\n",
  );
  if (changed.length > 0) {
    console.error("  changed (content differs from upstream at the pin):");
    for (const line of changed) console.error(`    ${line}`);
  }
  if (missing.length > 0) {
    console.error("  missing (upstream has it, the vendored tree does not):");
    for (const line of missing) console.error(`    ${line}`);
  }
  if (extra.length > 0) {
    console.error("  extra (in the vendored tree, accounted for by nothing upstream):");
    for (const line of extra) console.error(`    ${line}`);
  }
  console.error(
    [
      "",
      "ADR-22: the vendored sources are upstream's and are kept byte-for-byte, so a local",
      "edit is never the fix. Restore the file from the registry",
      "(`pnpm dlx @a2ra/cli add <component> --overwrite`), or, if the change belongs",
      "upstream, make it there and move the pin in `packages/ui/a2ra.json` - then refresh",
      "this manifest and `packages/ui/a2ra-diff.md` in the same change.",
      "",
      "An `extra` file is local source living under a tree that is upstream's. Move it to a",
      "sibling directory (`submit/`, `schema/`, `form-state/`, `action-context/` are the",
      "QCMS-owned ones), or, if upstream genuinely ships it outside the registry, map it in",
      "UPSTREAM_REPO_SOURCES in this script with the reason.",
    ].join("\n"),
  );
  return 1;
}

// Only when run as a command, so the test can import the helpers without the scan firing
// and without `process.exit` killing the run.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(await main(argv.slice(2)));
}
