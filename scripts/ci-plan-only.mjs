#!/usr/bin/env node
// @ts-check
/**
 * Decides how much work a required job does, never whether it runs: a required context that never reports blocks a pull
 * request or queue entry forever, so every uncertain case resolves to `false`. The workflow runs the copy at the BASE ref,
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
export const FAST_LANE_PREFIXES = [PLAN_PREFIX, ".claude/", "apps/site/"];

/**
 * Matched by equality, not prefix: as a prefix `CLAUDE.md` would admit `CLAUDE.md.bak`,
 * and equality keeps `apps/api/CONTRIBUTING.md` code rather than prose.
 */
export const FAST_LANE_FILES = ["CLAUDE.md", "PROJECT_INSTRUCTIONS.md", "CONTRIBUTING.md"];

/**
 * Markdown only, not a bare prefix: `docs/openapi/*.json` is a generated API contract a
 * test rebuilds and compares, so it is code.
 */
export const DOCS_PREFIX = "docs/";

export const MARKDOWN_SUFFIX = ".md";

/**
 * Off the lane because `apps/api/e2e/security/matrix-coverage.e2e.ts` parses this file's
 * authorization matrix at runtime, and that suite is one the lane reports green without
 * running.
 */
export const DOCS_OFF_LANE = ["docs/SECURITY_DESIGN.md"];

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isDocsMarkdown(path) {
  if (!path.startsWith(DOCS_PREFIX)) return false;
  if (!path.endsWith(MARKDOWN_SUFFIX)) return false;
  return !DOCS_OFF_LANE.includes(path);
}

const LOG_LIMIT = 40;

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isFastLanePath(path) {
  if (FAST_LANE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (isDocsMarkdown(path)) return true;
  return FAST_LANE_FILES.includes(path);
}

/**
 * An empty list is NOT plan-only: "saw nothing" must never read as "saw only prose".
 *
 * @param {readonly string[]} files
 * @returns {boolean}
 */
export function isPlanOnly(files) {
  const paths = files.filter((path) => path !== "");
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
  const paths = files.filter((path) => path !== "");
  if (paths.length === 0) return false;
  return paths.every(
    (path) => ADMIN_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)) || isFastLanePath(path),
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
 * wrote arrives as the empty string, one `== 'false'` away from inverting.
 *
 * @param {string} why
 */
function reportAllFalse(why) {
  report("plan_only", false, why);
  report("admin_only", false, why);
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
    reportAllFalse(resolved.skip);
    return;
  }
  const { base, options, baseRef } = resolved;

  let files;
  try {
    files = changedFiles(baseRef, options);
  } catch (error) {
    stdout.write(`::warning::ci-plan-only: diff failed (${String(error)})\n`);
    reportAllFalse("diff failed");
    return;
  }
  if (files === null) {
    stdout.write(`::warning::ci-plan-only: cannot resolve ${base}\n`);
    reportAllFalse(`${base} not resolvable`);
    return;
  }

  stdout.write(`Changed vs ${base} (${files.length} path(s)):\n`);
  for (const path of files.slice(0, LOG_LIMIT)) stdout.write(`  ${JSON.stringify(path)}\n`);
  if (files.length > LOG_LIMIT) stdout.write(`  ... and ${files.length - LOG_LIMIT} more\n`);

  if (files.length === 0) {
    reportAllFalse("empty diff, so nothing was classified");
    return;
  }

  const fastLaneScope = [
    ...FAST_LANE_PREFIXES,
    `${DOCS_PREFIX}**${MARKDOWN_SUFFIX} (except ${DOCS_OFF_LANE.join(", ")})`,
    ...FAST_LANE_FILES,
  ].join(", ");
  const outsidePlan = files.filter((path) => !isFastLanePath(path));
  report(
    "plan_only",
    isPlanOnly(files),
    outsidePlan.length === 0
      ? `${files.length} path(s), all in ${fastLaneScope}`
      : `${outsidePlan.length} path(s) outside ${fastLaneScope}, first: ${JSON.stringify(outsidePlan[0])}`,
  );

  const adminScope = [...ADMIN_ONLY_PREFIXES, ...FAST_LANE_FILES].join(", ");
  const outsideAdmin = files.filter(
    (path) =>
      !ADMIN_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)) && !isFastLanePath(path),
  );
  report(
    "admin_only",
    isAdminOnly(files),
    outsideAdmin.length === 0
      ? `${files.length} path(s), all under ${adminScope}`
      : `${outsideAdmin.length} path(s) outside ${adminScope}, first: ${JSON.stringify(outsideAdmin[0])}`,
  );
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
