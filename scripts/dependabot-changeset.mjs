#!/usr/bin/env node
// @ts-check
/**
 * Writes the changeset a dependency-only bump needs, so a red `verify` on a bot pull
 * request carries information again (issue #421).
 *
 * ## The problem this closes
 *
 * Dependabot never writes changesets. `check:changeset` requires one whenever a diff
 * touches a publishable package, and a grouped npm bump touches `packages/*` manifests
 * routinely, so every such pull request fails the last gate of `verify` on both matrix
 * legs, deterministically, and is hand-fixed. PR #301 and PR #410 are the two recorded
 * instances. The cost is not the file: it is that a red `verify` on a dependency pull
 * request stops meaning "this bump broke something" and starts meaning "this bump
 * exists", and the two are indistinguishable from the check summary. PR #410 had a real
 * failure (#419) sitting behind a red that was pure ceremony.
 *
 * The changeset is genuinely wanted - a dependency move inside a published package is a
 * consumer-visible change - so this generates it rather than exempting it.
 *
 * ## Why this is run by hand
 *
 * The obvious next step is a workflow that runs this on the bot's own pull request and
 * pushes the result. It is deliberately not taken (Code Owner ruling, 2026-09-05). Such
 * a workflow needs `contents: write` on a bot-triggered run, and then `actions: write`
 * on top: a push made with `GITHUB_TOKEN` raises no `pull_request` event, so the new
 * head would carry no runs at all and every required context would sit at "Expected",
 * which is worse than the red it replaces. Dependabot pull requests are infrequent and
 * are triaged anyway, so one command is the right surface for the cost, and no
 * write-capable workflow runs on a bot trigger.
 *
 * ## What it will and will not generate
 *
 * It writes a changeset ONLY for the shape it can describe honestly: every non-exempt
 * file that changed inside a publishable package is that package's own `package.json`,
 * and the only fields that moved there are dependency ranges. Anything else - a source
 * file, a `files` entry, an `exports` change riding along - is refused, loudly, naming
 * what it saw. That refusal is the acceptance criterion of #421 working: the pull
 * request then fails for a reason specific to it rather than for being a bot's.
 *
 * The bump level is derived, on the precedent this repository already set. A move in
 * `peerDependencies` is `minor`, because that range IS part of the published contract
 * (`@roonga/qcms-db/testing` asks a consumer to install the peers it names, issue #156,
 * and `.changeset/deps-410-grouped-minor-and-patch.md` chose minor for exactly that).
 * Everything else is `patch`: the package's own API is unchanged and a consumer only
 * resolves newer in-range versions.
 *
 * Usage:  node scripts/dependabot-changeset.mjs [--write]
 *         pnpm changeset:dependabot -- --write
 * Env:    DEFAULT_BRANCH (default "main") - the branch the diff is taken against.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findPublishablePackages,
  isExemptPath,
  parseChangesetPackages,
} from "./check-changeset.mjs";

/**
 * One dependency range that moved between two revisions of a manifest.
 *
 * @typedef {{ field: string, name: string, from: string, to: string }} DependencyMove
 */

/**
 * One package's line in the changeset: what to name, what bump it earns, and the moves
 * the body describes. Named rather than written inline at each of the four places it
 * appears, because the shape has to be the SAME shape at all of them: `plan()` builds
 * it and `renderChangeset()` consumes it, and the two agreeing is the whole contract
 * between the halves of this file.
 *
 * @typedef {{ name: string, bump: "minor" | "patch", moves: DependencyMove[] }} PackageEntry
 */

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? "main";

/** The manifest fields a dependency bump is allowed to touch. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** The one field whose range is part of what a consumer resolves against. */
const CONTRACT_FIELD = "peerDependencies";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

