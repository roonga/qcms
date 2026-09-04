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
 *   5. *(retired)* Compose used to have the `QCMS_ADMIN_2FA` passthrough INSERTED
 *      here, because the canonical file lacked it. `main` has since added it to both
 *      services, which turned the transform into a duplicator, so it is now
 *      {@link assertComposeForwardsTwoFactor}: an assertion that the property still
 *      holds rather than an edit that makes it hold twice.
 *   6. **`.env.example` is generated from the config schema**, by scanning the
 *      generated Compose files for interpolations and looking each name up in
 *      `ENV_REFERENCE` (itself asserted against `apps/api/src/config.ts`). A name
 *      Compose reads that the schema does not document fails the generator.
 *   7. **Every scaffolded app declares the compiler it runs.** See
 *      {@link ROOT_PROVIDED_DEV_DEPENDENCIES}: the workspace root provides it here and
 *      an adopter has no workspace root.
 *   8. **Output that names a QCMS repository script is rewritten** for the tree an
 *      adopter receives ({@link ADOPTER_TEXT_REPLACEMENTS}, issue #457). Two strings,
 *      both user-facing, both telling an operator to run a command their project does
 *      not define.
 *   9. **The images carry the ADOPTER's identity, not this repository's** (issue #457).
 *      `org.opencontainers.image.title` is stamped from the project name, which is why
 *      the Dockerfiles are `.tmpl`, and `org.opencontainers.image.source` is removed:
 *      it is a claim about where the code in the image lives, and the code in an
 *      adopter's image is theirs.
 *
 * ## What the guards are allowed to claim
 *
 * Every assertion below runs over the FINISHED tree and is derived rather than listed,
 * because the version of this file that listed things (issue #456) had guards narrower
 * than their own docstrings: {@link assertNoEscapingPaths} counts `../` against a
 * file's own depth instead of matching one known reach; {@link assertComposeReferences}
 * reads what the Compose files point at instead of trusting the copy list;
 * {@link assertReadmeClaims} compares the hand-written READMEs to the tree they
 * describe; {@link readSource} refuses a file this generator cannot carry faithfully
 * rather than corrupting it.
 *
 * Usage:
 *   node packages/create-qcms-app/scripts/sync-templates.mjs --write
 *   node packages/create-qcms-app/scripts/sync-templates.mjs --check
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ENV_REFERENCE } from "../../../scripts/env-reference.mjs";

/** Repository root, resolved from this file rather than the process cwd. */
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where the generated tree lives, repo-relative. */
export const TEMPLATE_DIR = "packages/create-qcms-app/templates";

/**
 * The packages an adopter consumes from the registry rather than owning.
 *
 * ADR-05's four, plus the two shared helpers `main` added after this generator was
 * written (`@qcms/observability` in #446, `@qcms/csv` in #470). All three scaffolded
 * apps depend on those two AT RUNTIME, so a scaffold that does not resolve them is a
 * scaffold that does not install: the previous silent `workspace:*` fallback stamped
 * an unsatisfiable range into the adopter's manifest and nothing here could see it
 * (issue #456, blind spot F, which is what caught this).
 *
 * **This list is the published surface, so adding to it is a Code Owner call.** The
 * alternative shape, stamping those two as owned source under `packages/` in the
 * adopter's tree, was rejected for the CSV helper's sake: it carries the SEC-13
 * formula-injection guard, and a control that ships as versioned code is one an
 * upgrade can fix everywhere at once.
 */
const PUBLISHED_PACKAGES = [
  "@qcms/core",
  "@qcms/a2ui-compiler",
  "@qcms/db",
  "@qcms/ui",
  "@qcms/observability",
  "@qcms/csv",
];

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
  api: ["@qcms/a2ui-compiler", "@qcms/core", "@qcms/csv", "@qcms/db", "@qcms/observability"],
  portal: ["@qcms/core", "@qcms/observability", "@qcms/ui"],
  admin: [
    "@qcms/a2ui-compiler",
    "@qcms/core",
    "@qcms/csv",
    "@qcms/db",
    "@qcms/observability",
    "@qcms/ui",
  ],
};

/** Scripts an app keeps in the scaffold; everything else is this repository's. */
const APP_SCRIPTS = {
  api: ["build", "typecheck", "start", "create-admin"],
  portal: ["dev", "build", "start", "typecheck"],
  admin: ["dev", "build", "start", "typecheck"],
};

/**
 * Fragments of a kept script that reach outside the app, removed (transform 10).
 *
 * A kept script is copied verbatim, which is right until one of them starts invoking
 * repository tooling. `apps/api`'s `build` gained a `node ../../scripts/clean-dist.mjs`
 * prefix after this generator shipped, and the scaffold has no `scripts/` directory:
 * the Dockerfiles deliberately do not copy one (transform 4), so `pnpm -r build` and
 * every `docker compose up --build` in an adopter's project failed on a missing file.
 * {@link assertNoEscapingPaths} is what found it, over the generated manifest.
 *
 * Each entry must fire, exactly as {@link ADOPTER_TEXT_REPLACEMENTS} must.
 */
const APP_SCRIPT_FRAGMENTS = [
  {
    find: "node ../../scripts/clean-dist.mjs && ",
    why: "removes a stale `dist/` before `tsc`, which is repository hygiene for a tree that gets rebuilt across branches. An adopter's first build has no stale output, and the script it calls is not stamped.",
  },
];

/** Which script fragments actually fired, so a dead entry can be reported. */
const appliedScriptFragments = new Set();

/**
 * One kept script, with any repository-only fragment removed.
 *
 * @param {string} script
 * @returns {string}
 */
function rewriteAppScript(script) {
  let out = script;
  for (const [index, fragment] of APP_SCRIPT_FRAGMENTS.entries()) {
    if (!out.includes(fragment.find)) continue;
    out = out.replaceAll(fragment.find, "");
    appliedScriptFragments.add(index);
  }
  return out;
}

/** Fail on a fragment that matched nothing, which reads as coverage it does not have. */
function assertAppScriptFragmentsApplied() {
  const dead = APP_SCRIPT_FRAGMENTS.filter((_, index) => !appliedScriptFragments.has(index));
  if (dead.length > 0) {
    throw new Error(
      `sync-templates: these APP_SCRIPT_FRAGMENTS entries matched no scaffolded script, so they ` +
        `describe a transform that does not happen:\n  ${dead.map((entry) => entry.find).join("\n  ")}\n` +
        `Remove them from ${GENERATOR_PATH}, or fix the fragment.`,
    );
  }
}

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
  // `tooling/e2e-support`, a private workspace package holding this repository's
  // Playwright and scenario helpers. The tests that import it are dropped by the strip
  // rules, so keeping the declaration would stamp an unresolvable `workspace:*` into
  // the adopter's manifest for code the scaffold does not contain.
  "@qcms/e2e-support",
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
 * A test runner's configuration or setup file, at any depth in an app.
 *
 * Matched by shape rather than listed, because the list would only ever be as complete
 * as the last person to read it: `apps/admin/vitest.config.ts` arrived after this
 * generator shipped and was stamped into every scaffolded project, where `tsc` then
 * failed on `Cannot find module 'vitest/config'` because the scaffold ships neither
 * runner. The rule holds for the same reason the strip rules exist at all (ADR-23 fixes
 * the two runners as THIS repository's, and none of it is in an adopter's tree).
 */
const TEST_RUNNER_CONFIG = /(^|\/)(vitest|playwright)\.[\w.-]*\.[cm]?[jt]s$/;

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
  if (TEST_RUNNER_CONFIG.test(path)) return true;
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

/**
 * The override variable's name, so the check below and the message agree.
 *
 * Deliberately duplicated from `src/exec.ts`'s `BIN_OVERRIDE_ENV_VAR.git` rather than
 * imported: `check:templates` has to run under plain `node` in a tree that was never
 * installed or built (the property the PO review of #451 proved), so this file may not
 * import TypeScript. `sync-templates.test.ts` pins the two spellings and the two rules
 * against each other instead.
 */
export const GIT_BIN_OVERRIDE_ENV_VAR = "QCMS_GIT_BIN";

/**
 * Refuse an override that is not an absolute path to something that exists (#458).
 *
 * Same rule, same reason, as `overrideProgram` in `src/exec.ts`: a bare name is a
 * `PATH` lookup, which is exactly what probing absolute candidates exists to avoid,
 * and lint cannot see it because the value is a variable rather than a literal.
 *
 * @param {string} value
 * @returns {string}
 */
export function checkedGitOverride(value) {
  if (!isAbsolute(value)) {
    throw new Error(
      `sync-templates: ${GIT_BIN_OVERRIDE_ENV_VAR}=${value} is not an absolute path, so it would ` +
        `be resolved through PATH. Set it to the absolute path of the executable, or unset it.`,
    );
  }
  if (!existsSync(value)) {
    throw new Error(
      `sync-templates: ${GIT_BIN_OVERRIDE_ENV_VAR}=${value} does not exist. Set it to the ` +
        `absolute path of the executable, or unset it.`,
    );
  }
  return value;
}

function gitBinary() {
  const override = process.env[GIT_BIN_OVERRIDE_ENV_VAR];
  if (override !== undefined && override !== "") return checkedGitOverride(override);
  const found = GIT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `sync-templates: could not find git. Looked at: ${GIT_CANDIDATES.join(", ")}. ` +
        `Set ${GIT_BIN_OVERRIDE_ENV_VAR} to its absolute path.`,
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
 * @param {string} root directory relative to `base`
 * @param {string} base absolute root the paths are relative to. Defaults to the
 *   repository; a test passes a temporary directory, which is the only way to prove
 *   the walk sees a file under a directory name the old skip list hid (issue #450)
 *   without committing such a file.
 * @returns {string[]} POSIX paths relative to `base`
 */
export function walk(root, base = REPOSITORY_ROOT) {
  const absolute = join(base, root);
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...walk(posix.join(root, entry.name), base));
    else if (entry.isFile()) found.push(posix.join(root, entry.name));
  }
  return found.sort();
}

/** Read a repo-relative file as UTF-8. */
function read(path) {
  return readFileSync(join(REPOSITORY_ROOT, path), "utf8");
}

/**
 * Read a canonical source file, refusing anything this generator cannot carry
 * faithfully (issue #456, blind spot H).
 *
 * The whole tree is round-tripped as UTF-8 text, `walk()` and `git ls-files` both hand
 * back plain files, and nothing preserves a mode bit. All three are true of every
 * tracked file today, and each one fails silently on the day it stops being true: a
 * font under `apps/*` would be corrupted rather than copied, a symlink dropped without
 * comment, an executable shell script stamped unexecutable. A generator that cannot
 * copy a file must say so, not produce a broken one.
 *
 * The check is the copy: if the bytes do not survive the round trip, the text form is
 * not the file.
 *
 * CodeQL reads the `lstatSync` then `readFileSync` pair as a file-system race
 * (`js/file-system-race`, alert 20) and it is right about the shape. It is not a trust
 * boundary here: this is build-time tooling reading this repository's own tracked
 * files, in one process, as the one actor who also regenerates them, and the stat is a
 * fidelity assertion rather than an authorization decision. Nothing is granted on the
 * strength of it; the worst a swap between the two calls could buy is a generator that
 * writes a file it should have refused, which `check:templates` then reports. Same
 * reasoning as alert 21 on `agent-loop.log`.
 */
function readSource(path) {
  const absolute = join(REPOSITORY_ROOT, path);
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `sync-templates: ${path} is a symbolic link, and this generator writes plain files. ` +
        `Teach writeTemplates to reproduce links before adding one under a scaffolded path.`,
    );
  }
  // An octal permission test is what mode bits are for.
  if ((stats.mode & 0o111) !== 0) {
    throw new Error(
      `sync-templates: ${path} is executable, and this generator writes mode 0644. An adopter ` +
        `would receive a script they cannot run. Teach writeTemplates to preserve the mode first.`,
    );
  }
  const bytes = readFileSync(absolute);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error(
      `sync-templates: ${path} is not UTF-8 text, and this generator round-trips every file ` +
        `through a string, which would corrupt it. Teach buildTemplates to carry bytes first.`,
    );
  }
  return text;
}

