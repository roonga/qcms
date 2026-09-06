#!/usr/bin/env node
// @ts-check
/**
 * Makes a dependency-only bump satisfy this repository's conventions in one command, so
 * a red `verify` on a bot pull request carries information again (issues #421, #834).
 *
 * It does two things, because a bump breaks two gates and fixing one hides the other:
 * it writes the changeset `check:changeset` wants, and it regenerates the scaffolding
 * templates `check:templates` wants.
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
 * ## The second gate, and why it was invisible (issue #834)
 *
 * `packages/create-qcms-app/templates/common/apps/*\/package.json` are GENERATED from
 * `apps/*\/package.json` by the scaffolding generator, and Dependabot's npm updater only
 * edits workspace members, so every bump that reaches an app manifest leaves those
 * templates stale and `check:templates` red. Nobody saw it until `check:changeset` was
 * fixed, because `check:all` short-circuits at the earlier gate: closing the changeset
 * half of #421 is what made the template half visible, one gate at a time, on PR #821.
 *
 * Re-syncing then touches `create-qcms-app`, a publishable package, whose changed files
 * are NOT its own manifest - so the refusal below fired correctly and a second changeset
 * had to be hand-written. Both halves are handled here instead: the generated app
 * manifests are recognised as a describable dependency shape, they are named in the same
 * changeset, and `--write` regenerates the tree so the gate is green.
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
 * file that changed inside a publishable package is that package's own `package.json`
 * or a generated template app manifest, and the only fields that moved in either are
 * dependency ranges. Anything else - a source file, a `files` entry, an `exports` change
 * riding along, a template file the regeneration rewrote for some other reason - is
 * refused, loudly, naming what it saw. That refusal is the acceptance criterion of #421
 * working: the pull request then fails for a reason specific to it rather than for being
 * a bot's. The template half is held to the same standard, and refuses the same way.
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
  buildTemplates,
  currentTemplates,
  main as syncTemplates,
  TEMPLATE_DIR,
} from "../packages/create-qcms-app/scripts/sync-templates.mjs";

import {
  findPublishablePackages,
  isExemptPath,
  parseChangesetPackages,
} from "./check-changeset.mjs";

/**
 * One dependency range that moved between two revisions of a manifest.
 *
 * `scope` names the generated app manifest a move came from (`apps/portal`), and is
 * absent for a move in a package's own manifest. It exists because one bump lands the
 * same range in all three generated manifests, and three identical lines that differ
 * only by which app they were read from describe the bump worse than one line does.
 *
 * @typedef {{ field: string, name: string, from: string, to: string, scope?: string }} DependencyMove
 */

/**
 * One package's line in the changeset: what to name, what bump it earns, and the moves
 * the body describes. Named rather than written inline at each of the four places it
 * appears, because the shape has to be the SAME shape at all of them: `plan()` builds
 * it and `renderChangeset()` consumes it, and the two agreeing is the whole contract
 * between the halves of this file.
 *
 * `templateMoves` is kept apart from `moves` rather than concatenated, because the two
 * reach a consumer by different routes and the changeset says so: a move in `moves` is a
 * range the package itself resolves, a move in `templateMoves` is a range stamped into
 * a project the scaffolding CLI creates.
 *
 * @typedef {{
 *   name: string,
 *   bump: "minor" | "patch",
 *   moves: DependencyMove[],
 *   templateMoves?: DependencyMove[],
 * }} PackageEntry
 */

/**
 * The seams a test replaces. Production passes none of them: the diff is the real
 * repository's, and the template tree is the real generator's.
 *
 * @typedef {{
 *   cwd?: string,
 *   templates?: Map<string, string>,
 *   current?: Map<string, string>,
 *   syncTemplates?: () => void,
 * }} Options
 */

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? "main";

/** The publishable package the generated templates live in, derived from their location. */
const TEMPLATE_PACKAGE_DIR = TEMPLATE_DIR.slice(0, TEMPLATE_DIR.lastIndexOf("/"));

