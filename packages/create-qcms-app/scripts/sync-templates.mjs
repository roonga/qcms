#!/usr/bin/env node
// @ts-check
/**
 * Generate `packages/create-qcms-app/templates/` from the canonical apps (task 037).
 *
 * ## Why this exists
 *
 * `create-qcms-app` stamps the owned application shell into an adopter's repository
 * (ADR-05: code a customizer would reasonably change is scaffolded source, code whose
 * modification would break audit or versioning guarantees is a versioned package).
 * The shell it stamps has to BE the shell this repository develops, or the CLI ships
 * a fork of the product that nobody runs and nobody notices going stale.
 *
 * So the templates are never hand-written. They are derived here, by a declared set
 * of transforms, from `apps/`, `docker/`, `docker-compose.yml` and the config
 * schema's environment reference. The derived tree is committed (an adopter's
 * `npm pack` tarball has to carry it), which is exactly the state that rots, so the
 * generator doubles as the gate: `--check` regenerates into memory and compares.
 * Change an app shell file without regenerating and `pnpm check:templates` fails
 * naming the file.
 *
 * ## Why generation is not wired into `build`
 *
 * It would be a lie about what turbo can see. `create-qcms-app#build` hashes this
 * package's own inputs; `apps/**` is not among them, so a cached build would skip
 * regeneration after exactly the change that needed it. Reaching `apps/**` through
 * `globalDependencies` would invalidate every task in the repository on every app
 * edit. The honest arrangement is an explicit script plus a gate that always runs:
 * `pnpm qcms:sync-templates` writes, `pnpm check:templates` (inside `check:all`,
 * which `pnpm verify` runs first) refuses drift.
 *
 * ## What the transforms are allowed to be
 *
 * Mechanical and declared, never editorial. Each one below carries the reason it
 * cannot be a byte copy:
 *
 *   1. **Test and harness files are dropped.** They are this repository's tooling
 *      (Testcontainers, Playwright, the seat-aware harness) and none of it exists in
 *      an adopter's tree. Note what this rule is NOT: build output is excluded a step
 *      earlier, by taking the file list from git ({@link repositoryFiles}) rather than
 *      from the working tree. A transform list can only drop what someone thought of;
 *      `.gitignore` already knows.
 *   2. **`workspace:*` becomes a real version range.** The adopter consumes the four
 *      packages from the registry; the range is read from each package's own
 *      `package.json` at generation time, so a version bump is drift the gate sees.
 *   3. **Undeclared `@qcms/*` imports are declared.** `apps/portal` and `apps/admin`
 *      both import packages they do not list, which works here only because pnpm
 *      hoists the workspace. Outside the workspace it does not. {@link assertImports}
 *      fails the generator rather than shipping a tree that cannot install.
 *   4. **The Dockerfiles lose their monorepo assumptions.** No `packages/`, no
 *      `scripts/`, and `--filter <app>...` (build the workspace dependencies too)
 *      becomes `--filter <app>`, because there are none to build.
 *   5. **Compose forwards `QCMS_ADMIN_2FA`.** The CLI prompts for the admin 2FA
 *      policy and the value has to reach the two services that read it. The
 *      canonical file is deliberately untouched: adding the passthrough there would
 *      move the variable into `scripts/env-reference.mjs`'s compose group, which is
 *      an operator-reference change this task has no business making.
 *   6. **`.env.example` is generated from the config schema**, by scanning the
 *      generated Compose files for interpolations and looking each name up in
 *      `ENV_REFERENCE` (itself asserted against `apps/api/src/config.ts`). A name
 *      Compose reads that the schema does not document fails the generator.
 *
 * Usage:
 *   node packages/create-qcms-app/scripts/sync-templates.mjs --write
 *   node packages/create-qcms-app/scripts/sync-templates.mjs --check
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ENV_REFERENCE } from "../../../scripts/env-reference.mjs";

/** Repository root, resolved from this file rather than the process cwd. */
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where the generated tree lives, repo-relative. */
export const TEMPLATE_DIR = "packages/create-qcms-app/templates";

/** The four packages an adopter consumes from the registry. */
const PUBLISHED_PACKAGES = ["@qcms/core", "@qcms/a2ui-compiler", "@qcms/db", "@qcms/ui"];

/**
 * Every `@qcms/*` package each scaffolded app must declare.
 *
 * Derived by hand from what the shell imports and then ENFORCED by
 * {@link assertImports}, which re-derives it from the generated sources: the list
 * here is the declaration, the scan is the proof. `apps/portal` and `apps/admin`
 * under-declare in this repository (transform 3), so this cannot be a copy of their
 * `package.json` files.
 */
