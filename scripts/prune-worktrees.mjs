#!/usr/bin/env node
// @ts-check
/**
 * The registry is the only authority on what is live, and the value here is in what is
 * refused: a registered lane, a directory carrying no `.git` file (somebody's data rather
 * than a stale checkout), and any tree still reporting uncommitted work.
 *
 * A leftover whose git directory is gone is unreachable, so nothing can tell a modified
 * file in it from an unmodified one. The age guard stands in for that answer, and it
 * reads the directory and its immediate children only: it does not see an edit deep
 * inside an otherwise idle checkout.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

export const DEFAULT_ROOT = ".claude/worktrees";

export const DEFAULT_MIN_AGE_HOURS = 24;

/**
 * @typedef {"registered" | "not-a-worktree" | "uncommitted" | "recent" | "orphan-clean" | "orphan-detached"} Verdict
 * @typedef {{ name: string; path: string; verdict: Verdict; detail: string; removable: boolean }} Entry
 */

/**
 * A lane runs from a linked tree whose own root directory is empty, so this resolves back
 * to the primary checkout and the sweep always looks at the one place that accumulates.
 */
export function primaryCheckout(from) {
  const common = execFileSync(
    "git",
    ["-C", from, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return dirname(common);
}

export function readRegistry(repoRoot) {
  const output = execFileSync("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  const registered = new Set();
  const missing = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length).trim();
    registered.add(path);
    try {
      statSync(path);
    } catch {
      missing.push(path);
    }
  }
  return { registered, missing };
}

/**
 * Floored: `statSync` reports sub-millisecond precision while `Date.now()` truncates, so
 * a file written moments ago can read as newer than now and reverse an age comparison.
 */
export function newestTopLevelMtime(directory) {
  let newest = statSync(directory).mtimeMs;
  for (const child of readdirSync(directory)) {
    try {
      newest = Math.max(newest, statSync(join(directory, child)).mtimeMs);
    } catch {
      // A file that vanished between the listing and the stat is not evidence of age.
    }
  }
  return Math.floor(newest);
}

export function linkedGitDir(directory) {
  let contents;
  try {
    contents = readFileSync(join(directory, ".git"), "utf8");
  } catch {
    return undefined; // no `.git` file: a plain directory, or a primary checkout
  }
  const match = /^gitdir:\s*(.+)$/m.exec(contents);
  return match === null ? undefined : match[1].trim();
}

export function classify({ name, path, registered, minAgeMs, now }) {
  const entry = (verdict, detail, removable) => ({ name, path, verdict, detail, removable });

  if (registered.has(path)) return entry("registered", "live worktree, git lists it", false);

  const gitDir = linkedGitDir(path);
  if (gitDir === undefined) {
    return entry("not-a-worktree", "no `.git` file naming a git directory", false);
  }

  if (now - newestTopLevelMtime(path) < minAgeMs) {
    return entry("recent", "modified within the age guard", false);
  }

  let gitDirExists = true;
  try {
    statSync(gitDir);
  } catch {
    gitDirExists = false;
  }
  if (!gitDirExists) {
    return entry("orphan-detached", `git directory gone (${gitDir})`, true);
  }

  let status;
  try {
    status = execFileSync("git", ["-C", path, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Nothing can speak for this tree, so it counts as unreachable and is removable only
    // under the age guard above.
    return entry("orphan-detached", "git cannot read this worktree", true);
  }
  if (status.trim() !== "") {
    const count = status.trim().split("\n").length;
    return entry("uncommitted", `${String(count)} uncommitted path(s)`, false);
  }
  return entry("orphan-clean", "unregistered and clean", true);
}

export function scan({ repoRoot, root, minAgeHours, now = Date.now() }) {
  const rootPath = resolve(repoRoot, root);
  const { registered, missing } = readRegistry(repoRoot);
  const minAgeMs = minAgeHours * 60 * 60 * 1000;

  /** @type {import("node:fs").Dirent[]} */
  let children;
  try {
    children = readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return { entries: [], missing };
  }

  const entries = children
    .filter((child) => child.isDirectory())
    .map((child) =>
      classify({ name: child.name, path: join(rootPath, child.name), registered, minAgeMs, now }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return { entries, missing };
}

/**
 * `du` counts each inode once per directory it walks and pnpm hardlinks from one store,
 * so a sum over several trees overstates what a sweep frees. It ranks sizes; it does not
 * predict free space.
 */
export function sizeKb(directory) {
  try {
    const output = execFileSync("du", ["-sk", directory], { encoding: "utf8" });
    const value = Number.parseInt(output.split(/\s+/)[0], 10);
    return Number.isNaN(value) ? undefined : value;
  } catch {
    return undefined;
  }
}

export function humanKb(kb) {
  const units = ["KB", "MB", "GB", "TB"];
  let value = kb;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function parseArgs(args) {
  const parsed = {
    apply: false,
    size: false,
    strict: false,
    root: DEFAULT_ROOT,
    minAgeHours: DEFAULT_MIN_AGE_HOURS,
  };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--size") parsed.size = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--root") {
      const value = remaining.shift();
      if (value === undefined) throw new Error("--root requires a value");
      parsed.root = value;
    } else if (arg === "--min-age-hours") {
      const value = remaining.shift();
      const hours = Number(value);
      if (value === undefined || !Number.isFinite(hours) || hours < 0) {
        throw new Error(`--min-age-hours needs a non-negative number, got '${String(value)}'`);
      }
      parsed.minAgeHours = hours;
    } else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

export function main(args, repoRoot) {
  /** @type {ReturnType<typeof parseArgs>} */
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`prune-worktrees: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const { entries, missing } = scan({
    repoRoot,
    root: options.root,
    minAgeHours: options.minAgeHours,
  });
  const removable = entries.filter((entry) => entry.removable);
  const kept = entries.filter((entry) => !entry.removable);

  console.log(
    `prune-worktrees: ${String(entries.length)} director${entries.length === 1 ? "y" : "ies"} under ${options.root}, ` +
      `${String(entries.filter((entry) => entry.verdict === "registered").length)} registered.`,
  );

  for (const entry of kept) {
    if (entry.verdict === "registered") continue;
    console.log(`  keep    ${entry.name}  (${entry.verdict}: ${entry.detail})`);
  }

  let reclaimedKb = 0;
  for (const entry of removable) {
    const size = options.size ? sizeKb(entry.path) : undefined;
    if (size !== undefined) reclaimedKb += size;
    const suffix = size === undefined ? "" : `, ${humanKb(size)}`;
    console.log(
      `  ${options.apply ? "remove " : "orphan "} ${entry.name}  (${entry.verdict}: ${entry.detail}${suffix})`,
    );
    if (!options.apply) continue;
    try {
      rmSync(entry.path, { recursive: true, force: true });
    } catch (error) {
      console.error(
        `prune-worktrees: could not remove ${entry.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }

  if (missing.length > 0) {
    console.log(
      `  ${String(missing.length)} registration(s) point at a missing directory: ${missing.join(", ")}`,
    );
    if (options.apply) {
      execFileSync("git", ["-C", repoRoot, "worktree", "prune"], { stdio: "inherit" });
      console.log("  ran `git worktree prune` for those.");
    }
  }

  if (removable.length === 0) {
    console.log("prune-worktrees: nothing to remove.");
    return 0;
  }
  if (options.apply) {
    console.log(
      `prune-worktrees: removed ${String(removable.length)} orphan director${removable.length === 1 ? "y" : "ies"}` +
        `${reclaimedKb > 0 ? `, ${humanKb(reclaimedKb)} walked (hardlinks counted per directory, so the filesystem gains less)` : ""}.`,
    );
    return 0;
  }
  console.log(
    `prune-worktrees: ${String(removable.length)} orphan director${removable.length === 1 ? "y" : "ies"} to remove. Re-run with --apply.`,
  );
  return options.strict ? 1 : 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2), env.QCMS_REPO_ROOT ?? primaryCheckout(REPO_ROOT)));
}