/**
 * Text in a canonical app that names something only THIS repository has (transform 8).
 *
 * A scaffolded project inherits QCMS's identity along with its shell (issue #457), and
 * the two entries below are the tier that is a defect rather than a curiosity: both are
 * user-facing output telling an operator to run a command their project does not
 * define. The comments around them are left alone, deliberately, and
 * `docs/ownership-seam.md` explains what they are.
 *
 * `find` must appear EXACTLY ONCE in its file. A reworded original fails the generator
 * rather than silently no-opping, which is the same discipline
 * {@link transformDockerfile} applies to the lines it removes.
 */
const ADOPTER_TEXT_REPLACEMENTS = [
  {
    path: "apps/admin/lib/i18n/en.ts",
    find: "Create the first question. To explore with the sample insurance library instead, run pnpm dev:seed against a local development stack.",
    replace: "Create the first question to start building the library.",
    why: "`pnpm dev:seed` is a script in the QCMS repository. A scaffolded project has no such script, so the empty-library screen would tell an operator to run something that does not exist.",
  },
  {
    path: "apps/api/src/create-admin.ts",
    find: '"  pnpm qcms:create-admin\\n" +',
    replace:
      '"  docker compose exec -e QCMS_ADMIN_EMAIL -e QCMS_ADMIN_PASSWORD api node dist/create-admin.js\\n" +',
    why: "the usage this command prints when it is run without credentials. In a scaffolded project it runs inside the api container, and the scaffolded README says so; the tool and its own documentation disagreed in the adopter's tree.",
  },
];