const APP_QCMS_DEPENDENCIES = {
  api: ["@qcms/a2ui-compiler", "@qcms/core", "@qcms/db"],
  portal: ["@qcms/core", "@qcms/ui"],
  admin: ["@qcms/a2ui-compiler", "@qcms/core", "@qcms/db", "@qcms/ui"],
};

/** Scripts an app keeps in the scaffold; everything else is this repository's. */
const APP_SCRIPTS = {
  api: ["build", "typecheck", "start", "create-admin"],
  portal: ["dev", "build", "start", "typecheck"],
  admin: ["dev", "build", "start", "typecheck"],
};

/**
 * devDependencies every scaffolded app needs that no app in THIS repository declares,
 * because the workspace root provides them (transform 7).
 *
 * Found by the scaffold e2e, not by reading: `pnpm -r typecheck` inside a freshly
 * scaffolded project picked up whichever TypeScript happened to be hoisted out of a
 * transitive dependency and failed with three inference errors that do not exist
 * here. An app that ships a `typecheck` script has to ship the compiler that runs it.
 *
 * The range is read from the repository root at generation time, so a root bump is
 * drift the gate sees.
 */
const ROOT_PROVIDED_DEV_DEPENDENCIES = ["typescript"];

/** devDependencies that exist only for this repository's test harness. */
const HARNESS_DEV_DEPENDENCIES = new Set([
  "@testcontainers/postgresql",
  "@seriousme/openapi-schema-validator",
  "otplib",
]);

/** App-relative paths dropped wholesale: repository tooling, not shell source. */
const APP_EXCLUDED_PATHS = new Set([
  "README.md",
  "CONTRIBUTING.md",
  ".env.example",
  "src/test-support.ts",
  "scripts/generate-openapi.mjs",
  "scripts/seed-fixtures.ts",
]);

/** Directory names that are this repository's harness wherever they appear in an app. */
const EXCLUDED_APP_DIRECTORIES = new Set(["e2e", "__snapshots__"]);

/**
 * True when an app-relative path is this repository's tooling rather than shell source.
 *
 * Every rule here is about a file that IS part of the repository and still must not be
 * scaffolded. Build output is not in scope: that is excluded upstream by taking the
 * file list from git ({@link repositoryFiles}) rather than from the working tree.
 */
export function isExcludedAppPath(path) {
  if (APP_EXCLUDED_PATHS.has(path)) return true;
  if (/\.test\.[cm]?[jt]sx?$/.test(path)) return true;
  if (path.split("/").some((segment) => EXCLUDED_APP_DIRECTORIES.has(segment))) return true;
  return path.endsWith("/README.md");
}

// --- the source file list ---------------------------------------------------

/**
 * Absolute locations git is installed to.
 *
 * Probed rather than resolved through `PATH`: a subprocess launched by bare name is
 * what `sonarjs/no-os-command-from-path` exists to stop, and the rule is
 * workspace-wide (issue #119). Order is by likelihood on Debian and Ubuntu, which is
 * what the dev container is.
 */
const GIT_CANDIDATES = ["/usr/bin/git", "/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

function gitBinary() {
  const override = process.env["QCMS_GIT_BIN"];
  if (override !== undefined && override !== "") return override;
  const found = GIT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `sync-templates: could not find git. Looked at: ${GIT_CANDIDATES.join(", ")}. ` +
        `Set QCMS_GIT_BIN to its absolute path.`,
    );
  }
  return found;
}

/**
 * Every repository file under `prefix`, from GIT rather than from the working tree.
 *
 * ## Why this is not a directory walk
 *
 * It used to be, and that is the defect this function exists to close. A walk sees
 * whatever is on the developer's disk, and an app directory holds build output that
 * is deliberately git-ignored: `next-env.d.ts` and a 690 KB `tsconfig.tsbuildinfo`
 * per Next app. Those were swept into the generated tree, committed, published inside
 * the package's `files` array, and stamped into every adopter's project. Worse, once
 * committed the gate FROZE them: `--check` passed on the machine that had them and
 * failed on a clean checkout, naming four files the next developer never touched. A
 * skip list cannot fix that, because it enumerates the artifacts someone already
 * thought of; git already knows the answer and is never out of date.
 *
 * `--cached --others --exclude-standard` is "tracked, plus untracked that is not
 * ignored". The `--others` half matters: a source file added but not yet `git add`ed
 * is still part of the app, and omitting it would make the generator's output depend
 * on staging order. Anything in `.gitignore` is excluded by construction, whether or
 * not anyone predicted it.
 *
 * Deleted-but-still-tracked paths are dropped rather than read, so a dirty tree
 * degrades into a `stale:` report from the gate instead of an unhandled read error.
 *
 * @param {string} prefix repo-relative directory
 * @returns {string[]} repo-relative POSIX paths, sorted, deduplicated
 */