/** The generated manifests a dependency bump is expected to move (issue #834). */
const TEMPLATE_APP_MANIFEST = new RegExp(`^${TEMPLATE_DIR}/common/apps/([^/]+)/package\\.json$`);

/** The manifest fields a dependency bump is allowed to touch. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** The one field whose range is part of what a consumer resolves against. */
const CONTRACT_FIELD = "peerDependencies";

function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", cwd });
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a ref that points at the default branch tip, or undefined.
 *
 * @param {string | undefined} cwd
 */
function resolveBaseRef(cwd) {
  for (const ref of [`origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd) !== undefined) {
      return ref;
    }
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
 * The app a generated template manifest belongs to, or undefined for any other path.
 *
 * The narrowness is the point. `templates/common/apps/portal/package.json` is a file
 * the generator writes from `apps/portal/package.json`, so a range that moved in it is
 * describable dependency maintenance; `templates/common/apps/portal/src/page.tsx` is
 * not, and neither is a hand-written file under `templates-static/`.
 *
 * @param {string} filePath repo-relative
 * @returns {string | undefined}
 */
export function templateManifestApp(filePath) {
  return TEMPLATE_APP_MANIFEST.exec(filePath)?.[1];
}

/**
 * One line per range that moved, however many generated manifests carry it.
 *
 * @param {DependencyMove[]} moves
 * @returns {DependencyMove[]}
 */
function mergeScopes(moves) {
  /** @type {Map<string, DependencyMove & { scopes: string[] }>} */
  const merged = new Map();
  for (const move of moves) {
    const key = `${move.field} ${move.name} ${move.from} ${move.to}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...move, scopes: move.scope === undefined ? [] : [move.scope] });
      continue;
    }
    if (move.scope !== undefined && !existing.scopes.includes(move.scope)) {
      existing.scopes.push(move.scope);
    }
  }
  return [...merged.values()].map(({ scopes, ...move }) => ({
    ...move,
    scope: scopes.length === 0 ? undefined : [...scopes].sort().join(", "),
  }));
}

/**
 * What the scaffolding templates contribute to the changeset, and what makes them
 * undescribable (issue #834).
 *
 * `manifests` is every generated app manifest with its base revision and the revision
 * the generator produces now; `others` is every other template path where those two
 * disagree. A non-empty `others` is a refusal rather than a silent omission: something
 * regenerated for a reason that is not a dependency range, and a changeset saying
 * "only the ranges below moved" would then be false.
 *
 * @param {{ path: string, before: string | undefined, after: string }[]} manifests
 * @param {string[]} others
 * @returns {{ moves: DependencyMove[], refusal?: string }}
 */