/** Which replacements actually fired, so a dead entry can be reported. */
const appliedReplacements = new Set();

/**
 * Apply the adopter-text replacements for one source file.
 *
 * @param {string} path repo-relative source path
 * @param {string} text
 * @returns {string}
 */
function rewriteAdopterText(path, text) {
  let out = text;
  for (const [index, entry] of ADOPTER_TEXT_REPLACEMENTS.entries()) {
    if (entry.path !== path) continue;
    const occurrences = out.split(entry.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `sync-templates: ${path} contains ${String(occurrences)} occurrences of the text ` +
          `ADOPTER_TEXT_REPLACEMENTS expects exactly one of:\n  ${entry.find}\n` +
          `Reason the entry exists: ${entry.why}\nFix the entry in ${GENERATOR_PATH}.`,
      );
    }
    out = out.replace(entry.find, entry.replace);
    appliedReplacements.add(index);
  }
  return out;
}

/** Fail on an entry that matched nothing, which reads as coverage it does not have. */
function assertAdopterTextApplied() {
  const dead = ADOPTER_TEXT_REPLACEMENTS.filter((_, index) => !appliedReplacements.has(index));
  if (dead.length > 0) {
    throw new Error(
      `sync-templates: these ADOPTER_TEXT_REPLACEMENTS entries matched no scaffolded file, so ` +
        `they are describing a transform that does not happen:\n  ${dead.map((entry) => entry.path).join("\n  ")}\n` +
        `Remove them from ${GENERATOR_PATH}, or fix the path.`,
    );
  }
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
 * Exported for its own test: the throw below is only reachable through `appManifest`
 * when one of THIS repository's manifests carries the defect, which is not a state a
 * test can arrange without editing a real manifest.
 *
 * @param {Record<string, string> | undefined} block
 * @param {Record<string, string>} versions
 * @param {boolean} dropHarness
 */
export function rewriteDependencies(block, versions, dropHarness) {
  /** @type {Record<string, string>} */
  const rewritten = {};
  for (const [name, range] of Object.entries(block ?? {})) {
    if (dropHarness && HARNESS_DEV_DEPENDENCIES.has(name)) continue;
    if (PUBLISHED_PACKAGES.includes(name)) continue;
    if (range === "workspace:*") {
      // Loud rather than quiet (issue #456, blind spot F). A `??` fallback here
      // stamped an unknown workspace dependency verbatim into the adopter's manifest,
      // where `workspace:*` is not a range any registry install can satisfy: the
      // failure surfaced as an install error in someone else's project rather than as
      // a generator error in ours.
      const resolved = versions[name];
      if (resolved === undefined) {
        throw new Error(
          `sync-templates: a scaffolded manifest depends on ${name} at "workspace:*", and ${name} ` +
            `is not one of the published packages (${PUBLISHED_PACKAGES.join(", ")}). ` +
            `An adopter cannot install it. Publish it and add it to PUBLISHED_PACKAGES in ` +
            `${GENERATOR_PATH}, or drop the dependency.`,
        );
      }
      rewritten[name] = resolved;
      continue;
    }
    rewritten[name] = range;
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
    scripts[name] = rewriteAppScript(script);
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
 * A relative reference that climbs out of its own directory, and what follows it.
 *
 * The trailing character class stops at anything that ends a path in the shapes this
 * tree actually contains: quotes, whitespace, a closing bracket or paren, a comma or
 * a semicolon.
 */
const CLIMBING_REFERENCE = /(?:\.\.\/)+[^\s"'`)\],;:]*/g;

/**
 * Fail if any generated file reaches somewhere the scaffold has not got (#456 D, E).
 *
 * The predecessor of this function shared one regex with the transform it guarded
 * (`UI_SOURCE_REFERENCE`), which made it structurally incapable of catching a new
 * KIND of reach: only a new instance of the one already handled. It also scanned
 * `common/apps/` alone, exempting `tsconfig.base.json`, `_npmrc`, the compose files
 * and the whole `solo/` overlay, so a `paths` block pointing at `../../packages/*`
 * would have shipped through. Its docstring meanwhile claimed to be the general
 * counterpart to {@link assertImports}, which overstated it.
 *
 * This is that general counterpart, and it does not know what `packages/` is. It
 * counts `../` against the file's own depth from the scaffold root, so:
 *
 *   - more `../` than depth means the reference leaves the project entirely, which is
 *     never right whatever it names;
 *   - exactly `depth` means it lands ON the project root, so the first segment after
 *     it must be something the scaffold actually stamps there.
 *
 * That subsumes the old rule (`../../../packages/ui/src` from `apps/portal/app` lands
 * at the root and names `packages`, which the scaffold has not got) without naming it.
 *
 * Comments are exempt: several files legitimately explain where a generated sheet came
 * from, and rewriting prose would be editorial rather than mechanical.
 *
 * @param {Map<string, string>} tree
 */
export function assertNoEscapingPaths(tree) {
  const roots = scaffoldRootEntries(tree);
  /** @type {string[]} */
  const problems = [];
  for (const [path, contents] of tree) {
    const scaffoldRelative = outputName(path.slice(path.indexOf("/") + 1)).replace(/\.tmpl$/, "");
    const depth = scaffoldRelative.split("/").length - 1;
    for (const line of contents.split("\n")) {
      const code = line.replace(/^\s*(\*|\/\/|#).*$/, "");
      for (const [reference] of code.matchAll(CLIMBING_REFERENCE)) {
        const climbs = (reference.match(/\.\.\//g) ?? []).length;
        const remainder = reference.slice(climbs * 3);
        if (climbs > depth) {
          problems.push(`${path}: ${reference} climbs past the project root.`);
        } else if (climbs === depth && remainder === "") {
          // The project root itself, which a scaffold has exactly as this repository
          // does: `apps/<app>/next.config.ts` reaching `../../` is the workspace root
          // in both trees.
          continue;
        } else if (climbs === depth && !roots.has(remainder.split("/")[0] ?? "")) {
          problems.push(
            `${path}: ${reference} resolves to "${remainder}", which the scaffold does not stamp.`,
          );
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `sync-templates: these generated files reach outside the scaffolded project.\n  ${problems.join("\n  ")}\n` +
        `Rewrite the reference in a transform in ${GENERATOR_PATH}, the way rewriteUiAssetPaths does.`,
    );
  }
}

/**
 * Every first path segment the scaffold writes at its own root, across every layer.
 *
 * Read from the tree rather than listed, so it cannot describe a root the generator
 * stopped producing.
 *
 * @param {Map<string, string>} tree
 * @returns {Set<string>}
 */
function scaffoldRootEntries(tree) {
  /** @type {Set<string>} */
  const roots = new Set();
  for (const path of tree.keys()) {
    const scaffoldRelative = outputName(path.slice(path.indexOf("/") + 1)).replace(/\.tmpl$/, "");
    roots.add(scaffoldRelative.split("/")[0] ?? "");
  }
  return roots;
}

// --- import surface ---------------------------------------------------------

/** `@qcms/<name>` specifiers, from imports and from CSS `@source`/`url()` references. */
const QCMS_SPECIFIER = /@qcms\/(core|a2ui-compiler|csv|db|observability|ui)\b/g;

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
 * Root directories the monorepo Dockerfiles copy that a scaffolded project has not got.
 *
 * Declared, and every one of them MUST be present in every Dockerfile: the previous
 * version filtered two exact string literals, so a whitespace change or a third
 * monorepo-only `COPY` silently no-opped and the adopter's image failed on a `COPY` of
 * a directory that is not there (issue #456, blind spot C). That is not hypothetical:
 * `COPY tooling ./tooling` was added to all three files after this generator shipped,
 * and the filter did not see it.
 */
const MONOREPO_ONLY_COPY_DIRECTORIES = ["packages", "scripts", "tooling"];

/** Root directories a scaffolded project HAS, so a `COPY` of one is legitimate. */
const SCAFFOLD_COPY_DIRECTORIES = new Set(["apps"]);

/** `COPY <dir> ./<dir>` and nothing else: the whole-directory form. */
const DIRECTORY_COPY = /^COPY (\S+) \.\/(\S+)$/;

/**
 * The provenance label a scaffolded image must not inherit (issue #457, tier 1).
 *
 * `org.opencontainers.image.source` says where the code in the image lives. In an
 * adopter's image that code is theirs: the ownership seam exists precisely so they
 * edit it. Pointing the label at this repository sends anyone who reads OCI labels to
 * find a running container's source to a repository that does not contain it, which is
 * the specific way a provenance claim is wrong. `title` is inherited identity too, and
 * is stamped from the project name instead.
 */
const SOURCE_LABEL_LINE = '      org.opencontainers.image.source="https://github.com/roonga/qcms"';

/**
 * A Dockerfile without its monorepo assumptions or QCMS's identity (transforms 4, 9).
 *
 * @param {string} text
 * @param {string} app the workspace filter name, e.g. `qcms-api`
 * @param {string} role `api`, `portal` or `admin`, for the stamped image title
 */
export function transformDockerfile(text, app, role) {
  const workspaceBuild = `--filter ${app}... build`;
  if (!text.includes(workspaceBuild)) {
    throw new Error(
      `The ${app} Dockerfile no longer contains "${workspaceBuild}". The scaffold has no ` +
        `packages/ to build, so that line is what the transform exists to rewrite.`,
    );
  }

  /** @type {string[]} */
  const kept = [];
  /** @type {Set<string>} */
  const dropped = new Set();
  for (const line of text.split("\n")) {
    const copy = DIRECTORY_COPY.exec(line);
    if (copy !== null && copy[1] === copy[2] && MONOREPO_ONLY_COPY_DIRECTORIES.includes(copy[1])) {
      dropped.add(copy[1]);
      // The comment block immediately above a dropped COPY exists to explain that
      // line. Leaving it would leave prose explaining a line the adopter cannot see.
      while (kept.length > 0 && /^\s*#/.test(kept.at(-1) ?? "")) kept.pop();
      continue;
    }
    kept.push(line);
  }

  const missing = MONOREPO_ONLY_COPY_DIRECTORIES.filter((directory) => !dropped.has(directory));
  if (missing.length > 0) {
    throw new Error(
      `sync-templates: docker/${role}.Dockerfile no longer copies ${missing.join(", ")}, which ` +
        `MONOREPO_ONLY_COPY_DIRECTORIES in ${GENERATOR_PATH} says it does. Either the line moved ` +
        `and this transform is now a no-op that ships a broken image, or the directory is gone ` +
        `and the entry should be too.`,
    );
  }

  for (const line of kept) {
    const copy = DIRECTORY_COPY.exec(line);
    if (copy?.[1] !== undefined && !SCAFFOLD_COPY_DIRECTORIES.has(copy[1])) {
      throw new Error(
        `sync-templates: docker/${role}.Dockerfile copies "${copy[1]}", which a scaffolded ` +
          `project has not got at its root. Add it to MONOREPO_ONLY_COPY_DIRECTORIES (to drop it) ` +
          `or to SCAFFOLD_COPY_DIRECTORIES (if the scaffold now stamps it) in ${GENERATOR_PATH}.`,
      );
    }
  }

  return stampImageIdentity(kept.join("\n"), role).replace(workspaceBuild, `--filter ${app} build`);
}

/**
 * The adopter's image identity in place of this repository's (issue #457, tier 1).
 *
 * The title becomes `{{projectName}}-<role>`, rendered by the CLI from what the
 * operator typed, which is why the Dockerfiles are stamped as `.tmpl`. The source
 * label is removed rather than blanked: an empty OCI label is still a label, and a
 * scaffolder cannot know the adopter's repository URL. A comment says how to add it.
 *
 * @param {string} text
 * @param {string} role
 */
function stampImageIdentity(text, role) {
  const title = `LABEL org.opencontainers.image.title="qcms-${role}" \\`;
  if (!text.includes(title) || !text.includes(SOURCE_LABEL_LINE)) {
    throw new Error(
      `sync-templates: docker/${role}.Dockerfile no longer carries the OCI title and source ` +
        `labels this transform rewrites. A scaffolded image must not claim to come from this ` +
        `repository (issue #457); update stampImageIdentity in ${GENERATOR_PATH}.`,
    );
  }
  return text
    .replace(title, `LABEL org.opencontainers.image.title="{{projectName}}-${role}" \\`)
    .replace(
      ` \\\n${SOURCE_LABEL_LINE}`,
      "\n# No org.opencontainers.image.source: this image is built from YOUR tree, which\n" +
        "# you have owned since create-qcms-app stamped it, so no scaffolder can know where\n" +
        "# it lives. Add the label yourself once it has a home:\n" +
        '#   org.opencontainers.image.source="https://example.com/your/repository"',
    );
}

/** The two services that read the admin 2FA policy (SEC-1, ADR-24's flag registry). */
const TWO_FACTOR_SERVICES = ["api", "admin"];

/** The passthrough line those two services must carry. */
const TWO_FACTOR_PASSTHROUGH = "QCMS_ADMIN_2FA: ${QCMS_ADMIN_2FA:-required}";

/**
 * Fail unless the canonical Compose file already forwards `QCMS_ADMIN_2FA` (was 5).
 *
 * This used to be a transform: the generator INSERTED the passthrough, because the
 * canonical file did not have it and adding it there would have moved the variable
 * into `scripts/env-reference.mjs`'s compose group. `main` has since added it on both
 * services for its own reasons, which turned the transform into a duplicator: the
 * generated file carried the key twice per service, and a duplicate YAML key is
 * resolved by whichever copy wins rather than reported.
 *
 * So the transform is gone and the property it guaranteed is asserted instead. The CLI
 * still prompts for the policy and still writes it into `.env`, and if the canonical
 * file ever stops forwarding it, an adopter's answer would reach neither service
 * silently. That is the failure this catches.
 *
 * @param {string} text
 */
export function assertComposeForwardsTwoFactor(text) {
  const blocks = serviceBlocks(text);
  const missing = TWO_FACTOR_SERVICES.filter(
    (service) => !(blocks.get(service) ?? "").includes(TWO_FACTOR_PASSTHROUGH),
  );
  if (missing.length > 0) {
    throw new Error(
      `sync-templates: docker-compose.yml no longer forwards ${TWO_FACTOR_PASSTHROUGH} to ` +
        `${missing.join(" and ")}. The CLI prompts for the admin 2FA policy and writes it to ` +
        `.env, so without the passthrough the adopter's answer reaches nothing.`,
    );
  }
  const occurrences = text.split(TWO_FACTOR_PASSTHROUGH).length - 1;
  if (occurrences !== TWO_FACTOR_SERVICES.length) {
    throw new Error(
      `sync-templates: docker-compose.yml carries ${String(occurrences)} copies of ` +
        `${TWO_FACTOR_PASSTHROUGH} and exactly ${String(TWO_FACTOR_SERVICES.length)} services read ` +
        `it. A duplicate key in one service block is resolved silently rather than reported.`,
    );
  }
  return text;
}

/**
 * A Compose file's service blocks, keyed by name.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function serviceBlocks(text) {
  /** @type {Map<string, string>} */
  const blocks = new Map();
  const lines = text.split("\n");
  const start = lines.indexOf("services:");
  if (start === -1) return blocks;
  /** @type {string | undefined} */
  let current;
  /** @type {string[]} */
  let body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") break;
    const key = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (key?.[1] !== undefined) {
      if (current !== undefined) blocks.set(current, body.join("\n"));
      current = key[1];
      body = [];
      continue;
    }
    body.push(line);
  }
  if (current !== undefined) blocks.set(current, body.join("\n"));
  return blocks;
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
        rewriteAdopterText(path, rewriteUiAssetPaths(readSource(path), appRelative)),
      );
    }
    tree.set(
      `common/apps/${app}/package.json`,
      `${JSON.stringify(appManifest(app, versions), null, 2)}\n`,
    );
  }

  assertImports(tree);
  assertAdopterTextApplied();
  assertAppScriptFragmentsApplied();

  for (const app of /** @type {const} */ (["api", "portal", "admin"])) {
    tree.set(
      `common/docker/${app}.Dockerfile.tmpl`,
      transformDockerfile(readSource(`docker/${app}.Dockerfile`), `qcms-${app}`, app),
    );
  }

  const compose = assertComposeForwardsTwoFactor(readSource("docker-compose.yml"));
  tree.set("common/docker-compose.yml", compose);
  tree.set("common/tsconfig.base.json", readSource("tsconfig.base.json"));
  tree.set("common/_npmrc", readSource(".npmrc"));

  const proxy = readSource("docker-compose.proxy.yml");
  tree.set("solo/docker-compose.proxy.yml", proxy);
  tree.set("solo/docker/Caddyfile", readSource("docker/Caddyfile"));

  tree.set(
    "common/_env.example",
    renderEnvExample([
      { text: compose, alwaysRuns: true },
      { text: proxy, alwaysRuns: false },
    ]),
  );

  for (const [path, contents] of Object.entries(staticTemplates())) tree.set(path, contents);
  const sorted = new Map([...tree].sort(([a], [b]) => (a < b ? -1 : 1)));

  // Every guard runs over the FINISHED tree, so none of them can be true of an
  // intermediate state the adopter never receives.
  assertNoEscapingPaths(sorted);
  assertComposeReferences(sorted);
  assertReadmeClaims(sorted);
  assertReleaseAgeHoldIsStamped(sorted);
  return sorted;
}

// --- what the compose files point at ----------------------------------------

/**
 * `dockerfile: <path>` in a Compose build block.
 *
 * `[ \t]` rather than `\s` throughout, for the reason {@link COMMENT_LINE} records:
 * `\s` matches a newline, which makes an anchored multiline pattern backtrack
 * super-linearly over a long file.
 */
const COMPOSE_DOCKERFILE = /^[ \t]*dockerfile:[ \t]*(\S+)[ \t]*$/gm;

/**
 * A host path bind-mounted into a container, as in
 * `- ./docker/Caddyfile:/etc/caddy/Caddyfile:ro`.
 *
 * The example is spelled out rather than abbreviated because a short one reads as a
 * Windows drive letter to `check:paths`, which is right to say so.
 */
const COMPOSE_BIND_MOUNT = /^[ \t]*-[ \t]+\.\/([^\s:]+):\S/gm;

/**
 * Which layers a shape stamps: `common` always, plus its own overlay.
 *
 * @param {string} shape
 * @returns {string[]}
 */
function layersFor(shape) {
  return ["common", shape];
}

/**
 * Fail if a generated Compose file points at a file the scaffold does not stamp
 * (issue #456, blind spot B).
 *
 * The generator enumerates the docker assets it copies by name, and a list is exactly
 * as complete as the last person to read it. This checks the other end instead: every
 * path a shipped Compose file references has to exist in the tree that ships it. Add a
 * file to `docker/` and reference it from a Compose file without teaching the
 * generator about it, and the adopter's `docker compose up` fails on a missing path
 * while `check:templates` stays green, because the generated tree never had it either.
 *
 * @param {Map<string, string>} tree
 */
export function assertComposeReferences(tree) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, contents] of tree) {
    if (!/(^|\/)docker-compose[.\w-]*\.yml$/.test(path)) continue;
    const layer = path.slice(0, path.indexOf("/"));
    const shapes = layer === "common" ? [...DEPLOYMENT_SHAPES] : [layer];
    const referenced = [
      ...[...contents.matchAll(COMPOSE_DOCKERFILE)].map((match) => match[1] ?? ""),
      ...[...contents.matchAll(COMPOSE_BIND_MOUNT)].map((match) => match[1] ?? ""),
    ];
    for (const reference of new Set(referenced)) {
      for (const shape of shapes) {
        if (!stamps(tree, shape, reference)) {
          problems.push(
            `${path} references ./${reference}, which the ${shape} shape does not stamp.`,
          );
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `sync-templates: a scaffolded Compose file points at something the scaffold has not got.\n  ${problems.join("\n  ")}\n` +
        `Add it to buildTemplates in ${GENERATOR_PATH}.`,
    );
  }
}

/** The deployment shapes the CLI knows, mirrored from `src/options.ts`. */
const DEPLOYMENT_SHAPES = ["solo", "enterprise"];

/**
 * True when `shape` stamps `scaffoldRelative` (a file, or a directory holding one).
 *
 * @param {Map<string, string>} tree
 * @param {string} shape
 * @param {string} scaffoldRelative
 */
function stamps(tree, shape, scaffoldRelative) {
  const wanted = layersFor(shape);
  for (const path of tree.keys()) {
    const layer = path.slice(0, path.indexOf("/"));
    if (!wanted.includes(layer)) continue;
    const output = outputName(path.slice(layer.length + 1)).replace(/\.tmpl$/, "");
    if (output === scaffoldRelative || output.startsWith(`${scaffoldRelative}/`)) return true;
  }
  return false;
}

// --- the release-age hold ---------------------------------------------------

/**
 * The supply-chain settings a scaffolded workspace inherits (SEC-11, issue #455).
 *
 * Both keys, never one. pnpm turns `minimumReleaseAgeStrict` on by default only when
 * `minimumReleaseAge` is itself explicitly configured, so a file carrying `strict`
 * beside an inherited default states a policy nothing enforces. `pnpm-workspace.yaml`
 * at the repository root says the same thing about itself.
 */
const RELEASE_AGE_KEYS = ["minimumReleaseAge", "minimumReleaseAgeStrict"];

/**
 * Fail if this repository holds new releases and the scaffold it stamps does not.
 *
 * `templates-static/common/pnpm-workspace.yaml` is hand-written, which is blind spot G
 * all over again: nothing compared it to anything, and a security posture that lives
 * in two hand-maintained files drifts the moment one of them is edited. An adopter
 * installs a dependency tree the same size as this one from the same registry, so a
 * control that is worth having here is worth stamping there.
 *
 * It checks presence, not equality. The stamped file is the adopter's to tune (ADR-05)
 * and its comment says so; what must not happen silently is the scaffold losing the
 * hold because someone edited one file and not the other.
 *
 * @param {Map<string, string>} tree
 */
export function assertReleaseAgeHoldIsStamped(tree) {
  const repository = readSource("pnpm-workspace.yaml");
  const held = RELEASE_AGE_KEYS.filter((key) => new RegExp(`^${key}:`, "m").test(repository));
  if (held.length === 0) return;
  if (held.length !== RELEASE_AGE_KEYS.length) {
    throw new Error(
      `sync-templates: pnpm-workspace.yaml sets ${held.join(" and ")} but not ` +
        `${RELEASE_AGE_KEYS.filter((key) => !held.includes(key)).join(" and ")}. pnpm only ` +
        `defaults the strict flag on when the age is explicitly configured, so one without the ` +
        `other is a policy nothing enforces. Fix the repository's own file first.`,
    );
  }
  const stamped = tree.get("common/pnpm-workspace.yaml") ?? "";
  const missing = RELEASE_AGE_KEYS.filter((key) => !new RegExp(`^${key}:`, "m").test(stamped));
  if (missing.length > 0) {
    throw new Error(
      `sync-templates: this repository holds new releases (${RELEASE_AGE_KEYS.join(", ")}) and ` +
        `the scaffolded pnpm-workspace.yaml does not set ${missing.join(", ")}. An adopter ` +
        `installs the same registry tree with the same exposure. Add it to ` +
        `packages/create-qcms-app/templates-static/common/pnpm-workspace.yaml, or, if the hold ` +
        `is deliberately not inherited, delete this guard and say why.`,
    );
  }
}

// --- what the hand-written READMEs claim ------------------------------------

/** Compose CLI flags that eat the word after them; anything else stands alone. */
const COMPOSE_VALUE_FLAGS = new Set([
  "-f",
  "--file",
  "-e",
  "--env",
  "-w",
  "--workdir",
  "-u",
  "--user",
  "-p",
  "--project-name",
]);

/**
 * Every `docker compose` invocation in a document, as its argument words.
 *
 * Line continuations are joined and quoted values collapsed to one word first, so the
 * README's multi-line `docker compose exec -e QCMS_ADMIN_PASSWORD='a long passphrase'`
 * reads as one command rather than as several, and `long` is never mistaken for a
 * service name.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function composeInvocations(text) {
  const joined = text
    .replaceAll(/\\\n\s*/g, " ")
    .replaceAll(/'[^']*'/g, "'quoted'")
    .replaceAll(/"[^"]*"/g, '"quoted"');
  return [...joined.matchAll(/docker compose[ \t]+([^\n`]*)/g)].map((match) =>
    (match[1] ?? "").trim().split(/\s+/).filter(Boolean),
  );
}

/**
 * The service name a `docker compose exec|run` invocation acts on, and the files it
 * passes to `-f`.
 *
 * @param {string[]} words
 * @returns {{ service: string | undefined; files: string[] }}
 */
export function composeTarget(words) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const operands = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (!word.startsWith("-")) {
      operands.push(word);
      continue;
    }
    const consumed = readComposeFlag(word, words[index + 1] ?? "", files);
    index += consumed;
  }
  const [subcommand, first] = operands;
  const service = subcommand === "exec" || subcommand === "run" ? first : undefined;
  return { service, files };
}

/**
 * Read one flag, recording a `-f` value, and say how many extra words it ate.
 *
 * @param {string} word
 * @param {string} next
 * @param {string[]} files collects every `-f` value
 * @returns {number}
 */
function readComposeFlag(word, next, files) {
  const equals = word.indexOf("=");
  const flag = equals === -1 ? word : word.slice(0, equals);
  if (!COMPOSE_VALUE_FLAGS.has(flag)) return 0;
  const inline = equals === -1 ? undefined : word.slice(equals + 1);
  const value = inline ?? next;
  if (flag === "-f" || flag === "--file") files.push(value);
  return inline === undefined ? 1 : 0;
}

/** Every `QCMS_*` name a document mentions. */
const QCMS_ENV_NAME = /\bQCMS_[A-Z0-9_]+\b/g;

/**
 * Fail if a hand-written README claims something the generated tree does not support
 * (issue #456, blind spot G).
 *
 * `templates-static/` is the one part of the scaffold with no canonical counterpart, so
 * until this ran nothing compared it to anything: the service names, the `-f` overlay
 * shape and the `QCMS_*` variables were unchecked prose next to a Compose file that
 * moves. Only the four `nextCommands` lines were pinned, by `scaffold.test.ts`.
 *
 * Three claims are checkable and all three are checked: a service the README tells the
 * operator to `exec` or `run` has to be a service; a file it passes to `-f` has to be
 * stamped; a `QCMS_*` variable it names has to be one the stack actually reads, meaning
 * the generated Compose files, the generated `.env.example`, or the configuration
 * schema's own reference (which covers the two credentials that only ever arrive
 * through `docker compose exec -e`). What is left unchecked is genuinely prose.
 *
 * @param {Map<string, string>} tree
 */
export function assertReadmeClaims(tree) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, contents] of tree) {
    if (!path.endsWith("README.md.tmpl")) continue;
    const layer = path.slice(0, path.indexOf("/"));
    const shape = layer === "common" ? DEPLOYMENT_SHAPES[0] : layer;
    if (shape === undefined) continue;
    problems.push(...readmeProblems(tree, shape, path, contents));
  }
  if (problems.length > 0) {
    throw new Error(
      `sync-templates: a hand-written README in templates-static/ claims something the generated ` +
        `tree does not support.\n  ${problems.join("\n  ")}\n` +
        `Fix the README, or the generator that produces what it describes.`,
    );
  }
}

/**
 * Everything one README claims that its shape's generated tree does not support.
 *
 * @param {Map<string, string>} tree
 * @param {string} shape
 * @param {string} path the README's template path, for the message
 * @param {string} contents
 * @returns {string[]}
 */
function readmeProblems(tree, shape, path, contents) {
  const services = composeServices(tree, shape);
  const known = environmentNames(tree, shape);
  /** @type {string[]} */
  const problems = [];

  for (const words of composeInvocations(contents)) {
    const { service, files } = composeTarget(words);
    if (service !== undefined && !services.has(service)) {
      problems.push(
        `${path} tells the operator to use the "${service}" service, and the ${shape} ` +
          `Compose file defines ${[...services].join(", ")}.`,
      );
    }
    for (const file of files.filter((candidate) => !stamps(tree, shape, candidate))) {
      problems.push(`${path} passes -f ${file}, which the ${shape} shape does not stamp.`);
    }
  }
  for (const [name] of contents.matchAll(QCMS_ENV_NAME)) {
    if (!known.has(name)) {
      problems.push(
        `${path} names ${name}, which neither the generated .env.example documents nor the ` +
          `${shape} Compose file sets.`,
      );
    }
  }
  return problems;
}

/**
 * The service names the Compose files a shape stamps define.
 *
 * @param {Map<string, string>} tree
 * @param {string} shape
 * @returns {Set<string>}
 */
function composeServices(tree, shape) {
  /** @type {Set<string>} */
  const services = new Set();
  for (const [path, contents] of tree) {
    const layer = path.slice(0, path.indexOf("/"));
    if (!layersFor(shape).includes(layer)) continue;
    if (!/(^|\/)docker-compose[.\w-]*\.yml$/.test(path)) continue;
    for (const name of serviceBlocks(contents).keys()) services.add(name);
  }
  return services;
}

/**
 * Every `QCMS_*` name the stamped stack actually reads, from the two generated files
 * that decide it rather than from a list.
 *
 * @param {Map<string, string>} tree
 * @param {string} shape
 * @returns {Set<string>}
 */
function environmentNames(tree, shape) {
  /** @type {Set<string>} */
  const names = new Set();
  // The configuration schema's reference, which documents every variable any QCMS
  // process parses. It is wider than the Compose files on purpose: `QCMS_ADMIN_EMAIL`
  // and `QCMS_ADMIN_PASSWORD` reach the container through `docker compose exec -e` at
  // bootstrap time and are deliberately in no file at all (SEC-8, issue #440).
  for (const entry of ENV_REFERENCE) names.add(entry.name);
  for (const [path, contents] of tree) {
    const layer = path.slice(0, path.indexOf("/"));
    if (!layersFor(shape).includes(layer)) continue;
    const isCompose = /(^|\/)docker-compose[.\w-]*\.yml$/.test(path);
    if (!isCompose && !path.endsWith("_env.example")) continue;
    for (const [name] of contents.matchAll(QCMS_ENV_NAME)) names.add(name);
  }
  return names;
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
    files[path.slice("packages/create-qcms-app/templates-static/".length)] = readSource(path);
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
  "@qcms/observability": [
    "The redacting server logger, trace correlation, and the SEC-13 allowlists that decide what a log record or a span may carry off the box.",
    "Upgrade freely, and prefer to. It is a versioned package rather than scaffolded source precisely because the allowlists are a security control: a tightening reaches every deployment through an upgrade instead of through 300 forks each editing their own copy (ADR-34, SEC-13).",
  ],
  "@qcms/csv": [
    "One helper: RFC 4180 quoting plus the spreadsheet formula-injection guard every exported cell passes through.",
    "Upgrade freely, and prefer to, for the same reason as `@qcms/observability`. The guard is the SEC control on issue #470, and the export routes that call it are yours to edit, so the value of shipping it as a version is that a correction to the guard is an upgrade rather than a code review in every adopter's tree.",
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

  lines.push("### QCMS-internal references in the scaffolded source", "");
  const references = countInternalReferences(tree);
  lines.push(
    `\`${String(references.lines)}\` lines across \`${String(references.files)}\` scaffolded files ` +
      "cite a QCMS issue, ADR, SEC control, plan task or repository path.",
    "",
    "These are comments, and they stay (issue #457, tier 3). They are the engineering",
    "rationale for code you now own, which is worth more to you than a tidy file, and",
    "stripping them mechanically would delete the reasoning along with the citation.",
    "What they are NOT is a tracker you can open: they resolve against the upstream",
    "QCMS repository, not against yours. Read `ADR-nn` as a design decision recorded at",
    "`docs/adr/` upstream, `SEC-n` as a security control in `docs/SECURITY_DESIGN.md`,",
    "and a bare `#nnn` as an upstream issue number.",
    "",
    "The two places QCMS's identity would have been more than a citation are fixed",
    "rather than documented: the images no longer claim to be built from this",
    "repository, and no scaffolded message names a script your project does not define.",
    "",
  );

  lines.push("<details>", `<summary>Every scaffolded file (${common.length})</summary>`, "");
  lines.push("```");
  for (const path of common) lines.push(path);
  lines.push("```", "", "</details>", "");
  lines.push(SEAM_END);
  return lines.join("\n");
}

/**
 * References to this repository's own tracker, decisions and layout (issue #457).
 *
 * Counted rather than removed, so the seam document states the size of the thing
 * instead of an adopter discovering it. Deliberately narrow: `ADR-nn`, `SEC-n`,
 * `issue #nnn`, `task nnn` and a path under one of this repository's top-level
 * directories that a scaffold has not got.
 *
 * @param {Map<string, string>} tree
 * @returns {{ files: number; lines: number }}
 */
export function countInternalReferences(tree) {
  const pattern =
    /\bADR-\d+|\bSEC-\d+|\bissues? #\d+|\btask \d{3}\b|\b(?:packages|plan|scripts|tooling|docs)\/[a-z]/i;
  let files = 0;
  let lines = 0;
  for (const [path, contents] of tree) {
    if (!path.startsWith("common/apps/")) continue;
    const hits = contents.split("\n").filter((line) => pattern.test(line)).length;
    if (hits > 0) {
      files += 1;
      lines += hits;
    }
  }
  return { files, lines };
}

/**
 * The generated block with table presentation collapsed away.
 *
 * Prettier owns how a Markdown table is laid out: it pads every cell to the widest in
 * its column and fills the delimiter row to match. This generator emits compact rows,
 * because it has no business reimplementing another tool's formatter. Both are right,
 * and comparing the two raw strings would make `check:templates` and `prettier --check`
 * permanently unable to be green at the same time.
 *
 * So the comparison is on content: inside a table row, runs of whitespace collapse to
 * one space and a delimiter run of dashes collapses to three. Everything else, prose
 * and the file manifest included, is compared byte for byte. A cell whose text changed
 * is still drift; a cell that was merely repadded is not.
 *
 * @param {string} block
 * @returns {string}
 */
export function normalizeSeamBlock(block) {
  return block
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line
            .replaceAll(/-{3,}/g, "---")
            .replaceAll(/[ \t]+/g, " ")
            .trim()
        : line,
    )
    .join("\n");
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
    const text = readFileSync(path, "utf8");
    // Rewritten only when the CONTENT changed. Otherwise a run of this script would
    // strip Prettier's table padding out of a document nothing had changed, and the
    // next `pnpm lint` would put it back: a two-command loop that never settles.
    if (normalizeSeamBlock(currentSeamBlock()) !== normalizeSeamBlock(block)) {
      writeFileSync(path, replaceSeamBlock(text, block));
    }
    process.stdout.write(
      `sync-templates: wrote ${tree.size} files to ${TEMPLATE_DIR} and the generated block in ${SEAM_DOC}\n`,
    );
    return 0;
  }
  const problems = diffTrees(tree, currentTemplates());
  if (normalizeSeamBlock(currentSeamBlock()) !== normalizeSeamBlock(block)) {
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