export function repositoryFiles(prefix) {
  const output = execFileSync(
    gitBinary(),
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", prefix],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const paths = [...new Set(output.split("\n").filter((line) => line !== ""))];
  return paths.filter((path) => existsSync(join(REPOSITORY_ROOT, path))).sort();
}

// --- filesystem -------------------------------------------------------------

/**
 * Every file under `root` (repo-relative), sorted. Unfiltered, deliberately.
 *
 * Only generated and hand-written TEMPLATE trees are read this way, and for those the
 * right answer is "everything that is there". A skip list here was the mirror image
 * of the bug above: `currentTemplates()` filtered directory names while the CLI's own
 * stamping walk (`src/templates.ts`) does not, so a file committed under, say,
 * `templates/common/apps/api/dist/` would ship and stamp while being invisible to the
 * gate (issue #450). Reading everything makes the gate's view and the CLI's view the
 * same view.
 *
 * @param {string} root repo-relative directory
 * @returns {string[]} repo-relative POSIX paths
 */
export function walk(root) {
  const absolute = join(REPOSITORY_ROOT, root);
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...walk(posix.join(root, entry.name)));
    else if (entry.isFile()) found.push(posix.join(root, entry.name));
  }
  return found.sort();
}

/** Read a repo-relative file as UTF-8. */
function read(path) {
  return readFileSync(join(REPOSITORY_ROOT, path), "utf8");
}

/** Read and parse a repo-relative JSON file. */
function readJson(path) {
  return JSON.parse(read(path));
}

// --- package.json transforms ------------------------------------------------

/** The version range the scaffold pins each published package at. */
export function publishedVersions() {
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of PUBLISHED_PACKAGES) {
    const directory = name.replace("@qcms/", "");
    const manifest = readJson(`packages/${directory}/package.json`);
    versions[name] = `^${manifest.version}`;
  }
  return versions;
}

/**
 * Rewrite one dependency block: `workspace:*` to a real range, harness deps dropped.
 *
 * @param {Record<string, string> | undefined} block
 * @param {Record<string, string>} versions
 * @param {boolean} dropHarness
 */
function rewriteDependencies(block, versions, dropHarness) {
  /** @type {Record<string, string>} */
  const rewritten = {};
  for (const [name, range] of Object.entries(block ?? {})) {
    if (dropHarness && HARNESS_DEV_DEPENDENCIES.has(name)) continue;
    if (PUBLISHED_PACKAGES.includes(name)) continue;
    rewritten[name] = range === "workspace:*" ? (versions[name] ?? range) : range;
  }
  return rewritten;
}

/** Sort an object's keys, the way a package manager writes a manifest. */
function sortKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * The scaffolded app manifest: registry versions, no harness, no repo scripts.
 *
 * @param {"api" | "portal" | "admin"} app
 * @param {Record<string, string>} versions
 */
export function appManifest(app, versions) {
  const source = readJson(`apps/${app}/package.json`);
  /** @type {Record<string, string>} */
  const scripts = {};
  for (const name of APP_SCRIPTS[app]) {
    const script = source.scripts[name];
    if (script === undefined) {
      throw new Error(`apps/${app}/package.json no longer defines the "${name}" script.`);
    }
    scripts[name] = script;
  }
  const dependencies = rewriteDependencies(source.dependencies, versions, false);
  for (const name of APP_QCMS_DEPENDENCIES[app]) dependencies[name] = versions[name];
  const devDependencies = rewriteDependencies(source.devDependencies, versions, true);
  const root = readJson("package.json");
  for (const name of ROOT_PROVIDED_DEV_DEPENDENCIES) {
    const range = root.devDependencies[name];
    if (range === undefined) {
      throw new Error(
        `The repository root no longer declares ${name}, which every scaffolded app needs.`,
      );
    }
    devDependencies[name] = range;
  }
  return {
    name: source.name,
    version: "0.0.0",
    private: true,
    license: source.license,
    type: source.type,
    ...(source.main === undefined ? {} : { main: source.main, types: source.types }),
    scripts,
    dependencies: sortKeys(dependencies),
    devDependencies: sortKeys(devDependencies),
  };
}

// --- monorepo-relative asset paths ------------------------------------------

/**
 * A reach out of an app and into `packages/ui/src`, which only a monorepo has.
 *
 * Three shapes use it and none of them is a JavaScript import, which is why the
 * dependency scan never saw them: `@import` of the theme sheets, Tailwind's
 * `@source` content glob, and a `url()` at a self-hosted font. In this workspace
 * they resolve because the package is a sibling directory; in a scaffold there is no
 * `packages/`, and `next build` fails inside the image with
 * `Can't resolve '../../../packages/ui/src/theme.css'` (found by the scaffold e2e).
 */
const UI_SOURCE_REFERENCE = /(?:\.\.\/)+packages\/ui\/src/g;