export function templateManifestMoves(manifests, others) {
  if (others.length > 0) {
    return {
      moves: [],
      refusal:
        "regenerating the scaffolding templates changed files that are not generated " +
        "app manifests, so this is not a dependency-only bump:\n" +
        [...others]
          .sort()
          .map((file) => `    ${file}`)
          .join("\n"),
    };
  }
  /** @type {DependencyMove[]} */
  const moves = [];
  for (const { path, before, after } of manifests) {
    if (before === undefined) {
      return { moves: [], refusal: `could not read the base revision of ${path}` };
    }
    if (before === after) continue;
    const scope = `apps/${templateManifestApp(path) ?? "?"}`;
    const result = manifestDependencyMoves(before, after);
    if (result.otherFieldsChanged) {
      return { moves: [], refusal: `${path} changed a field outside its dependency blocks` };
    }
    for (const move of result.moves) moves.push({ ...move, scope });
  }
  return { moves: mergeScopes(moves) };
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
    const templateMoves = entry.templateMoves ?? [];
    const line = (move) =>
      `- \`${move.name}\` ${move.from} to ${move.to} (${move.field}` +
      `${move.scope === undefined ? "" : ` in ${move.scope}`})`;
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
    if (templateMoves.length > 0) {
      // Not split into consumer-facing and development the way a package's own manifest
      // is: every range here, dev ranges included, is stamped into the project the CLI
      // creates, so an adopter installs all of them.
      parts.push(
        "",
        "Ranges in the app manifests this CLI stamps, regenerated from the canonical",
        "apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a",
        "newly scaffolded project installs the versions this repository resolves:",
        "",
        ...templateMoves.map((move) => line(move)),
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
 * The generated template manifests, their base revisions, and every other template path
 * the regeneration would rewrite.
 *
 * The "every other path" answer is assembled from two places because drift arrives from
 * two directions: a template file already re-synced and committed on the branch shows up
 * in the diff against the base, and one not yet re-synced shows up as a disagreement
 * between the generated tree and the working tree. A path that changed between the base
 * and what the generator produces now must appear in at least one of them.
 *
 * @param {string} mergeBase
 * @param {string | undefined} cwd
 * @param {Map<string, string>} templates generated
 * @param {Map<string, string>} current on disk
 * @param {string[]} committed repo-relative paths under the template package
 * @returns {{ moves: DependencyMove[], refusal?: string, drift: string[] }}
 */
function planTemplates(mergeBase, cwd, templates, current, committed) {
  /** @type {string[]} */
  const drift = [];
  for (const [path, contents] of templates) {
    if (current.get(path) !== contents) drift.push(`${TEMPLATE_DIR}/${path}`);
  }
  /** @type {string[]} */
  const stale = [];
  for (const path of current.keys()) {
    if (!templates.has(path)) stale.push(`${TEMPLATE_DIR}/${path}`);
  }

  const others = [...new Set([...drift, ...committed])].filter(
    (path) => templateManifestApp(path) === undefined,
  );
  const manifests = [...templates.keys()]
    .map((path) => `${TEMPLATE_DIR}/${path}`)
    .filter((path) => templateManifestApp(path) !== undefined)
    .sort()
    .map((path) => ({
      path,
      before: tryGit(["show", `${mergeBase}:${path}`], cwd),
      after: templates.get(path.slice(`${TEMPLATE_DIR}/`.length)) ?? "",
    }));

  const { moves, refusal } = templateManifestMoves(manifests, [...others, ...stale]);
  return { moves, refusal, drift: [...drift, ...stale].sort() };
}

/**
 * Everything the generator needs to decide, from a diff.
 *
 * @param {string} mergeBase
 * @param {Options} options
 * @returns {{
 *   entries: PackageEntry[],
 *   refusal?: string,
 *   alreadyCovered: string[],
 *   templateDrift: string[],
 * }}
 */
export function plan(mergeBase, options = {}) {
  const cwd = options.cwd;
  const nameStatus = git(["diff", "--name-status", "-M", mergeBase, "HEAD"], cwd);
  /** @type {{ status: string, paths: string[] }[]} */
  const changes = [];
  for (const line of nameStatus.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    changes.push({ status: parts[0] ?? "", paths: parts.slice(1) });
  }

  const packages = findPublishablePackages(cwd);
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
    const content = tryGit(["show", `HEAD:${filePath}`], cwd);
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
    // A generated template manifest is a describable dependency shape (issue #834),
    // so it does not count against the package that ships it. Everything else does.
    const unexpected = files.filter(
      (file) => file !== manifestPath && templateManifestApp(file) === undefined,
    );
    if (unexpected.length > 0) {
      return {
        entries: [],
        alreadyCovered,
        templateDrift: [],
        refusal:
          `${name} changed more than its manifest, so this is not a dependency-only bump:\n` +
          unexpected.map((file) => `    ${file}`).join("\n"),
      };
    }
    const beforeText = tryGit(["show", `${mergeBase}:${manifestPath}`], cwd);
    const afterText = tryGit(["show", `HEAD:${manifestPath}`], cwd);
    if (beforeText === undefined || afterText === undefined) {
      return {
        entries: [],
        alreadyCovered,
        templateDrift: [],
        refusal: `could not read both revisions of ${manifestPath}`,
      };
    }
    const { moves, otherFieldsChanged } = manifestDependencyMoves(beforeText, afterText);
    if (otherFieldsChanged) {
      return {
        entries: [],
        alreadyCovered,
        templateDrift: [],
        refusal: `${manifestPath} changed a field outside its dependency blocks`,
      };
    }
    if (moves.length === 0) continue;
    entries.push({ name, bump: bumpFor(moves), moves });
  }

  const templatePackage = packages.find((pkg) => pkg.dir === TEMPLATE_PACKAGE_DIR);
  if (templatePackage === undefined) return { entries, alreadyCovered, templateDrift: [] };

  /** @type {Map<string, string>} */
  let templates;
  /** @type {Map<string, string>} */
  let current;
  try {
    templates = options.templates ?? buildTemplates();
    current = options.current ?? currentTemplates();
  } catch (error) {
    // The generator asserts a great deal about the apps it reads, and a failing
    // assertion is a real problem with the branch rather than something to describe in
    // a changelog entry. Say so with the message it gave rather than crashing.
    return {
      entries: [],
      alreadyCovered,
      templateDrift: [],
      refusal:
        "the scaffolding template generator failed, so the templates cannot be " +
        `regenerated or described:\n    ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const committed = (touched.get(templatePackage.name) ?? []).filter(
    (file) => file !== `${templatePackage.dir}/package.json`,
  );
  const templatePlan = planTemplates(mergeBase, cwd, templates, current, committed);
  if (templatePlan.refusal !== undefined) {
    return { entries: [], alreadyCovered, templateDrift: [], refusal: templatePlan.refusal };
  }
  if (templatePlan.moves.length > 0) {
    if (declared.has(templatePackage.name)) {
      if (!alreadyCovered.includes(templatePackage.name)) {
        alreadyCovered.push(templatePackage.name);
      }
    } else {
      const existing = entries.find((entry) => entry.name === templatePackage.name);
      const entry = existing ?? { name: templatePackage.name, bump: "patch", moves: [] };
      entry.templateMoves = templatePlan.moves;
      entry.bump = bumpFor([...entry.moves, ...templatePlan.moves]);
      if (existing === undefined) entries.push(entry);
      entries.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return { entries, alreadyCovered, templateDrift: templatePlan.drift };
}

/**
 * @param {string[]} args
 * @param {Options} options
 * @returns {number} process exit code
 */
export function main(args = process.argv.slice(2), options = {}) {
  const write = args.includes("--write");
  const cwd = options.cwd;
  const baseRef = resolveBaseRef(cwd);
  if (baseRef === undefined) {
    console.warn(
      `dependabot-changeset: no "${DEFAULT_BRANCH}" ref found; nothing to diff against.`,
    );
    return 0;
  }
  const mergeBase = (tryGit(["merge-base", baseRef, "HEAD"], cwd) ?? baseRef).trim();
  const { entries, refusal, alreadyCovered, templateDrift } = plan(mergeBase, options);

  if (refusal !== undefined) {
    console.error(`dependabot-changeset: refusing to generate a changeset.\n\n  ${refusal}\n`);
    console.error(
      "Write the changeset by hand (`pnpm changeset`), describing what actually changed.\n",
    );
    return 1;
  }

  // The templates are regenerated on every `--write`, drift or none: the generator is
  // idempotent, and asking it unconditionally is what makes this one command rather than
  // one command plus a judgement about whether the other one is needed (issue #834).
  if (write) (options.syncTemplates ?? (() => syncTemplates(["--write"])))();
  else if (templateDrift.length > 0) {
    console.log(
      `dependabot-changeset: ${templateDrift.length} scaffolding template file(s) would be ` +
        "regenerated; `--write` does it.",
    );
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
  const named =
    process.env.GITHUB_HEAD_REF ?? tryGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "";
  const branch = named.trim() === "" || named.trim() === "HEAD" ? "deps" : named.trim();
  const fileName = changesetFileName(branch);
  const body = renderChangeset(entries);

  if (!write) {
    console.log(`dependabot-changeset: would write .changeset/${fileName}\n`);
    console.log(body);
    return 0;
  }

  writeFileSync(join(cwd ?? ".", ".changeset", fileName), body);
  console.log(`dependabot-changeset: wrote .changeset/${fileName}`);
  return 0;
}

// Run as a script; stay silent when imported by the self-test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
