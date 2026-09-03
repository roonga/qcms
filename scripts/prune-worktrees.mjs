#!/usr/bin/env node
// @ts-check
/**
 * Report, and on request remove, orphan directories under the agent worktree root
 * (issue #735).
 *
 * Every agent lane works in a `git worktree` under `.claude/worktrees/`. The skills say
 * to remove an orphan only after proving it is not registered, and nothing ever did that
 * sweep, so the directories accumulate: #735 measured 56 directories against 6
 * registered worktrees, and a re-measure on 2026-09-03 found 51 orphans among 56
 * directories under that root, holding 75 GB in total. None of it was reachable by git
 * and none of it was reported anywhere, which is why it grew unnoticed. The first run of
 * this script removed those 51 and left the root at 8.5 GB.
 *
 * `git worktree list` is the registry. Anything under the root that is not in it is a
 * candidate, and the whole value of this script is in what it refuses to touch:
 *
 * - **A registered worktree** is a live lane. Never touched.
 * - **A directory that is not a worktree leftover at all** - no `.git` file naming a
 *   git directory - is somebody's data that happens to live under this path, not a
 *   stale checkout. Reported, never removed. `.claude/worktrees/seat-mail` is the real
 *   case: a retired two-seat message store, not a worktree.
 * - **A worktree whose git directory still exists** is asked, through git, whether it
 *   has uncommitted work. Dirty means reported and kept.
 * - **A worktree whose git directory is gone** is the bulk of the accumulation, and git
 *   cannot answer for it at all: the branch pointer, index and reflog that made it a
 *   worktree no longer exist, so nothing in it can be committed, pushed or listed, and
 *   no tool can separate a modified file there from an unmodified one. It is removable,
 *   with the age guard below as the safety net rather than a git answer.
 * - **Anything modified recently** (default: the last 24 hours) is kept whatever its
 *   state, so a lane that is working right now is never swept out from under itself.
 *   The guard reads the mtime of the directory and its immediate children only, so it
 *   sees a checkout being created or files added at the top level; it does not walk the
 *   tree, and it therefore does not see an edit deep inside an otherwise idle checkout.
 *   That limit is stated because the guard is a safety net, not a proof.
 *
 * Registrations pointing at a directory that no longer exists are git's own stale
 * entries; `--apply` runs `git worktree prune` for those.
 *
 * Usage:
 *   node scripts/prune-worktrees.mjs                 # report only, changes nothing
 *   node scripts/prune-worktrees.mjs --apply         # remove what the report lists
 *   node scripts/prune-worktrees.mjs --size          # add per-directory sizes (slow)
 *   node scripts/prune-worktrees.mjs --min-age-hours 48
 *   node scripts/prune-worktrees.mjs --strict        # exit 1 when orphans remain
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The worktree root the agent skills use. */
export const DEFAULT_ROOT = ".claude/worktrees";

/** Directories younger than this are kept whatever their state. */
export const DEFAULT_MIN_AGE_HOURS = 24;

/**
 * @typedef {"registered" | "not-a-worktree" | "uncommitted" | "recent" | "orphan-clean" | "orphan-detached"} Verdict
 * @typedef {{ name: string; path: string; verdict: Verdict; detail: string; removable: boolean }} Entry
 */

/**
 * The primary checkout for whatever working tree `from` sits in.
 *
 * The worktree root is a property of the repository, not of where you happen to be
 * standing, and an agent lane runs from a linked worktree whose own `.claude/worktrees`
 * is empty. `--git-common-dir` resolves to the primary checkout's `.git` from any
 * worktree, so the sweep always looks at the one directory that accumulates.
 *
 * @param {string} from
 * @returns {string}
 */
export function primaryCheckout(from) {
  const common = execFileSync(
    "git",
    ["-C", from, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return dirname(common);
}

/**
 * Absolute paths git currently registers as worktrees, and the ones whose directory is
 * missing (git's own stale entries).
 *
 * @param {string} repoRoot
 * @returns {{ registered: Set<string>; missing: string[] }}
 */
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
 * The newest mtime among a directory and its immediate children, in milliseconds.
 *
 * Floored, because `statSync` reports sub-millisecond precision while `Date.now()`
 * truncates: a file written moments ago can read as newer than "now" by a fraction of a
 * millisecond, which makes an age comparison against a zero window come out backwards.
 * Sub-millisecond precision means nothing to a guard measured in hours.
 *
 * @param {string} directory
 * @returns {number}
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

/**
 * The git directory a linked worktree's `.git` file names, or `undefined` when the
 * directory carries no such file (so it is not a worktree leftover).
 *
 * @param {string} directory
 * @returns {string | undefined}
 */
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

/**
 * Classify one directory under the worktree root.
 *
 * @param {{ name: string; path: string; registered: Set<string>; minAgeMs: number; now: number }} input
 * @returns {Entry}
 */
export function classify({ name, path, registered, minAgeMs, now }) {
  /** @param {Verdict} verdict @param {string} detail @param {boolean} removable @returns {Entry} */
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
    // git will not speak for this tree, so treat it as it treats one whose git
    // directory is gone: unreachable, and removable only under the age guard above.
    return entry("orphan-detached", "git cannot read this worktree", true);
  }
  if (status.trim() !== "") {
    const count = status.trim().split("\n").length;
    return entry("uncommitted", `${String(count)} uncommitted path(s)`, false);
  }
  return entry("orphan-clean", "unregistered and clean", true);
}

/**
 * Classify every immediate child directory of `root`.
 *
 * @param {{ repoRoot: string; root: string; minAgeHours: number; now?: number }} options
 * @returns {{ entries: Entry[]; missing: string[] }}
 */
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
 * Disk usage of a directory in kilobytes, or `undefined` when `du` is unavailable.
 *
 * `du` counts each inode once per directory it walks, and pnpm hardlinks a package's
 * files into every worktree's `node_modules` from one store. So the sum over several
 * worktrees counts a shared file several times and **overstates what a sweep frees**:
 * the first real run reported 99 GB across 51 directories and the filesystem gained
 * 65 GB. The number is a useful ranking of which directories are large; it is not a
 * prediction of free space.
 *
 * @param {string} directory
 * @returns {number | undefined}
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

/** @param {number} kb @returns {string} */
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

/**
 * @param {string[]} args
 * @returns {{ apply: boolean; size: boolean; strict: boolean; root: string; minAgeHours: number }}
 */
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

/**
 * @param {string[]} args
 * @param {string} repoRoot
 * @returns {number}
 */
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
