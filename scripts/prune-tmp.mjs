#!/usr/bin/env node
// @ts-check
/**
 * Report, and with `--apply` remove, stale repository-owned entries under the system temporary
 * directory. Removal is recursive, so it refuses anything matching no prefix, younger than the age
 * guard, a symlink, or outside the temporary root (checked at classification and again before `rmSync`).
 */

import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { argv, env, exit } from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The only thing that makes an entry eligible for removal, so a prefix belongs here
 * only when its leftovers are observed to pile up, not because something `mkdtemp`s
 * it. Prefixes may nest and the longest match wins, so each entry is reported once.
 *
 * @type {readonly { prefix: string; creator: string }[]}
 */
export const TEMP_PREFIXES = Object.freeze([
  {
    prefix: "qcms-scaffold-",
    creator: "packages/create-qcms-app/src/scaffold.test.ts",
  },
  {
    prefix: "qcms-scaffold-e2e-",
    creator: "packages/create-qcms-app/scripts/scaffold-e2e.mjs",
  },
  {
    prefix: "agent-loop-session-",
    creator: "scripts/agent-loop.sh",
  },
  {
    prefix: "qcms-render-",
    creator: "ad-hoc component render harnesses (no committed creator)",
  },
]);

export const DEFAULT_MIN_AGE_MINUTES = 60;

/**
 * @typedef {"stale" | "recent" | "symlink" | "outside" | "unreadable"} Verdict
 * @typedef {{
 *   name: string;
 *   path: string;
 *   prefix: string;
 *   creator: string;
 *   kind: "directory" | "file";
 *   ageMinutes: number;
 *   verdict: Verdict;
 *   detail: string;
 *   removable: boolean;
 * }} Entry
 */

/**
 * The basename is what is matched, so a name carrying path separators cannot smuggle
 * a claimed prefix in from a parent directory.
 *
 * @param {string} name
 * @returns {{ prefix: string; creator: string } | undefined}
 */
export function matchPrefix(name) {
  const leaf = basename(name);
  let best;
  for (const candidate of TEMP_PREFIXES) {
    if (!leaf.startsWith(candidate.prefix)) continue;
    if (leaf.length === candidate.prefix.length) continue;
    if (best === undefined || candidate.prefix.length > best.prefix.length) best = candidate;
  }
  return best;
}

/**
 * `relative` rather than a string comparison, so `/tmp2` is not read as inside `/tmp`.
 * The empty relative path is rejected too: the sweep removes entries under the root,
 * never the root.
 *
 * @param {string} root
 * @param {string} path
 * @returns {boolean}
 */
export function withinRoot(root, path) {
  const step = relative(root, resolve(path));
  return step !== "" && !step.startsWith("..") && !step.startsWith(sep) && step !== ".";
}

/**
 * The immediate children are read because a directory's own mtime moves only when its
 * top-level entries change, so a long install writing deep inside it looks older than
 * it is. A safety net, not a proof: the tree is not walked. Floored, because
 * `lstatSync` reports sub-millisecond precision while `Date.now()` truncates.
 *
 * @param {string} path
 * @param {boolean} isDirectory
 * @returns {number}
 */
export function newestTopLevelMtime(path, isDirectory) {
  let newest = lstatSync(path).mtimeMs;
  if (isDirectory) {
    let children = /** @type {string[]} */ ([]);
    try {
      children = readdirSync(path);
    } catch {
      // Unreadable directory: fall back to its own mtime.
    }
    for (const child of children) {
      try {
        newest = Math.max(newest, lstatSync(join(path, child)).mtimeMs);
      } catch {
        // Entry vanished mid-walk.
      }
    }
  }
  return Math.floor(newest);
}

/**
 * Symbolic links are counted but never followed.
 *
 * @param {string} path
 * @returns {number}
 */
export function countInodes(path) {
  let total = 1;
  /** @type {import("node:fs").Dirent[]} */
  let children;
  try {
    children = readdirSync(path, { withFileTypes: true });
  } catch {
    return total;
  }
  for (const child of children) {
    total += child.isDirectory() ? countInodes(join(path, child.name)) : 1;
  }
  return total;
}

/**
 * @param {{ name: string; root: string; minAgeMs: number; now: number }} input
 * @returns {Entry | undefined}
 */
