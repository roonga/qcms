#!/usr/bin/env node
// @ts-check
/**
 * Every worktree shares one Playwright browser cache and an install removes builds no current
 * client claims, so installs started here opt out of that collection: `prune` reclaims instead.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { pathToFileURL } from "node:url";

/** Documented by Playwright as the opt-out from removing browsers it considers unused. */
export const SKIP_GC_ENV = "PLAYWRIGHT_SKIP_BROWSER_GC";

/** Set once per process tree so the check does not repeat in every Playwright worker. */
export const CHECKED_ENV = "QCMS_PLAYWRIGHT_BROWSERS_CHECKED";

const BROWSER = "chromium";

const COMPLETE_MARKER = "INSTALLATION_COMPLETE";

const CHROMIUM_BUILD = /^chromium-(\d+)$/;

/**
 * @typedef {{ root: string; builds: string[] }} PinnedBuilds
 * @typedef {(command: string, args: string[], environment: NodeJS.ProcessEnv) => { status: number | null; error?: Error }} Runner
 */

/**
 * The cache root and the two build directories the chromium gate launches, read off the path
 * Playwright reports for the revision it pins. Both directories carry that one revision, and a
 * layout this cannot parse returns `undefined` rather than a guess.
 *
 * @param {string | undefined} executablePath what `chromium.executablePath()` reports.
 * @returns {PinnedBuilds | undefined}
 */
export function pinnedBuilds(executablePath) {
  if (executablePath === undefined) return undefined;
  const parts = executablePath.split(sep);
  const index = parts.findIndex((part) => CHROMIUM_BUILD.test(part));
  if (index === -1) return undefined;
  const revision = CHROMIUM_BUILD.exec(/** @type {string} */ (parts[index]))?.[1];
  if (revision === undefined) return undefined;
  const root = parts.slice(0, index).join(sep);
  if (root === "") return undefined;
  return { root, builds: [`chromium-${revision}`, `chromium_headless_shell-${revision}`] };
}

/**
 * Playwright writes the marker file only once a download has unpacked, so a build interrupted
 * half way counts as missing rather than as present.
 *
 * @param {PinnedBuilds} pinned
 * @returns {string[]}
 */
export function missingBuilds({ root, builds }) {
  return builds.filter((name) => !existsSync(join(root, name, COMPLETE_MARKER)));
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} environment
 * @returns {{ status: number | null; error?: Error }}
 */
function spawnRun(command, args, environment) {
  return spawnSync(command, args, { stdio: "inherit", env: environment, windowsHide: true });
}

/** @param {string} line */
function write(line) {
  stdout.write(`${line}\n`);
}

/**
 * @param {{ run?: Runner; environment?: NodeJS.ProcessEnv }} [options]
 * @returns {void}
 */
export function installBrowsers({ run = spawnRun, environment = env } = {}) {
  const result = run("pnpm", ["exec", "playwright", "install", BROWSER], {
    ...environment,
    [SKIP_GC_ENV]: "1",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `pnpm exec playwright install ${BROWSER} exited ${String(result.status)}. ` +
        "The browser gate cannot launch without it; see docs/DEVELOPER_GUIDE.md.",
    );
  }
}

/**
 * Install the pinned builds when the shared cache is missing one, so a neighbour's collection
 * surfaces here rather than as a vanished executable six minutes into the suite.
 *
 * @param {{ executablePath?: string; run?: Runner; environment?: NodeJS.ProcessEnv; out?: (line: string) => void }} [options]
 * @returns {{ checked: boolean; installed: boolean; missing: string[] }}
 */
export function ensureBrowsers({ executablePath, run, environment = env, out = write } = {}) {
  if (environment[CHECKED_ENV] === "1") return { checked: false, installed: false, missing: [] };
  environment[CHECKED_ENV] = "1";

  const pinned = pinnedBuilds(executablePath);
  // An unreadable layout is not a diagnosis, so it falls through to the install, which settles
  // the question either way and is a no-op when the builds are already there.
  const missing =
    pinned === undefined ? [`${BROWSER} (cache layout unrecognised)`] : missingBuilds(pinned);
  if (pinned !== undefined && missing.length === 0) {
    out(`[playwright] browsers present in ${pinned.root}: ${pinned.builds.join(", ")}`);
    return { checked: true, installed: false, missing };
  }

  out(`[playwright] missing from the shared browser cache: ${missing.join(", ")}`);
  out(`[playwright] installing with ${SKIP_GC_ENV}=1 so no other lane's build is removed`);
  installBrowsers({ run, environment });
  return { checked: true, installed: true, missing };
}

/**
 * Dot directories are Playwright's own bookkeeping (`.links`), not builds.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function cacheBuilds(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? -1 : 1));
  } catch {
    return [];
  }
}

/**
 * @param {string[]} args
 * @returns {{ mode: "install" | "prune"; apply: boolean }}
 */
export function parseArgs(args) {
  const [mode = "install", ...rest] = args;
  if (mode !== "install" && mode !== "prune") {
    throw new Error(`unknown mode: ${mode} (expected install or prune)`);
  }
  let apply = false;
  for (const arg of rest) {
    if (arg === "--apply") apply = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (apply && mode !== "prune") throw new Error("--apply applies to prune only");
  return { mode, apply };
}

/**
 * `uninstall --all` is Playwright's own documented reclaim and it empties the cache for every
 * checkout on the host, so it stays behind `--apply` and the next gate re-downloads.
 *
 * @param {{ pinned?: PinnedBuilds; apply: boolean; run?: Runner; environment?: NodeJS.ProcessEnv; out?: (line: string) => void }} options
 * @returns {number}
 */
export function prune({ pinned, apply, run = spawnRun, environment = env, out = write }) {
  if (pinned === undefined) {
    out("playwright-browsers: cannot locate the browser cache from this installation.");
    return 1;
  }
  const present = cacheBuilds(pinned.root);
  out(`playwright-browsers: ${String(present.length)} build(s) in ${pinned.root}`);
  for (const name of present) {
    out(`  ${pinned.builds.includes(name) ? "pinned here" : "other      "}  ${name}`);
  }
  if (!apply) {
    out("");
    out("Re-run with --apply to remove every build, for every checkout on this host.");
    out("Do it only while no browser gate is running; the next gate downloads what it needs.");
    return 0;
  }
  const result = run("pnpm", ["exec", "playwright", "uninstall", "--all"], { ...environment });
  if (result.error !== undefined) throw result.error;
  return result.status === 0 ? 0 : 1;
}

/**
 * @param {string[]} args
 * @param {string | undefined} executablePath
 * @returns {number}
 */
export function main(args, executablePath) {
  /** @type {ReturnType<typeof parseArgs>} */
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`playwright-browsers: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (options.mode === "prune") {
    return prune({ pinned: pinnedBuilds(executablePath), apply: options.apply });
  }
  installBrowsers();
  return 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  const { chromium } = await import("@playwright/test");
  /** @type {string | undefined} */
  let executablePath;
  try {
    executablePath = chromium.executablePath();
  } catch {
    executablePath = undefined;
  }
  exit(main(argv.slice(2), executablePath));
}
