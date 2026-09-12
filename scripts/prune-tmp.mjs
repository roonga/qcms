#!/usr/bin/env node
// @ts-check
/**
 * Report, and on request remove, stale repository-owned temporary entries under the
 * system temporary directory (issue #918).
 *
 * `/tmp` on the development host is a tmpfs with a fixed inode table (1,048,576 on the
 * box that raised #918). It reached 100 percent twice on 2026-09-12, and a tmpfs out of
 * inodes does not say so: every write on the host fails with an ordinary error that
 * never mentions `/tmp`, so a lane sees a PR body it cannot write and a reviewer sees a
 * checkout that dies mid-run. The fillers were per-run workspaces of a few hundred
 * files each, left behind by runs that were killed before their teardown.
 *
 * This is a sibling of `scripts/prune-worktrees.mjs` rather than a flag on it, because
 * the two share only their reporter shape. That script is entirely git: it reads
 * `git worktree list` as a registry, follows `.git` files, asks git whether a checkout
 * is dirty, and ends by running `git worktree prune`. None of that vocabulary applies
 * to a temporary directory, which has no registry and no owner to ask - only a name, a
 * mtime, and a rule about what may be removed. Folding it in would mean a second root,
 * a second age unit and a second classifier inside one `main`, so it lives beside it
 * and mirrors its interface: report by default, `--apply` to remove, an age guard that
 * is never bypassed.
 *
 * What it refuses to touch:
 *
 * - **Anything whose name matches no prefix below.** The list is the whole authority
 *   for what this repository owns. A `playwright_chromiumdev_profile-*` directory is
 *   not on it, so the sweep leaves it alone even though Playwright made it.
 * - **Anything younger than the age guard** (default 60 minutes). A scaffold workspace
 *   that is being written right now looks exactly like one abandoned an hour ago, and
 *   the mtime is the only thing that separates them.
 * - **A symbolic link.** It is never followed and never removed, so no sweep of `/tmp`
 *   can reach through one into a real tree.
 * - **Any path that does not resolve inside the temporary root.** Removal is recursive,
 *   so this is checked when the entry is classified and again immediately before the
 *   `rmSync`, rather than trusted from the listing.
 *
 * Usage:
 *   node scripts/prune-tmp.mjs                       # report only, changes nothing
 *   node scripts/prune-tmp.mjs --apply               # remove what the report lists
 *   node scripts/prune-tmp.mjs --min-age-minutes 240
 *   node scripts/prune-tmp.mjs --count               # add per-entry inode counts (slow)
 *   node scripts/prune-tmp.mjs --strict              # exit 1 when stale entries remain
 *
 * `QCMS_TMP_ROOT` replaces the root that is swept (`os.tmpdir()` otherwise). It is read
 * once, at the entry point below, and is the only knob that changes where `--apply`
 * deletes; everything above that takes the root as a parameter, which is how
 * `prune-tmp.test.ts` points the real classifier at a fixture tree. Nothing schedules
 * this sweep: it runs when someone runs it (`docs/DEVELOPER_GUIDE.md`, "Monitoring and
 * control").
 */

import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { argv, env, exit } from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The temporary-entry prefixes whose entries OUTLIVE the process that made them, with
 * the creator of each. This list is the only thing that makes an entry under the
 * temporary root eligible for removal.
 *
 * "Every `mkdtemp` prefix in the repository" is the wrong rule and a far longer list:
 * around thirty other prefixes are test fixtures and script workspaces that remove
 * their own directory before they exit, so nothing of theirs is ever still here an hour
 * later and an entry for them would only widen what `--apply` may delete while never
 * removing anything. A prefix belongs here when its leftovers are actually observed to
 * pile up: a workspace whose cleanup sits on the kill path of something run often by
 * hand (a harness cap, a usage-limit stop, a SIGKILL, none of which reach a `finally`),
 * or one with no owner to clean it up at all. A rarely run creator whose `finally` could
 * in principle be skipped - the weekly restore drill, for one - is added when it is seen
 * to leave something, not on principle. A prefix whose creator is gone belongs out.
 *
 * Prefixes may nest (`qcms-scaffold-e2e-` sits inside `qcms-scaffold-`); the longest
 * match wins, so each entry is reported once, under the creator that really made it.
 *
 * @type {readonly { prefix: string; creator: string }[]}
 */