/** Resolve a ref that points at the default branch tip, or undefined. */
function resolveBaseRef() {
  for (const ref of [`origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined) return ref;
  }
  return undefined;
}

/**
 * Every dependency range that moved between two manifests, and whether anything
 * outside the dependency fields moved with it.
 *
 * The "anything else" answer is what makes the refusal reliable: comparing the two
 * manifests with their dependency blocks removed catches a `files`, `exports` or
 * `version` edit riding inside the same diff, which is a change this file has no
 * business describing as dependency maintenance.
 *
 * @param {string} beforeText
 * @param {string} afterText
 * @returns {{ moves: DependencyMove[], otherFieldsChanged: boolean }}
 */
export function manifestDependencyMoves(beforeText, afterText) {
  const before = JSON.parse(beforeText);
  const after = JSON.parse(afterText);
  const moves = [];
  for (const field of DEPENDENCY_FIELDS) {
    const from = before[field] ?? {};
    const to = after[field] ?? {};
    for (const name of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
      const wasRange = from[name];
      const isRange = to[name];
      if (wasRange === isRange) continue;
      moves.push({
        field,
        name,
        from: typeof wasRange === "string" ? wasRange : "(absent)",
        to: typeof isRange === "string" ? isRange : "(removed)",
      });
    }
  }
  const strip = (manifest) => {
    const rest = { ...manifest };
    for (const field of DEPENDENCY_FIELDS) delete rest[field];
    return JSON.stringify(rest);
  };
  return { moves, otherFieldsChanged: strip(before) !== strip(after) };
}

/**
 * The bump a package's moves earn.
 *
 * @param {{ field: string }[]} moves
 * @returns {"minor" | "patch"}
 */
export function bumpFor(moves) {
  return moves.some((move) => move.field === CONTRACT_FIELD) ? "minor" : "patch";
}

/**
 * A changeset file name derived from the branch, so a second run on the same branch
 * rewrites its own file rather than adding a second one.
 *
 * @param {string} branch
 * @returns {string}
 */
export function changesetFileName(branch) {
  const slug = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    // Dependabot's own branches start with the word, and the prefix below adds it back.
    .replace(/^dependabot-/, "")
    .slice(0, 60);
  return `dependabot-${slug === "" ? "deps" : slug}.md`;
}

/**
 * The changeset body: frontmatter naming each package, then the moves, grouped by
 * package and split into what a consumer resolves and what it does not.
 *
 * @param {PackageEntry[]} entries
 * @returns {string}
 */
export function renderChangeset(entries) {
  const frontmatter = entries.map((entry) => `"${entry.name}": ${entry.bump}`).join("\n");
  const sections = entries.map((entry) => {
    const consumerFacing = entry.moves.filter((move) => move.field !== "devDependencies");
    const development = entry.moves.filter((move) => move.field === "devDependencies");
    const line = (move) => `- \`${move.name}\` ${move.from} to ${move.to} (${move.field})`;
    const parts = [`**${entry.name}**`];
    if (consumerFacing.length > 0) {
      parts.push(
        "",
        "Ranges a consumer resolves against:",
        "",
        ...consumerFacing.map((move) => line(move)),
      );
    }
    if (development.length > 0) {
      parts.push(
        "",
        "Development ranges, which reach no consumer:",
        "",
        ...development.map((move) => line(move)),
      );
    }
    return parts.join("\n");
  });
  return [
    "---",
    frontmatter,
    "---",
    "",
    "Dependency maintenance. No source in these packages changed and their public APIs",
    "are identical; only the ranges below moved.",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

/**
 * Everything the generator needs to decide, from a diff.
 *
 * @param {string} mergeBase
 * @returns {{ entries: PackageEntry[], refusal?: string, alreadyCovered: string[] }}
 */
function plan(mergeBase) {
  const nameStatus = git(["diff", "--name-status", "-M", mergeBase, "HEAD"]);
  /** @type {{ status: string, paths: string[] }[]} */
  const changes = [];
  for (const line of nameStatus.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    changes.push({ status: parts[0] ?? "", paths: parts.slice(1) });
  }

  const packages = findPublishablePackages();
  /** @type {Map<string, string[]>} */
  const touched = new Map();
  for (const change of changes) {
    for (const filePath of change.paths) {
      if (isExemptPath(filePath)) continue;
      const owner = packages.find((pkg) => filePath.startsWith(`${pkg.dir}/`));
      if (owner === undefined) continue;
      const files = touched.get(owner.name) ?? [];
      if (!files.includes(filePath)) files.push(filePath);
      touched.set(owner.name, files);
    }
  }

  const declared = new Set();
  for (const change of changes) {
    if (change.status.startsWith("D")) continue;
    const filePath = change.paths.at(-1) ?? "";
    if (!/^\.changeset\/.+\.md$/.test(filePath) || filePath === ".changeset/README.md") continue;
    const content = tryGit(["show", `HEAD:${filePath}`]);
    if (content === undefined) continue;
    for (const name of parseChangesetPackages(content)) declared.add(name);
  }

  /** @type {PackageEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const alreadyCovered = [];
  for (const [name, files] of [...touched].sort(([a], [b]) => a.localeCompare(b))) {
    if (declared.has(name)) {
      alreadyCovered.push(name);
      continue;
    }
    const pkg = packages.find((candidate) => candidate.name === name);
    if (pkg === undefined) continue;
    const manifestPath = `${pkg.dir}/package.json`;
    const unexpected = files.filter((file) => file !== manifestPath);
    if (unexpected.length > 0) {
      return {
        entries: [],
        alreadyCovered,
        refusal:
          `${name} changed more than its manifest, so this is not a dependency-only bump:\n` +
          unexpected.map((file) => `    ${file}`).join("\n"),
      };
    }
    const beforeText = tryGit(["show", `${mergeBase}:${manifestPath}`]);
    const afterText = tryGit(["show", `HEAD:${manifestPath}`]);
    if (beforeText === undefined || afterText === undefined) {
      return {
        entries: [],
        alreadyCovered,
        refusal: `could not read both revisions of ${manifestPath}`,
      };
    }
    const { moves, otherFieldsChanged } = manifestDependencyMoves(beforeText, afterText);
    if (otherFieldsChanged) {
      return {
        entries: [],
        alreadyCovered,
        refusal: `${manifestPath} changed a field outside its dependency blocks`,
      };
    }
    if (moves.length === 0) continue;
    entries.push({ name, bump: bumpFor(moves), moves });
  }
  return { entries, alreadyCovered };
}

/** @returns {number} process exit code */
function main() {
  const write = process.argv.includes("--write");
  const baseRef = resolveBaseRef();
  if (baseRef === undefined) {
    console.warn(
      `dependabot-changeset: no "${DEFAULT_BRANCH}" ref found; nothing to diff against.`,
    );
    return 0;
  }
  const mergeBase = (tryGit(["merge-base", baseRef, "HEAD"]) ?? baseRef).trim();
  const { entries, refusal, alreadyCovered } = plan(mergeBase);

  if (refusal !== undefined) {
    console.error(`dependabot-changeset: refusing to generate a changeset.\n\n  ${refusal}\n`);
    console.error(
      "Write the changeset by hand (`pnpm changeset`), describing what actually changed.\n",
    );
    return 1;
  }

  if (entries.length === 0) {
    const covered =
      alreadyCovered.length > 0 ? ` (already named: ${alreadyCovered.join(", ")})` : "";
    console.log(`dependabot-changeset: nothing to generate${covered}.`);
    return 0;
  }

  // `GITHUB_HEAD_REF` first because a workflow checkout is often detached, where
  // `rev-parse --abbrev-ref HEAD` answers the literal "HEAD" and every bot pull request
  // would then claim the same file name.
  const named = process.env.GITHUB_HEAD_REF ?? tryGit(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "";
  const branch = named.trim() === "" || named.trim() === "HEAD" ? "deps" : named.trim();
  const fileName = changesetFileName(branch);
  const body = renderChangeset(entries);

  if (!write) {
    console.log(`dependabot-changeset: would write .changeset/${fileName}\n`);
    console.log(body);
    return 0;
  }

  writeFileSync(join(".changeset", fileName), body);
  console.log(`dependabot-changeset: wrote .changeset/${fileName}`);
  return 0;
}

// Run as a script; stay silent when imported by the self-test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