export function classify({ name, root, minAgeMs, now }) {
  const owner = matchPrefix(name);
  if (owner === undefined) return undefined;

  const path = resolve(root, name);
  /**
   * @param {Verdict} verdict
   * @param {string} detail
   * @param {boolean} removable
   * @param {"directory" | "file"} kind
   * @param {number} ageMinutes
   * @returns {Entry}
   */
  const entry = (verdict, detail, removable, kind, ageMinutes) => ({
    name,
    path,
    prefix: owner.prefix,
    creator: owner.creator,
    kind,
    ageMinutes,
    verdict,
    detail,
    removable,
  });

  if (!withinRoot(root, path)) {
    return entry("outside", `resolves outside ${root}`, false, "directory", 0);
  }

  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return entry("unreadable", "cannot be stat'd", false, "directory", 0);
  }

  if (stats.isSymbolicLink()) {
    return entry("symlink", "symbolic link, never followed", false, "file", 0);
  }
  if (!stats.isDirectory() && !stats.isFile()) {
    return entry("unreadable", "neither a directory nor a regular file", false, "file", 0);
  }

  const kind = stats.isDirectory() ? "directory" : "file";
  const age = now - newestTopLevelMtime(path, stats.isDirectory());
  const ageMinutes = Math.max(0, Math.floor(age / 60_000));
  if (age < minAgeMs) {
    return entry("recent", "modified within the age guard", false, kind, ageMinutes);
  }
  return entry(
    "stale",
    `last modified ${String(ageMinutes)} minute(s) ago`,
    true,
    kind,
    ageMinutes,
  );
}

/**
 * @param {{ tmpRoot: string; minAgeMinutes: number; now?: number }} options
 * @returns {{ root: string; entries: Entry[] }}
 */
export function scan({ tmpRoot, minAgeMinutes, now = Date.now() }) {
  const root = resolvedRoot(tmpRoot);
  const minAgeMs = minAgeMinutes * 60 * 1000;

  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return { root, entries: [] };
  }

  const entries = names
    .map((name) => classify({ name, root, minAgeMs, now }))
    .filter(/** @returns {value is Entry} */ (value) => value !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { root, entries };
}

/**
 * Links in the root are resolved first so the containment check compares real paths
 * (`/tmp` is a link to `/private/tmp` on macOS).
 *
 * @param {string} tmpRoot
 * @returns {string}
 */
export function resolvedRoot(tmpRoot) {
  try {
    return realpathSync(resolve(tmpRoot));
  } catch {
    return resolve(tmpRoot);
  }
}

/**
 * @param {string[]} args
 * @returns {{ apply: boolean; count: boolean; strict: boolean; minAgeMinutes: number }}
 */
export function parseArgs(args) {
  const parsed = {
    apply: false,
    count: false,
    strict: false,
    minAgeMinutes: DEFAULT_MIN_AGE_MINUTES,
  };
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--count") parsed.count = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--min-age-minutes") {
      const value = remaining.shift();
      const minutes = Number(value);
      if (value === undefined || !Number.isFinite(minutes) || minutes < 0) {
        throw new Error(`--min-age-minutes needs a non-negative number, got '${String(value)}'`);
      }
      parsed.minAgeMinutes = minutes;
    } else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @param {string} tmpRoot
 * @returns {number}
 */
export function main(args, tmpRoot) {
  /** @type {ReturnType<typeof parseArgs>} */
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`prune-tmp: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const { root, entries } = scan({ tmpRoot, minAgeMinutes: options.minAgeMinutes });
  const removable = entries.filter((entry) => entry.removable);
  const kept = entries.filter((entry) => !entry.removable);

  console.log(
    `prune-tmp: ${String(entries.length)} repository-owned entr${entries.length === 1 ? "y" : "ies"} under ${root}, ` +
      `age guard ${String(options.minAgeMinutes)} minute(s).`,
  );

  for (const entry of kept) {
    console.log(`  keep    ${entry.name}  (${entry.verdict}: ${entry.detail})`);
  }

  let inodes = 0;
  for (const entry of removable) {
    // Counting a directory means walking it, which is why `--count` is opt-in.
    const held = options.count
      ? entry.kind === "directory"
        ? countInodes(entry.path)
        : 1
      : undefined;
    if (held !== undefined) inodes += held;
    const suffix = held === undefined ? "" : `, ${String(held)} inode(s)`;
    console.log(
      `  ${options.apply ? "remove " : "stale  "} ${entry.name}  (${entry.creator}: ${entry.detail}${suffix})`,
    );
    if (!options.apply) continue;
    // Re-checked here rather than trusted from the listing: this is the recursive call.
    if (!withinRoot(root, entry.path)) {
      console.error(`prune-tmp: refusing to remove ${entry.path}, outside ${root}`);
      return 1;
    }
    try {
      rmSync(entry.path, { recursive: entry.kind === "directory", force: true });
    } catch (error) {
      console.error(
        `prune-tmp: could not remove ${entry.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }

  if (removable.length === 0) {
    console.log("prune-tmp: nothing to remove.");
    return 0;
  }
  if (options.apply) {
    console.log(
      `prune-tmp: removed ${String(removable.length)} stale entr${removable.length === 1 ? "y" : "ies"}` +
        `${inodes > 0 ? `, ${String(inodes)} inodes freed` : ""}.`,
    );
    return 0;
  }
  console.log(
    `prune-tmp: ${String(removable.length)} stale entr${removable.length === 1 ? "y" : "ies"} to remove. Re-run with --apply.`,
  );
  return options.strict ? 1 : 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2), env.QCMS_TMP_ROOT ?? tmpdir()));
}
