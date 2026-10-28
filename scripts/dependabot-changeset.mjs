#!/usr/bin/env node
// @ts-check
/**
 * Writes the changeset `check:changeset` wants for a dependency-only bump and
 * regenerates the scaffolding templates `check:templates` wants, because a bot bump
 * breaks both gates and fixing one hides the other.
 *
 * It generates a changeset ONLY for the shape it can describe honestly: dependency
 * ranges in a package's own manifest or in a generated template app manifest.
 * Anything else is refused loudly, so the pull request fails for a reason specific to
 * it rather than for being a bot's.
 *
 * Run by hand, never from a workflow (Code Owner ruling): a push made with
 * `GITHUB_TOKEN` raises no `pull_request` event, so the new head would carry no runs
 * and every required context would sit at "Expected".
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
 * `scope` names the generated app manifest a move came from, and is absent for a move
 * in a package's own manifest.
 *
 * @typedef {{ field: string, name: string, from: string, to: string, scope?: string }} DependencyMove
 */

/**
 * `templateMoves` stays apart from `moves` because the two reach a consumer by
 * different routes: one the package resolves, the other is stamped into a project the
 * scaffolding CLI creates.
 *
 * @typedef {{
 *   name: string,
 *   bump: "minor" | "patch",
 *   moves: DependencyMove[],
 *   templateMoves?: DependencyMove[],
 * }} PackageEntry
 */

/**
 * Seams a test replaces; production passes none of them.
 *
 * @typedef {{
 *   cwd?: string,
 *   templates?: Map<string, string>,
 *   current?: Map<string, string>,
 *   syncTemplates?: () => unknown,
 * }} Options
 */

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH ?? "main";

const TEMPLATE_PACKAGE_DIR = TEMPLATE_DIR.slice(0, TEMPLATE_DIR.lastIndexOf("/"));

const TEMPLATE_APP_MANIFEST = new RegExp(`^${TEMPLATE_DIR}/common/apps/([^/]+)/package\\.json$`);

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

/** @param {string | undefined} cwd */
function resolveBaseRef(cwd) {
  for (const ref of [`origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd) !== undefined) {
      return ref;
    }
  }
  return undefined;
}

/**
 * Comparing the manifests with their dependency blocks removed is what makes the
 * refusal reliable: it catches a `files`, `exports` or `version` edit riding along.
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
 * @param {{ field: string }[]} moves
 * @returns {"minor" | "patch"}
 */
export function bumpFor(moves) {
  return moves.some((move) => move.field === CONTRACT_FIELD) ? "minor" : "patch";
}

/**
 * The narrowness is the point: only a generated manifest is describable dependency
 * maintenance, never a generated source file or a hand-written static template.
 *
 * @param {string} filePath
 * @returns {string | undefined}
 */
export function templateManifestApp(filePath) {
  return TEMPLATE_APP_MANIFEST.exec(filePath)?.[1];
}

/**
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
 * A non-empty `others` is a refusal rather than a silent omission: something
 * regenerated for a reason that is not a dependency range would make a changeset
 * saying "only the ranges below moved" false.
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
 * Derived from the branch, so a second run rewrites its own file rather than adding a
 * second one.
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
      // Not split into consumer-facing and development the way a package's own manifest is:
      // every range here, dev ranges included, is stamped into the project the CLI creates.
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
 * Drift is assembled from two directions: a template already re-synced and committed
 * shows up in the diff against the base, one not yet re-synced shows up as a
 * disagreement between the generated tree and the working tree.
 *
 * @param {string} mergeBase
 * @param {string | undefined} cwd
 * @param {Map<string, string>} templates
 * @param {Map<string, string>} current
 * @param {string[]} committed
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
    // A generated template manifest is a describable dependency shape, so it does not
    // count against the package that ships it. Everything else does.
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
    // A failing generator assertion is a problem with the branch rather than something
    // to describe in a changelog entry, so report its message instead of crashing.
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
 * Async because the regeneration it delegates to hands its output to Prettier, so no
 * separate `pnpm format` is needed.
 *
 * @param {string[]} args
 * @param {Options} options
 * @returns {Promise<number>} process exit code
 */
export async function main(args = process.argv.slice(2), options = {}) {
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

  // Regenerated on every `--write`, drift or none: the generator is idempotent, and
  // asking unconditionally is what makes this one command rather than two.
  if (write) await (options.syncTemplates ?? (() => syncTemplates(["--write"])))();
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
  // `rev-parse --abbrev-ref HEAD` answers the literal "HEAD" for every pull request.
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
