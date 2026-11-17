#!/usr/bin/env node
// @ts-check
/**
 * Decides how much work a required job does, never whether it runs: a required context that never reports blocks a pull
 * request or queue entry forever, so every uncertain case resolves to the full suite. The workflow runs the copy at the BASE ref,
 * so this file never classifies its own diff and cannot be renamed until the rename reaches `main`.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { argv, env, stdout } from "node:process";
import { pathToFileURL } from "node:url";

// On Windows, Node's execFile does not add the `.exe` suffix the way a shell does.
const GIT = process.platform === "win32" ? "git.exe" : "git";

export const PLAN_PREFIX = "plan/";

/**
 * The trailing separator is what makes each prefix safe: without it `plan` would match
 * `planner.ts` and `.claude` would match a future `.claude-hooks/`.
 *
 * `apps/site/` is static and imported by nothing, so it moves no suite these contexts
 * cover; `check:plan` and `verify`'s fast-lane steps lint, typecheck and build it.
 */
export const FAST_LANE_PREFIXES = [PLAN_PREFIX, ".claude/", "apps/site/", ".changeset/"];

/**
 * Matched by equality, not prefix: as a prefix `CLAUDE.md` would admit `CLAUDE.md.bak`,
 * and equality keeps `apps/api/CONTRIBUTING.md` code rather than prose.
 */
export const FAST_LANE_FILES = ["CLAUDE.md", "PROJECT_INSTRUCTIONS.md", "CONTRIBUTING.md"];

export const DOCS_PREFIX = "docs/";

/**
 * Off the lane because `apps/api/e2e/security/matrix-coverage.e2e.ts` parses this file's
 * authorization matrix at runtime, and that suite is one the lane reports green without
 * running.
 */
export const DOCS_OFF_LANE = ["docs/SECURITY_DESIGN.md"];