/**
 * The same reference, resolved through the installed package instead.
 *
 * A relative path into `node_modules` rather than the bare `@qcms/ui/theme.css`
 * specifier, deliberately: only three of these files are exported subpaths, and the
 * font `url()` and the Tailwind `@source` glob are not resolved by anything that
 * reads an exports map. One rule that is correct for all three beats two rules that
 * each cover part of the problem.
 *
 * @param {string} text
 * @param {string} appRelative the file's path within its app, so the depth is right
 */
export function rewriteUiAssetPaths(text, appRelative) {
  const depth = appRelative.split("/").length - 1;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  return text.replaceAll(UI_SOURCE_REFERENCE, `${prefix}node_modules/@qcms/ui/src`);
}

/**
 * Fail if any generated file still reaches for a directory the scaffold has not got.
 *
 * The counterpart to {@link assertImports} for everything that is not a JavaScript
 * import. Comments are exempt: several files legitimately explain where a generated
 * sheet came from, and rewriting prose would be editorial rather than mechanical.
 *
 * @param {Map<string, string>} tree
 */
export function assertNoMonorepoPaths(tree) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, contents] of tree) {
    if (!path.startsWith("common/apps/")) continue;
    for (const line of contents.split("\n")) {
      const code = line.replace(/^\s*(\*|\/\/|#).*$/, "");
      if (UI_SOURCE_REFERENCE.test(code)) problems.push(`${path}: ${line.trim()}`);
      UI_SOURCE_REFERENCE.lastIndex = 0;
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `sync-templates: these generated files still reach into packages/, which a scaffold has not got.\n  ${problems.join("\n  ")}\n` +
        `Extend rewriteUiAssetPaths in ${GENERATOR_PATH}.`,
    );
  }
}

// --- import surface ---------------------------------------------------------

/** `@qcms/<name>` specifiers, from imports and from CSS `@source`/`url()` references. */
const QCMS_SPECIFIER = /@qcms\/(core|a2ui-compiler|db|ui)\b/g;

/**
 * Fail unless every `@qcms/*` package the generated app sources reach is declared.
 *
 * This is transform 3's proof. It runs over the GENERATED tree, so a file dropped by
 * the strip rules cannot keep a dependency alive, and a newly added import that
 * nobody declared fails the generator rather than the adopter's install.
 *
 * @param {Map<string, string>} tree template-relative path to contents
 */
export function assertImports(tree) {
  const problems = Object.entries(APP_QCMS_DEPENDENCIES).flatMap(([app, declared]) =>
    compareImports(app, declared, packagesUsedBy(tree, `common/apps/${app}/`)),
  );
  if (problems.length > 0) {
    throw new Error(
      `sync-templates: the scaffolded @qcms/* dependency set is wrong.\n  ${problems.join("\n  ")}\n` +
        `Fix APP_QCMS_DEPENDENCIES in ${GENERATOR_PATH}.`,
    );
  }
}

/** This file, repo-relative, for the error message above. */
const GENERATOR_PATH = "packages/create-qcms-app/scripts/sync-templates.mjs";

/**
 * Every `@qcms/*` package the files under `prefix` reach, mapped to one file that
 * proves it, so an error can name a line an author can go and look at.
 *
 * @param {Map<string, string>} tree
 * @param {string} prefix
 * @returns {Map<string, string>}
 */
function packagesUsedBy(tree, prefix) {
  /** @type {Map<string, string>} */
  const used = new Map();
  for (const [path, contents] of tree) {
    if (!path.startsWith(prefix) || path.endsWith("package.json")) continue;
    for (const [specifier] of contents.matchAll(QCMS_SPECIFIER)) {
      if (!used.has(specifier)) used.set(specifier, path);
    }
  }
  return used;
}

/**
 * Both directions of the declared-versus-used comparison.
 *
 * The unused direction matters as much as the missing one: a dependency nobody
 * imports is one an adopter installs, audits and upgrades for nothing.
 *
 * @param {string} app
 * @param {string[]} declared
 * @param {Map<string, string>} used
 * @returns {string[]}
 */
function compareImports(app, declared, used) {
  /** @type {string[]} */
  const problems = [];
  for (const [specifier, path] of used) {
    if (!declared.includes(specifier)) {
      problems.push(`${path} imports ${specifier}, which apps/${app} does not declare.`);
    }
  }
  for (const specifier of declared) {
    if (!used.has(specifier)) {
      problems.push(`apps/${app} declares ${specifier}, which no scaffolded file imports.`);
    }
  }
  return problems;
}

// --- docker -----------------------------------------------------------------

/**
 * A Dockerfile without its monorepo assumptions (transform 4).
 *
 * @param {string} text
 * @param {string} app
 */
export function transformDockerfile(text, app) {
  const workspaceBuild = `--filter ${app}... build`;
  if (!text.includes(workspaceBuild)) {
    throw new Error(
      `The ${app} Dockerfile no longer contains "${workspaceBuild}". The scaffold has no ` +
        `packages/ to build, so that line is what the transform exists to rewrite.`,
    );
  }
  return text
    .split("\n")
    .filter((line) => line !== "COPY packages ./packages" && line !== "COPY scripts ./scripts")
    .join("\n")
    .replace(workspaceBuild, `--filter ${app} build`);
}

/** The two services that read the admin 2FA policy (SEC-1, ADR-24's flag registry). */
const TWO_FACTOR_SERVICES = ["QCMS_MOUNT: all", "QCMS_ADMIN_TRUSTED_PROXY_HOPS:"];

/**
 * Compose with the `QCMS_ADMIN_2FA` passthrough the CLI's prompt needs (transform 5).
 *
 * Inserted beside two anchors that already exist in the file rather than appended to
 * a service block by line number, so a reordered file fails loudly instead of
 * silently putting the variable on the wrong service.
 *
 * @param {string} text
 */
export function transformCompose(text) {
  let out = text;
  for (const anchor of TWO_FACTOR_SERVICES) {
    const index = out.indexOf(anchor);
    if (index === -1) {
      throw new Error(`docker-compose.yml no longer contains the anchor "${anchor}".`);
    }
    const indent = " ".repeat(out.slice(0, index).length - out.lastIndexOf("\n", index) - 1);
    out =
      out.slice(0, index) +
      `QCMS_ADMIN_2FA: \${QCMS_ADMIN_2FA:-required}\n${indent}` +
      out.slice(index);
  }
  return out;
}

// --- .env.example -----------------------------------------------------------

/** `${NAME}`, `${NAME:-default}`, `${NAME:?message}` in a Compose file. */
const COMPOSE_INTERPOLATION = /\$\{([A-Z][A-Z0-9_]*)(:[-?])?/g;

/**
 * A whole comment line in a YAML file.
 *
 * `[ \t]` rather than `\s`, which matches newlines and makes the anchored, multiline
 * form backtrack super-linearly on a long file.
 */
const COMMENT_LINE = /^[ \t]*#[^\n]*$/gm;

/** Values Compose supplies itself, so an operator never sets them in `.env`. */
const COMPOSE_INTERNAL = new Set(["POSTGRES_USER", "POSTGRES_DB"]);

/**
 * The generated `.env.example`, from the schema's environment reference.
 *
 * Every name comes from the GENERATED Compose files, so the example can never
 * document a knob the scaffolded stack does not read, nor miss one it does. The
 * prose, requirement and default come from `scripts/env-reference.mjs`, which
 * `env-reference.test.ts` asserts against `apps/api/src/config.ts`. A Compose
 * interpolation the schema does not document throws rather than shipping a blank row.
 *
 * @param {{ text: string; alwaysRuns: boolean }[]} composeFiles the base topology
 *   (`alwaysRuns`) and the optional overlays. Only the base file's `${NAME:?}` forms
 *   make a variable mandatory: an overlay's are conditional on running the overlay,
 *   and writing them uncommented would tell every operator to fill in three blanks
 *   for a proxy most of them will not start.
 */
export function renderEnvExample(composeFiles) {
  /** Name to "does the base topology refuse to start without it" (`${NAME:?...}`). */
  const names = new Map();
  for (const { text, alwaysRuns } of composeFiles) {
    const withoutComments = text.replaceAll(COMMENT_LINE, "");
    for (const match of withoutComments.matchAll(COMPOSE_INTERPOLATION)) {
      if (COMPOSE_INTERNAL.has(match[1])) continue;
      const mandatory = alwaysRuns && match[2] === ":?";
      names.set(match[1], (names.get(match[1]) ?? false) || mandatory);
    }
  }
  /** @type {Map<string, { requirement: string; fallback: string; secret: boolean; description: string }>} */
  const documented = new Map();
  for (const entry of ENV_REFERENCE) {
    const existing = documented.get(entry.name);
    // A name read by more than one process keeps the strictest requirement: the
    // operator has to satisfy the strictest reader.
    if (existing !== undefined && existing.requirement === "required") continue;
    documented.set(entry.name, {
      requirement: entry.requirement,
      fallback: entry.fallback,
      secret: entry.secret === true,
      description: entry.description,
    });
  }
  const missing = [...names.keys()].filter((name) => !documented.has(name));
  if (missing.length > 0) {
    throw new Error(
      `sync-templates: the scaffolded Compose files read ${missing.join(", ")}, which ` +
        `scripts/env-reference.mjs does not document. Add the row there first.`,
    );
  }
  return renderEnvLines(names, documented);
}

const ENV_HEADER = `# Environment for the QCMS stack, generated from the API configuration schema.
#
# Every variable below is read by the Compose stack in this project. The prose,
# the requirement and the default all come from the schema, so this file cannot
# drift from what the services actually parse.
#
# create-qcms-app wrote a sibling \`.env\` with freshly generated random secrets and
# the answers you gave it. This file is the committed reference; \`.env\` is the one
# the stack reads, and it is git-ignored. Never commit a filled-in copy.
#
# Requirement legend:
#   required     the stack refuses to start without it
#   conditional  required once the feature that reads it is switched on
#   optional     safe to leave unset; the documented default applies
`;

/**
 * One block per variable: prose, a machine-readable marker line, then the assignment.
 *
 * A variable is written UNCOMMENTED only when the stack refuses to start without it:
 * either the schema calls it required, or Compose interpolates it as `${NAME:?...}`.
 * Everything else ships commented out, so an operator's `.env` says exactly what the
 * operator chose and the defaults stay in one place (the schema).
 *
 * The `# (requirement, secret, default ...)` line is not decoration: `fillEnv` in the
 * CLI reads it to decide which blanks it may fill with generated key material.
 *
 * @param {Map<string, boolean>} names name to "Compose refuses to start without it"
 */
function renderEnvLines(names, documented) {
  const lines = [ENV_HEADER];
  for (const name of [...names.keys()].sort()) {
    const entry = documented.get(name);
    const mandatory = names.get(name) === true || entry.requirement === "required";
    const parts = [entry.requirement];
    if (entry.secret) parts.push("secret");
    if (entry.fallback !== "") parts.push(`default ${entry.fallback}`);
    for (const line of wrap(plainText(entry.description))) lines.push(`# ${line}`);
    lines.push(`# (${parts.join(", ")})`);
    lines.push(mandatory ? `${name}=` : `# ${name}=`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Markdown emphasis and code spans, removed: this is a shell file, not a document. */
function plainText(text) {
  return text.replaceAll("**", "").replaceAll("`", "");
}

/** Greedy word wrap at 76 columns, leaving room for the `# ` prefix. */
function wrap(text) {
  /** @type {string[]} */
  const lines = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current === "") current = word;
    else if (`${current} ${word}`.length <= 76) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

// --- the tree ---------------------------------------------------------------

/**
 * The template path for a scaffold output path: every dot-file basename gets an
 * underscore instead.
 *
 * npm strips `.gitignore` and `.npmrc` from a published tarball no matter what
 * `files` says (`.gitignore` is renamed to `.npmignore`, `.npmrc` is dropped
 * outright), which silently deletes exactly the files a scaffolder exists to write.
 * Every scaffolder solves it the same way; the rule is applied to ALL dot-files
 * rather than the two npm names so nobody has to remember which two.
 *
 * @param {string} path a POSIX path relative to the scaffold root
 */
export function templateName(path) {
  const segments = path.split("/");
  const last = segments.length - 1;
  const basename = segments[last] ?? "";
  segments[last] = basename.startsWith(".") ? `_${basename.slice(1)}` : basename;
  return segments.join("/");
}

/** The scaffold output path for a template path: the inverse of {@link templateName}. */
export function outputName(path) {
  const segments = path.split("/");
  const last = segments.length - 1;
  const basename = segments[last] ?? "";
  segments[last] = basename.startsWith("_") ? `.${basename.slice(1)}` : basename;
  return segments.join("/");
}

/**
 * Build the whole template tree in memory.
 *
 * Keys are template-relative POSIX paths under {@link TEMPLATE_DIR}. The first
 * segment is the overlay: `common` is always stamped, `solo` and `enterprise` only
 * for the matching deployment shape.
 *
 * @returns {Map<string, string>}
 */
export function buildTemplates() {
  /** @type {Map<string, string>} */
  const tree = new Map();
  const versions = publishedVersions();

  for (const app of /** @type {const} */ (["api", "portal", "admin"])) {
    for (const path of repositoryFiles(`apps/${app}`)) {
      const appRelative = path.slice(`apps/${app}/`.length);
      if (isExcludedAppPath(appRelative)) continue;
      if (appRelative === "package.json") continue;
      tree.set(
        templateName(`common/apps/${app}/${appRelative}`),
        rewriteUiAssetPaths(read(path), appRelative),
      );
    }
    tree.set(
      `common/apps/${app}/package.json`,
      `${JSON.stringify(appManifest(app, versions), null, 2)}\n`,
    );
  }

  assertImports(tree);
  assertNoMonorepoPaths(tree);

  for (const app of /** @type {const} */ (["api", "portal", "admin"])) {
    tree.set(
      `common/docker/${app}.Dockerfile`,
      transformDockerfile(read(`docker/${app}.Dockerfile`), `qcms-${app}`),
    );
  }

  const compose = transformCompose(read("docker-compose.yml"));
  tree.set("common/docker-compose.yml", compose);
  tree.set("common/tsconfig.base.json", read("tsconfig.base.json"));
  tree.set("common/_npmrc", read(".npmrc"));

  const proxy = read("docker-compose.proxy.yml");
  tree.set("solo/docker-compose.proxy.yml", proxy);
  tree.set("solo/docker/Caddyfile", read("docker/Caddyfile"));

  tree.set(
    "common/_env.example",
    renderEnvExample([
      { text: compose, alwaysRuns: true },
      { text: proxy, alwaysRuns: false },
    ]),
  );

  for (const [path, contents] of Object.entries(staticTemplates())) tree.set(path, contents);
  return new Map([...tree].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * The hand-written half of the tree: files with no canonical counterpart.
 *
 * Kept in `templates-static/` as real files rather than string literals here, so
 * they are readable, Prettier-checked and reviewable as the documents they are. The
 * generator copies them in so that ONE tree is the scaffold's definition.
 */
function staticTemplates() {
  /** @type {Record<string, string>} */
  const files = {};
  for (const path of walk("packages/create-qcms-app/templates-static")) {
    files[path.slice("packages/create-qcms-app/templates-static/".length)] = read(path);
  }
  return files;
}

// --- the ownership-seam document --------------------------------------------

/** The document whose generated block this script owns (task 037 exit criterion 4). */
export const SEAM_DOC = "docs/ownership-seam.md";

export const SEAM_BEGIN = "<!-- BEGIN GENERATED: ownership-seam (pnpm qcms:sync-templates) -->";
export const SEAM_END = "<!-- END GENERATED: ownership-seam -->";

/** What each `@qcms/*` package is, and what upgrading it means. Prose, so it is written. */
const PACKAGE_STORY = {
  "@qcms/core": [
    "Domain model, the rules DSL and its forward-pass evaluator, the publish compiler, answer validation, secure-link tokens.",
    "Upgrade freely within a major. Published versions are immutable (R1), so a form already published keeps the semantics it was compiled under; a new version changes what NEW publishes may express and how they evaluate. A major bump is where a semantics change would land, and would carry a migration note.",
  ],
  "@qcms/a2ui-compiler": [
    "Compiles a published form into the stored A2UI document the portal serves.",
    "Upgrade freely. The portal serves the STORED document and never recompiles (ADR-18), so a compiler upgrade cannot alter a form that is already live: it changes what the next publish produces. The golden corpus is append-only, which is what makes that promise checkable rather than asserted.",
  ],
  "@qcms/db": [
    "The schema, the migration history, the query helpers and the reporting view.",
    "Upgrade, then run `docker compose run --rm migrate` as its own step before the new API instances take traffic. Migration is never done at boot, deliberately: with more than one API instance that is a race, and an operator has to be able to choose when schema changes land. Migrations are plain SQL files you can read before you run them.",
  ],
  "@qcms/ui": [
    "The A2UI renderer, the vendored input controls, and the token contract the theming rests on.",
    "Upgrade freely. The vendored components are pinned inside the package rather than resolved from upstream (ADR-22), so an upstream component release cannot reach a published form until a QCMS release deliberately pulls it in and re-runs the conformance suite.",
  ],
};

/** Every scaffold-relative output path, by the shape that stamps it. */
function scaffoldPaths(tree) {
  /** @type {Map<string, string[]>} */
  const byLayer = new Map();
  for (const path of tree.keys()) {
    const slash = path.indexOf("/");
    const layer = path.slice(0, slash);
    const output = outputName(path.slice(slash + 1)).replace(/\.tmpl$/, "");
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), output]);
  }
  return byLayer;
}

/** Directory to file count, for every directory at every depth, sorted. */
function directoryCounts(paths) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const path of paths) {
    const segments = path.split("/");
    const directory = segments.length === 1 ? "." : segments.slice(0, -1).join("/");
    for (let depth = 1; depth <= directory.split("/").length; depth += 1) {
      const prefix = directory === "." ? "." : directory.split("/").slice(0, depth).join("/");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * The generated half of `docs/ownership-seam.md`.
 *
 * Two views of the same set, deliberately. The directory table is what a reader uses;
 * the collapsed manifest is the literal answer to "every scaffolded path", so the
 * document cannot claim completeness it does not have. Both come from the same tree
 * the CLI stamps, so neither can drift from what an adopter receives.
 */
export function renderSeamBlock(tree = buildTemplates()) {
  const byLayer = scaffoldPaths(tree);
  const common = (byLayer.get("common") ?? []).sort();
  const versions = publishedVersions();
  const lines = [SEAM_BEGIN, ""];

  lines.push(`### Scaffolded paths (${common.length} files common to both shapes)`, "");
  lines.push("| Path | Files |", "| --- | --- |");
  for (const [directory, count] of directoryCounts(common)) {
    const label = directory === "." ? "(project root)" : `${directory}/`;
    lines.push(`| \`${label}\` | ${count} |`);
  }
  lines.push("");

  lines.push("### What each deployment shape adds", "");
  lines.push("| Shape | Additional paths |", "| --- | --- |");
  for (const shape of ["solo", "enterprise"]) {
    const extra = (byLayer.get(shape) ?? []).sort().map((path) => `\`${path}\``);
    lines.push(`| \`${shape}\` | ${extra.join(", ")} |`);
  }
  lines.push("");

  lines.push("### Package dependencies stamped into `apps/*/package.json`", "");
  lines.push("| Package | Range | What it carries | Upgrade story |", "| --- | --- | --- | --- |");
  for (const [name, [carries, story]] of Object.entries(PACKAGE_STORY)) {
    lines.push(`| \`${name}\` | \`${versions[name]}\` | ${carries} | ${story} |`);
  }
  lines.push("");

  lines.push("<details>", `<summary>Every scaffolded file (${common.length})</summary>`, "");
  lines.push("```");
  for (const path of common) lines.push(path);
  lines.push("```", "", "</details>", "");
  lines.push(SEAM_END);
  return lines.join("\n");
}

/** Replace the generated block, throwing when the markers are missing. */
export function replaceSeamBlock(text, block) {
  const begin = text.indexOf(SEAM_BEGIN);
  const end = text.indexOf(SEAM_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${SEAM_DOC} is missing the generated-block markers. Expected:\n${SEAM_BEGIN}\n...\n${SEAM_END}`,
    );
  }
  return text.slice(0, begin) + block + text.slice(end + SEAM_END.length);
}

/** The block currently sitting in the document. */
export function currentSeamBlock() {
  const text = read(SEAM_DOC);
  const begin = text.indexOf(SEAM_BEGIN);
  const end = text.indexOf(SEAM_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`${SEAM_DOC} is missing the generated-block markers.`);
  }
  return text.slice(begin, end + SEAM_END.length);
}

// --- write / check ----------------------------------------------------------

/** Everything currently committed under the template directory. */
function currentTemplates() {
  /** @type {Map<string, string>} */
  const tree = new Map();
  try {
    statSync(join(REPOSITORY_ROOT, TEMPLATE_DIR));
  } catch {
    return tree;
  }
  for (const path of walk(TEMPLATE_DIR)) {
    tree.set(path.slice(`${TEMPLATE_DIR}/`.length), read(path));
  }
  return tree;
}

/**
 * Differences between the generated tree and the committed one, as operator prose.
 *
 * @param {Map<string, string>} expected
 * @param {Map<string, string>} actual
 */
export function diffTrees(expected, actual) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, contents] of expected) {
    if (!actual.has(path)) problems.push(`missing:  ${TEMPLATE_DIR}/${path}`);
    else if (actual.get(path) !== contents) problems.push(`drifted:  ${TEMPLATE_DIR}/${path}`);
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) problems.push(`stale:    ${TEMPLATE_DIR}/${path}`);
  }
  return problems;
}

/** @param {Map<string, string>} tree */
function writeTemplates(tree) {
  rmSync(join(REPOSITORY_ROOT, TEMPLATE_DIR), { recursive: true, force: true });
  for (const [path, contents] of tree) {
    const absolute = join(REPOSITORY_ROOT, TEMPLATE_DIR, ...path.split("/"));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
}

export function main(args = argv.slice(2)) {
  const tree = buildTemplates();
  const block = renderSeamBlock(tree);
  if (args.includes("--write")) {
    writeTemplates(tree);
    const path = join(REPOSITORY_ROOT, SEAM_DOC);
    writeFileSync(path, replaceSeamBlock(readFileSync(path, "utf8"), block));
    process.stdout.write(
      `sync-templates: wrote ${tree.size} files to ${TEMPLATE_DIR} and the generated block in ${SEAM_DOC}\n`,
    );
    return 0;
  }
  const problems = diffTrees(tree, currentTemplates());
  if (currentSeamBlock() !== block) {
    problems.push(`drifted:  ${SEAM_DOC} (the generated block)`);
  }
  if (problems.length > 0) {
    process.stderr.write(
      `The scaffolding templates have drifted from the canonical apps:\n\n  ${problems.join("\n  ")}\n\n` +
        `Regenerate them with \`pnpm qcms:sync-templates\` and commit the result.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `sync-templates: ${tree.size} template files and ${SEAM_DOC} match the canonical apps\n`,
  );
  return 0;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exitCode = main();
}
