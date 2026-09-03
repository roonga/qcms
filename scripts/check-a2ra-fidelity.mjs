#!/usr/bin/env node
// @ts-check
/**
 * ADR-22 vendoring fidelity: the vendored `a2-react-aria` tree still matches the pinned
 * upstream commit, provable offline (issue #189, second recurrence).
 *
 * ADR-22's central requirement is that the sources under `packages/ui/src/components/a2ui/`
 * are byte-identical to upstream at the commit `packages/ui/a2ra.json` pins. Nothing in
 * the repository proved it. `git diff main...HEAD` proves only that THIS branch changed
 * nothing; a hand-edit that predates the branch, or a drift introduced by an earlier
 * task, was invisible to every gate. Four UI tasks in a row reached that dead end and
 * each reviewer re-derived that the property could not be checked, which is what made it
 * an issue rather than a note.
 *
 * ## The shape, and why this one
 *
 * `#189` listed three options. A committed transcript (`packages/ui/a2ra-diff.md`, which
 * stays: it is the human-readable account of what a pin move changed) is a point-in-time
 * snapshot that depends on the author running it. A CI step calling the upstream registry
 * needs network from CI and turns an outage into a red build or, worse, into a skip that
 * reads as a pass. This is the third: a **content-hash manifest**, generated from
 * upstream at vendor time and compared against the working tree on every run.
 *
 * The manifest holds hashes of the UPSTREAM bytes, taken from the registry at the pin,
 * not hashes of whatever happens to be on disk. That distinction is the whole point. A
 * self-generated manifest would be a mirror: edit a vendored file, regenerate, and the
 * gate goes green having checked nothing. Here regeneration requires the network and the
 * pin, so the manifest is a claim about upstream that the working tree is measured
 * against, and the only way to make a local edit pass is to move the pin to a commit
 * that actually contains it.
 *
 * ## What it proves, and what it does not
 *
 * Written down because an unwritten limit is how a gate gets trusted past its reach.
 *
 *   - **It proves** every tracked file under the vendored tree hashes to the upstream
 *     content at the pinned commit, that no file is missing, and that no extra file has
 *     been added beside them. Any single changed byte is red.
 *   - **It cannot prove** the manifest itself was generated honestly. A contributor with
 *     commit access can edit a vendored file and `--refresh` against a pin they also
 *     moved. That is not a hole this class of gate can close; it is what review is for.
 *     What it does close is the accident and the quiet drift, which is what #189 is about.
 *   - **It says nothing about `theme.css`** or any other upstream asset outside the
 *     component tree. `docs/RETRO.md`'s original friction named token values too; those
 *     are a separate corpus and are not covered here.
 *   - **It is not `a2ra diff`.** The CLI compares against the registry live and reports
 *     per-component; this compares against a frozen record of it and reports per-file.
 *     A pin move still runs the CLI and refreshes `a2ra-diff.md`; this gate is what keeps
 *     the tree honest on every one of the days in between.
 *
 * ## Refreshing
 *
 *   node scripts/check-a2ra-fidelity.mjs --refresh
 *
 * Run it whenever `a2ra.json`'s pin moves or a component is added or removed, in the same
 * change. It fetches the registry at the new pin, recomputes every hash from upstream
 * content, and rewrites the manifest. It is the only mode that needs the network; the
 * default verify mode never opens a socket, which is why it can live inside `pnpm verify`
 * and run on an aeroplane.
 *
 * Usage:  node scripts/check-a2ra-fidelity.mjs [--refresh]
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The vendoring configuration the a2ra CLI reads: `componentsDir` and the pinned registry. */
const A2RA_CONFIG = "packages/ui/a2ra.json";

/** The generated record this gate compares against. */
const MANIFEST = "packages/ui/a2ra-manifest.json";

/** The package `componentsDir` is resolved relative to. */
const UI_PACKAGE = "packages/ui";