/** `docs/openapi/*.json` is a generated API contract a test rebuilds and compares, so it is code. */
export const DOCS_OFF_LANE_PREFIXES = ["docs/openapi/"];

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isDocsLanePath(path) {
  if (!path.startsWith(DOCS_PREFIX)) return false;
  if (DOCS_OFF_LANE_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return !DOCS_OFF_LANE.includes(path);
}

export const GITHUB_PREFIX = ".github/";

/** The required jobs execute the workflows and the composite actions, so both stay code. */
export const GITHUB_OFF_LANE_PREFIXES = [".github/workflows/", ".github/actions/"];

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isGithubLanePath(path) {
  if (!path.startsWith(GITHUB_PREFIX)) return false;
  return !GITHUB_OFF_LANE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const TEMPLATE_MIRROR_PREFIX = "packages/create-qcms-app/templates/common/";

/**
 * A template path classifies as the path it mirrors only when that source path is in the
 * same diff, so a template-only change never rides a lane its source would.
 *
 * @param {readonly string[]} paths
 * @returns {string[]}
 */
export function mirrorSources(paths) {
  const changed = new Set(paths);
  return paths.map((path) => {
    if (!path.startsWith(TEMPLATE_MIRROR_PREFIX)) return path;
    const source = path.slice(TEMPLATE_MIRROR_PREFIX.length);
    return changed.has(source) ? source : path;
  });
}

/**
 * @param {readonly string[]} files
 * @returns {string[]}
 */
function classifiable(files) {
  return mirrorSources(files.filter((path) => path !== ""));
}

const LOG_LIMIT = 40;

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isFastLanePath(path) {
  if (FAST_LANE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (isDocsLanePath(path) || isGithubLanePath(path)) return true;
  return FAST_LANE_FILES.includes(path);
}

/**
 * An empty list is NOT plan-only: "saw nothing" must never read as "saw only prose".
 *
 * @param {readonly string[]} files
 * @returns {boolean}
 */
export function isPlanOnly(files) {
  const paths = classifiable(files);
  if (paths.length === 0) return false;
  return paths.every(isFastLanePath);
}

/**
 * The safe question is what a diff touches OUTSIDE this list, since the admin and the
 * portal share `@roonga/qcms-ui` and `@roonga/qcms-core`. Every fast-lane path must stay
 * admin-only too, which a test asserts over the two sets.
 */
export const ADMIN_ONLY_PREFIXES = ["apps/admin/", "docs/", ...FAST_LANE_PREFIXES];

/**
 * @param {readonly string[]} files
 * @returns {boolean}
 */
export function isAdminOnly(files) {
  const paths = classifiable(files);
  if (paths.length === 0) return false;
  return paths.every(isAdminPath);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isAdminPath(path) {
  return ADMIN_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)) || isFastLanePath(path);
}

/** Read after the mirror mapping, so `templates/common/docker/` arrives as `docker/`. */
export const DOCKER_PREFIXES = ["docker/", "packages/create-qcms-app/templates/solo/docker/"];

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isDockerPath(path) {
  if (DOCKER_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "Dockerfile" || name.includes(".Dockerfile");
}

/**
 * Every root script the browser or API harness, or a workspace build, imports; the rest of
 * `scripts/` moves no end-to-end suite. `scripts/ci-plan-only.test.ts` recomputes the
 * import closure and fails when this list misses a member.
 */
export const HARNESS_SCRIPTS = [
  "scripts/clean-dist.mjs",
  "scripts/compose-admin.mjs",
  "scripts/compose-e2e.mjs",
  "scripts/compose-seed.mjs",
  "scripts/docker-host.mjs",
  "scripts/docker.mjs",
  "scripts/env-reference.mjs",
  "scripts/next-build.mjs",
  "scripts/ports.mjs",
  "scripts/prompt-sources.mjs",
  "scripts/tracked-files.mjs",
];

const UNIT_TEST = /\.test\.tsx?$/;

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isUnitTest(path) {
  return UNIT_TEST.test(path) && !path.startsWith("e2e/") && !path.includes("/e2e/");
}

/**
 * A path no end-to-end suite builds, imports or reads.
 *
 * @param {string} path
 * @returns {boolean}
 */
function movesNoSuite(path) {
  if (isFastLanePath(path) || isDockerPath(path) || isUnitTest(path)) return true;
  return path.startsWith("scripts/") && !HARNESS_SCRIPTS.includes(path);
}

export const API_E2E_PREFIX = "apps/api/e2e/";

/** The browser harness imports this part of the API suite's tree. */
export const API_E2E_SUPPORT_PREFIX = "apps/api/e2e/support/";

/**
 * False only when every path provably moves nothing the browser suite runs.
 *
 * @param {readonly string[]} files
 * @returns {boolean}
 */
export function isUiNeeded(files) {
  const paths = classifiable(files);
  if (paths.length === 0) return true;
  return !paths.every(
    (path) =>
      movesNoSuite(path) ||
      (path.startsWith(API_E2E_PREFIX) && !path.startsWith(API_E2E_SUPPORT_PREFIX)),
  );
}

export const API_AREAS = ["apps/api/", "packages/db/", "packages/core/", "packages/observability/"];

export const API_FILES = [
  "docs/SECURITY_DESIGN.md",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".nvmrc",
  ".node-version",
];

/** Workspaces the API neither imports nor builds against. */
export const API_UNRELATED_PREFIXES = ["apps/admin/", "apps/portal/", "packages/ui/"];

/**
 * @param {string} path
 * @returns {boolean}
 */
function apiReads(path) {
  if (API_AREAS.some((prefix) => path.startsWith(prefix))) return true;
  if (API_FILES.includes(path)) return true;
  return path === "package.json" || path.endsWith("/package.json");
}

/**
 * False only when every path provably moves nothing the API suite runs.
 *
 * @param {readonly string[]} files
 * @returns {boolean}
 */
export function isApiNeeded(files) {
  const paths = classifiable(files);
  if (paths.length === 0) return true;
  return !paths.every(
    (path) =>
      !apiReads(path) &&
      (movesNoSuite(path) || API_UNRELATED_PREFIXES.some((prefix) => path.startsWith(prefix))),
  );
}

/**
 * @param {readonly string[]} args
 * @param {string | undefined} [cwd]
 * @returns {string}
 */
function git(args, cwd) {
  return execFileSync(GIT, [...args], { encoding: "utf8", cwd, windowsHide: true });
}

/**
 * No `.trim()` and no newline split: trimming rewrites the committable path
 * ` plan/evil.ts` into one that classifies as prose.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePaths(raw) {
  return raw.split("\0").filter((path) => path !== "");
}

/**
 * Three-dot: HEAD is the merge commit and the base branch may have moved, so two-dot
 * would report the base branch's own newer commits as changes. `baseSha` replaces
 * `origin/<baseRef>` for a merge queue entry, whose base is a commit rather than a branch.
 *
 * @param {string} baseRef
 * @param {{ cwd?: string; baseSha?: string }} [options]
 * @returns {string[] | null}
 */
export function changedFiles(baseRef, options = {}) {
  const cwd = options.cwd;
  const base = options.baseSha ?? `origin/${baseRef}`;
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], cwd);
  } catch {
    return null;
  }
  return parsePaths(git(["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`], cwd));
}

/**
 * @param {string} name
 * @param {boolean} value
 * @param {string} why
 */
function report(name, value, why) {
  stdout.write(`${name}=${value} (${why})\n`);
  const outputFile = env["GITHUB_OUTPUT"];
  if (outputFile !== undefined && outputFile !== "") {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

/**
 * Writes every classification, not only the one in mind: an output this script never
 * wrote arrives as the empty string, which the workflow must read as the full suite.
 *
 * @param {string} why
 */
function reportFullSuite(why) {
  report("plan_only", false, why);
  report("admin_only", false, why);
  report("ui_needed", true, why);
  report("api_needed", true, why);
}

/**
 * A merge queue entry carries every PR queued ahead of it, so its diff runs from the queue's base
 * commit; a pull request diffs against its base branch.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {{ base: string; options: { baseSha?: string }; baseRef: string } | { skip: string }}
 */
export function diffBase(environment) {
  const eventName = environment["GITHUB_EVENT_NAME"];
  if (eventName === "merge_group") {
    const baseSha = environment["MERGE_GROUP_BASE_SHA"] ?? "";
    if (!/^[0-9a-f]{40}$/.test(baseSha)) return { skip: "merge_group without a base SHA" };
    return { base: baseSha, options: { baseSha }, baseRef: "" };
  }
  if (eventName !== undefined && eventName !== "pull_request") {
    return { skip: `event is ${eventName}, not pull_request or merge_group` };
  }
  const baseRef = environment["BASE_REF"] ?? environment["GITHUB_BASE_REF"] ?? "";
  if (baseRef === "") return { skip: "no base ref available" };
  return { base: `origin/${baseRef}`, options: {}, baseRef };
}

function main() {
  const resolved = diffBase(env);
  if ("skip" in resolved) {
    reportFullSuite(resolved.skip);
    return;
  }
  const { base, options, baseRef } = resolved;

  let files;
  try {
    files = changedFiles(baseRef, options);
  } catch (error) {
    stdout.write(`::warning::ci-plan-only: diff failed (${String(error)})\n`);
    reportFullSuite("diff failed");
    return;
  }
  if (files === null) {
    stdout.write(`::warning::ci-plan-only: cannot resolve ${base}\n`);
    reportFullSuite(`${base} not resolvable`);
    return;
  }

  stdout.write(`Changed vs ${base} (${files.length} path(s)):\n`);
  for (const path of files.slice(0, LOG_LIMIT)) stdout.write(`  ${JSON.stringify(path)}\n`);
  if (files.length > LOG_LIMIT) stdout.write(`  ... and ${files.length - LOG_LIMIT} more\n`);

  if (files.length === 0) {
    reportFullSuite("empty diff, so nothing was classified");
    return;
  }

  const fastLaneScope = [
    ...FAST_LANE_PREFIXES,
    `${DOCS_PREFIX}** (except ${[...DOCS_OFF_LANE, ...DOCS_OFF_LANE_PREFIXES].join(", ")})`,
    `${GITHUB_PREFIX}** (except ${GITHUB_OFF_LANE_PREFIXES.join(", ")})`,
    ...FAST_LANE_FILES,
  ].join(", ");
  const mapped = classifiable(files);
  const outsidePlan = mapped.filter((path) => !isFastLanePath(path));
  report(
    "plan_only",
    isPlanOnly(files),
    outsidePlan.length === 0
      ? `${files.length} path(s), all in ${fastLaneScope}`
      : `${outsidePlan.length} path(s) outside ${fastLaneScope}, first: ${JSON.stringify(outsidePlan[0])}`,
  );

  const adminScope = [...ADMIN_ONLY_PREFIXES, ...FAST_LANE_FILES].join(", ");
  const outsideAdmin = mapped.filter((path) => !isAdminPath(path));
  report(
    "admin_only",
    isAdminOnly(files),
    outsideAdmin.length === 0
      ? `${files.length} path(s), all under ${adminScope}`
      : `${outsideAdmin.length} path(s) outside ${adminScope}, first: ${JSON.stringify(outsideAdmin[0])}`,
  );

  const uiNeededBy = mapped.find((path) => isUiNeeded([path]));
  report(
    "ui_needed",
    isUiNeeded(files),
    uiNeededBy === undefined
      ? "no path reaches the browser suite"
      : `first path the browser suite needs: ${JSON.stringify(uiNeededBy)}`,
  );

  const apiNeededBy = mapped.find((path) => isApiNeeded([path]));
  report(
    "api_needed",
    isApiNeeded(files),
    apiNeededBy === undefined
      ? "no path reaches the API suite"
      : `first path the API suite needs: ${JSON.stringify(apiNeededBy)}`,
  );
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