export const TEMP_PREFIXES = Object.freeze([
  {
    prefix: "qcms-scaffold-",
    // `packages/create-qcms-app/src/scaffold.test.ts` stamps one workspace of about 495
    // files per case. It removes them itself now (issue #918); this entry catches the
    // ones older runs left, and any run killed between `mkdtemp` and its cleanup.
    creator: "packages/create-qcms-app/src/scaffold.test.ts",
  },
  {
    prefix: "qcms-scaffold-e2e-",
    // `pnpm qcms:scaffold-e2e` stamps and installs a full generated workspace. Its
    // `finally` removes it unless `--keep`, so what lands here is the kill path: a
    // harness cap, a usage-limit stop, or a SIGKILL, none of which reach `finally`.
    creator: "packages/create-qcms-app/scripts/scaffold-e2e.mjs",
  },
  {
    prefix: "agent-loop-session-",
    // `scripts/agent-loop.sh` `mktemp`s one session log per supervisor iteration. These
    // are single files, not directories, and each one is still an inode.
    creator: "scripts/agent-loop.sh",
  },
  {
    prefix: "qcms-render-",
    // Ad-hoc render harnesses: a throwaway workspace holding an entry module and its
    // bundle, used to server-render one portal or admin component while diagnosing it.
    // No committed script creates these - they are written per investigation and are
    // listed here precisely because nothing owns them well enough to clean them up.
    creator: "ad-hoc component render harnesses (no committed creator)",
  },
]);

/** Entries younger than this are kept whatever their state. */
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
 * The longest prefix in {@link TEMP_PREFIXES} that `name` starts with, or `undefined`
 * when this repository does not claim the name.
 *
 * The basename is what is matched, so a name carrying path separators cannot smuggle a
 * claimed prefix in from a parent directory.
 *
 * @param {string} name
 * @returns {{ prefix: string; creator: string } | undefined}
 */
export function matchPrefix(name) {
  const leaf = basename(name);
  let best;
  for (const candidate of TEMP_PREFIXES) {
    if (!leaf.startsWith(candidate.prefix)) continue;
    if (leaf.length === candidate.prefix.length) continue; // the bare prefix names nothing
    if (best === undefined || candidate.prefix.length > best.prefix.length) best = candidate;
  }
  return best;
}

/**
 * Whether `path` resolves to something strictly inside `root`.
 *
 * `root` is expected to be already resolved. `relative` is used rather than a string
 * comparison so that `/tmp2` is not read as being inside `/tmp`, and the empty relative
 * path (the root itself) is rejected too: this sweep removes entries under the root,
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
 * The newest mtime among a directory and its immediate children, in milliseconds; for
 * anything else, its own mtime.
 *
 * A workspace's own mtime moves only when its top-level entries change, so a long
 * install that writes deep inside it can leave the directory looking older than it is.
 * Reading the immediate children costs one listing and covers the shape these
 * workspaces actually have (a stamp writes its tree top-down). It is a safety net, not
 * a proof: the guard does not walk the tree.
 *
 * Floored, because `lstatSync` reports sub-millisecond precision while `Date.now()`
 * truncates, and an entry written moments ago can otherwise read as newer than "now".
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
      // An unreadable directory offers no better evidence than its own mtime.
    }
    for (const child of children) {
      try {
        newest = Math.max(newest, lstatSync(join(path, child)).mtimeMs);
      } catch {
        // A file that vanished between the listing and the stat is not evidence of age.
      }
    }
  }
  return Math.floor(newest);
}

/**
 * Inodes held by `path`, counting the entry itself and everything under it. Symbolic
 * links are counted but never followed.
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
 * Classify one entry named directly under the temporary root.
 *
 * @param {{ name: string; root: string; minAgeMs: number; now: number }} input
 * @returns {Entry | undefined} `undefined` when no claimed prefix matches the name.
 */
export function classify({ name, root, minAgeMs, now }) {
  const owner = matchPrefix(name);
  if (owner === undefined) return undefined;

  const path = resolve(root, name);
  /** @param {Verdict} verdict @param {string} detail @param {boolean} removable @param {"directory" | "file"} kind @param {number} ageMinutes @returns {Entry} */
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
 * Classify every immediate child of the temporary root whose name this repository
 * claims.
 *
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
 * The temporary root with every symbolic link in it already resolved, so that the
 * containment check below compares real paths (`/tmp` is a link to `/private/tmp` on
 * macOS). Falls back to a plain resolve when the root itself cannot be read.
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
    // A stale file is one inode; a directory is counted by walking it, which is the slow
    // part and the reason `--count` is opt-in.
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