/**
 * Vendored files upstream does NOT publish through the registry, and where its repository
 * keeps them instead.
 *
 * `group-schema-fields.ts` is the whole list today. It sits at the root of the vendored
 * tree, `checkbox/checkbox.schema.ts` and `radio/radio.schema.ts` import it, and no
 * component's registry JSON contains it at this pin - so the 17 installed components
 * yield 73 files and the tree holds 74. Upstream keeps it at
 * `packages/core/src/components/group-schema-fields.ts`, which is what the refresh hashes,
 * and the two copies are byte-identical. Treating it as an unexplained extra would have
 * been the easy wrong answer: it would fail a gate on a file the vendored components
 * cannot compile without.
 *
 * An entry is a repo path in the upstream repository, fetched at the pin. Adding one is a
 * statement that upstream owns the file by another route, so each needs its reason here.
 *
 * @type {Record<string, string>}
 */
const UPSTREAM_REPO_SOURCES = {
  "group-schema-fields.ts": "packages/core/src/components/group-schema-fields.ts",
};

/** @param {string} text @returns {string} lowercase hex sha256 of the UTF-8 bytes */
export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The upstream coordinates `a2ra.json` pins.
 *
 * `a2ra.json` is the authority on which commit the tree is vendored from, and the
 * registry URL is the only place that commit is written, so it is parsed out of there.
 * The manifest carries a `pin` too, but as a record of what the last refresh read rather
 * than as a second source of truth: the gate compares the two, and a mismatch is how a
 * pin move that forgot the refresh becomes red instead of quietly measuring the tree
 * against the wrong upstream.
 *
 * A URL shape this gate does not understand is an error, not a skip: a fidelity gate that
 * quietly stops knowing which commit it is checking is worse than no gate.
 *
 * @param {string} configText contents of `packages/ui/a2ra.json`
 * @returns {{ owner: string; repo: string; pin: string; registry: string; componentsDir: string }}
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
 * Every tracked file in the vendored tree, as paths relative to it.
 *
 * Derived from git rather than walked, per the CONTRIBUTING rule: a walk would read a
 * stray editor backup or build output as a vendored file and report drift about the
 * machine rather than about the repository.
 *
 * @param {string} vendoredRoot absolute path to the vendored tree
 * @returns {string[]} sorted, slash-separated, relative to `vendoredRoot`
 */
export function vendoredFiles(vendoredRoot) {
  return trackedFilesUnder(vendoredRoot);
}

/**
 * The component directories installed in the vendored tree.
 *
 * Read from the tree rather than from a list, so adding or removing a component cannot
 * leave the refresh fetching a stale set. A file at the root of the tree belongs to no
 * component and is handled by {@link UPSTREAM_REPO_SOURCES}.
 *
 * @param {string[]} files paths relative to the vendored tree
 * @returns {string[]} sorted component names
 */
export function installedComponents(files) {
  const names = new Set();
  for (const file of files) {
    const slash = file.indexOf("/");
    if (slash > 0) names.add(file.slice(0, slash));
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Compare the working tree against the manifest.
 *
 * Three failure kinds, reported separately because they mean different things: a changed
 * file is drift, a missing file is a broken vendoring, and an extra file is local source
 * smuggled into a tree that ADR-22 says is upstream's.
 *
 * @param {{ files: { path: string; sha256: string; origin: string }[] }} manifest
 * @param {Map<string, string>} actual path -> sha256 of the file on disk
 * @returns {{ changed: string[]; missing: string[]; extra: string[] }}
 */
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

/**
 * Fetch one upstream text file at the pin, failing loudly rather than returning empty.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} -> HTTP ${String(response.status)}`);
  }
  return await response.text();
}

/**
 * Rebuild the manifest from upstream at the pin.
 *
 * @param {ReturnType<typeof upstreamPin>} pin
 * @param {string[]} files paths relative to the vendored tree
 * @returns {Promise<object>}
 */
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

/**
 * Run the gate (or the refresh).
 *
 * @param {string[]} args
 * @returns {Promise<number>} process exit code
 */
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

  // The pin check comes first: a manifest generated at a different commit says nothing
  // about this one, and comparing anyway would report either drift that is really a
  // stale record, or a clean tree against the wrong upstream.
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

// Only when run as a command, so the test can import the helpers above without the scan
// firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(await main(argv.slice(2)));
}
