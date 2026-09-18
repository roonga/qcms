#!/usr/bin/env node
// @ts-check
/**
 * Classify a pull request diff, so a job does the work its diff can actually be
 * observed by and no more. Two classifications, both fail-safe:
 *
 *   - **`plan_only`**: every changed path is in the fast-lane set - the `plan/`
 *     scratch tree, MARKDOWN under `.claude/` (the agent and skill definitions, not
 *     the settings file and not a hook script), and the three root instruction files.
 *     Those changes skip the application build, the unit suites and all three
 *     end-to-end jobs, but `check:plan` still runs every gate that reads any of those
 *     paths. See {@link isPlanOnly}.
 *   - **`admin_only`**: every changed path is under `apps/admin/`, `docs/` or the
 *     fast-lane set, so nothing in the diff can reach a portal-rendered surface. See
 *     {@link isAdminOnly}.
 *
 * The file keeps its original name despite now answering two questions. The workflow
 * runs the copy at the pull request's BASE ref by path (see below), so a rename would
 * make every PR read a classifier that is not there and take the full run until the
 * new name reached `main` - a cost with nothing on the other side of it.
 *
 * ## The contract this script has to keep
 *
 * `protect-main` requires four check contexts and has no bypass actors. A context
 * that never reports leaves a PR "Expected - waiting for status" forever, which is
 * strictly worse than a slow PR. So this script only ever decides how much work a
 * job does; it never decides whether a job runs. Every required job runs on every
 * event and reports its context either way.
 *
 * Consequently every uncertain case resolves to `false` (run everything):
 *
 *   - any event that is not `pull_request` (a push to main, a `workflow_dispatch`
 *     rescue run): the fast lane is a pull-request optimisation and main's own
 *     history is worth the full suite;
 *   - an empty diff, or a base ref that cannot be resolved;
 *   - anything that throws.
 *
 * Renames are read with `--no-renames`, so a path moved out of the fast-lane set shows
 * up as a delete inside it PLUS an add outside it, and the PR is correctly code.
 *
 * ## Two properties that are not obvious, and are the reason this file has tests
 *
 * **This script never classifies its own diff.** The workflow does not run the
 * checked-out copy; it runs the copy from the pull request's BASE ref against the
 * head checkout (`git show "origin/$GITHUB_BASE_REF:scripts/ci-plan-only.mjs"`).
 * Otherwise a pull request that refactors `isPlanOnly` and introduces a defect
 * answering `true` too readily would be classified by its own broken code: its diff
 * touches only this file, which is outside the fast-lane set, so a full run is intended -
 * but the broken copy would answer `plan_only=true`, `pnpm test` is one of the steps
 * the fast lane skips, and the very tests written to catch that defect would not
 * run. It would merge in 45 green seconds and every later PR would take the fast
 * lane. The base copy only ever shells out to `git`, so running it against a head
 * checkout is safe. Consequence to expect: any PR that touches this file gets a full
 * run, which is the point.
 *
 * **Paths are read NUL-separated and never trimmed.** This preserves unusual but
 * valid names and prevents a leading space from changing an outside path into a
 * fast-lane path.
 *
 * Usage:
 *   node scripts/ci-plan-only.mjs                  # reads GITHUB_* from the env
 *   BASE_REF=main node scripts/ci-plan-only.mjs    # local dry run
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { argv, env, stdout } from "node:process";
import { pathToFileURL } from "node:url";

// On Windows, Node's execFile does not resolve `git` -> `git.exe` from PATH
// (unlike a shell), so a bare "git" ENOENTs even when git is installed.
const GIT = process.platform === "win32" ? "git.exe" : "git";

/** The scratch tree the fast lane started as. Trailing slash: `planning.md` is not it. */
export const PLAN_PREFIX = "plan/";

/**
 * Directories the fast lane covers WHATEVER the file is.
 *
 * `plan/` alone, and it stays alone until something argues it should not. The tree is
 * committed scratch: no tsconfig includes it, no `@source` root reaches it, nothing
 * imports from it, and the gates that do read it (`check-admin-theme`, `check:plan`'s
 * ESLint and Prettier) all run on the lane.
 *
 * **The separator is what makes the prefix safe.** Without it `plan` would match
 * `planner.ts`.
 */
export const FAST_LANE_PREFIXES = [PLAN_PREFIX];

/**
 * Directories the fast lane covers FOR MARKDOWN ONLY.
 *
 * `.claude/` holds the agent definitions and skill files that issue #873 is about, and
 * nothing there is built, imported, bundled or served. But it also holds
 * `.claude/settings.json`, which is harness configuration the harness ACTS on: a hook
 * command, a `permissions.deny` list, a default permission mode. It can hold hook
 * scripts too.
 *
 * **What this rule does and does not buy, stated exactly** (reviews of PR #952). It is
 * not a line between inert text and executable text, because the Markdown it admits is
 * not inert either: an agent definition carries harness-interpreted frontmatter, so
 * `.claude/agents/task-reviewer.md` is where that agent's `tools:` grant and `model:`
 * are set, and a fast-lane pull request can widen the grant or change the model with
 * four green contexts in about a minute. That surface is exactly what issue #873 asked
 * to put on the lane, and no CI job ever gated it. What the rule draws a line around is
 * narrower and worth having anyway: the settings file and the hook scripts, which
 * configure the harness for the whole repository rather than one agent, and which the
 * first version of this change admitted.
 *
 * The probe that set the line: a tracked `.claude/hooks/on-stop.sh`, a `.py` beside it,
 * and a `settings.json` wiring the hook, emptying `permissions.deny` and setting
 * `defaultMode` to `bypassPermissions` all pass `pnpm check:plan`. No gate reads any of
 * it - the full suite was equally blind, so the detection delta is nil - but the TIME
 * delta is not: `protect-main` requires zero approving reviews and has no CODEOWNERS, so
 * the four contexts are the only platform-enforced gate, and the lane takes that window
 * from roughly 30-55 minutes to about one. Whether that is an acceptable trade is a
 * security acceptance and belongs to the Code Owner, so this classifier does not make
 * it: until it is ruled on, nothing about those files changes, here or in
 * {@link ADMIN_ONLY_PREFIXES}.
 *
 * See CONTRIBUTING, "The instruction and plan fast lane", for the open question.
 */
export const FAST_LANE_MARKDOWN_PREFIXES = [".claude/"];

/**
 * The one suffix {@link FAST_LANE_MARKDOWN_PREFIXES} admits, lowercase and exact.
 *
 * `.claude/notes.MD` is deliberately NOT on the lane, and not out of fussiness. The
 * gates that make the lane safe select their input with a case-sensitive `git ls-files`
 * pathspec of `*.md` (`check-no-em-dash`, `check-ports`, `check-vendor-pin`,
 * `check-lint-coverage`), so an uppercase spelling is a file the lane's own gates would
 * not open. Admitting it would be admitting an unscanned file.
 */
export const FAST_LANE_MARKDOWN_SUFFIX = ".md";

/**
 * Repository-root instruction files the fast lane covers, matched by EQUALITY.
 *
 * Not prefixes, and that distinction is the whole safety of the list: as a prefix
 * `CLAUDE.md` would also admit `CLAUDE.md.bak` and `CONTRIBUTING.md` would admit
 * `CONTRIBUTING.mdx`, neither of which any gate below has been checked against.
 * Equality also keeps the list anchored at the root, so `apps/api/CONTRIBUTING.md`
 * - which `packages/create-qcms-app` reads when it decides what an app ships - is
 * code, as it should be.
 *
 * Each of these three is prose addressed to a contributor or an agent. What reads
 * them is enumerated in CONTRIBUTING, "The instruction and plan fast lane", and
 * every one of those readers runs in `check:plan`.
 */
export const FAST_LANE_FILES = ["CLAUDE.md", "PROJECT_INSTRUCTIONS.md", "CONTRIBUTING.md"];

/** How many changed paths the log prints before it truncates. */
const LOG_LIMIT = 40;

/**
 * Is this one path in the fast-lane set?
 *
 * Three rules, deliberately of three different shapes: a directory prefix, a directory
 * prefix plus a suffix, and equality. The suffix is tested against the WHOLE path
 * rather than the last segment, which is what makes `.claude/x.md/evil.sh` code: a
 * directory may be named `x.md`, and only the full path's own ending says whether the
 * thing that changed is the Markdown file.
 *
 * @param {string} path repo-relative, exactly as git recorded it.
 * @returns {boolean}
 */
export function isFastLanePath(path) {
  if (FAST_LANE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (
    path.endsWith(FAST_LANE_MARKDOWN_SUFFIX) &&
    FAST_LANE_MARKDOWN_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return true;
  }
  return FAST_LANE_FILES.includes(path);
}

/**
 * Is every changed path in the fast-lane set?
 *
 * The name and the `plan_only` output keep their original spelling on purpose. The
 * workflow reads this script from the pull request's BASE ref, so the output name is
 * a contract between two commits: renaming it would make every PR whose base predates
 * the rename publish the old name, `ci.yml` read an empty string for the new one, and
 * the lane quietly close until the rename reached `main`. That failure is safe but it
 * is also pointless, and the same argument is why the file itself is not renamed.
 *
 * An empty list is NOT plan-only. An empty diff means the classification failed to
 * see anything, and "saw nothing" must never read as "saw only prose".
 *
 * @param {readonly string[]} files repo-relative paths, as `git diff --name-only` reports them.
 * @returns {boolean}
 */
export function isPlanOnly(files) {
  const paths = files.filter((path) => path !== "");
  if (paths.length === 0) return false;
  return paths.every(isFastLanePath);
}

/**
 * Directories a change can be confined to without any portal-rendered surface moving.
 *
 * `apps/admin/` is the whole point; `docs/` and `plan/` ride along because prose cannot
 * render anything either and an admin PR routinely carries some.
 *
 * **`.claude/` is deliberately NOT a prefix here, and the reason is not about
 * rendering.** On the rendering question it plainly belongs: nothing under `.claude/`
 * moves a portal screen at any extension, and an earlier version of this list said so
 * and carried the whole directory. What that missed (delta review of PR #952) is that
 * `browser-e2e` is the SLOWEST required context - 30.5 minutes against 9 for `verify` on
 * this pull request's own run - so it is the context that sets the merge window, and the
 * open Code Owner question about `.claude/settings.json` and hook scripts is a question
 * about that window. At this file's base a `settings.json` change took the whole browser
 * suite; with the prefix here it would take `--project admin-chromium` only. That is a
 * change to the very thing being ruled on, made by the pull request that says it changes
 * nothing until the ruling.
 *
 * So the fast-lane set reaches this classification through {@link isFastLanePath}
 * instead, which admits Markdown under `.claude/` and no more. Markdown there still
 * narrows the browser suite; the settings file and the hook scripts still run everything,
 * exactly as they do today.
 *
 * The invariant that does matter still holds and is pinned by a test: every path on the
 * fast lane is admin-only too. A path the narrow lane lets skip the browser suite
 * ENTIRELY must also be one the wide lane lets narrow it.
 *
 * What is deliberately NOT here is the condition someone will reach for first,
 * "the diff touches admin". The admin and the portal share `@roonga/qcms-ui` and
 * `@roonga/qcms-core`, so a PR touching either genuinely can change portal behaviour and
 * must run the whole suite. The safe question is what the diff touches OUTSIDE this
 * list, and one path outside it is enough to run everything.
 */
export const ADMIN_ONLY_PREFIXES = ["apps/admin/", "docs/", ...FAST_LANE_PREFIXES];

/**
 * Can this diff move a portal-rendered surface?
 *
 * `false` whenever the answer is not a confident no, on the same rule as
 * {@link isPlanOnly}: an empty list is a classification that saw nothing, and "saw
 * nothing" must never read as "saw only the admin". Every uncertain case runs the
 * full browser suite (issue #696).
 *
 * The admin's own browser project is NOT skipped when this is true - `browser-e2e`
 * narrows to `--project admin-chromium` instead, so an admin-only PR still gets the
 * browser coverage for the surface it did change. The job was already running that
 * project; what it stops paying for is the portal half it cannot exercise.
 *
 * @param {readonly string[]} files repo-relative paths, as `git diff --name-only` reports them.
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
 * @param {string | undefined} [cwd] repository to run in; the process cwd by default.
 * @returns {string}
 */
function git(args, cwd) {
  return execFileSync(GIT, [...args], { encoding: "utf8", cwd });
}

/**
 * Split `git`'s NUL-separated output into paths.
 *
 * Deliberately no `.trim()` and no `.split("\n")`. A newline-separated read has to
 * trim to survive CRLF, and trimming silently rewrites ` plan/evil.ts` (a real,
 * committable path that git does not quote) into `plan/evil.ts`, which classifies as
 * prose. NUL separation has no such ambiguity: git emits the recorded bytes.
 *
 * Exported so the parse can be tested without a repository. The layer above it is
 * tested against a real one, because this defect lived here and not in
 * {@link isPlanOnly}.
 *
 * @param {string} raw NUL-separated `git ... -z` output.
 * @returns {string[]}
 */
export function parsePaths(raw) {
  return raw.split("\0").filter((path) => path !== "");
}

/**
 * The paths this PR changes relative to the merge base with its base branch.
 *
 * Three-dot: on a `pull_request` event the checked-out HEAD is the merge commit, and
 * the base branch may have moved since. Two-dot would then report main's own newer
 * commits as changes (in reverse), which is wrong in both directions.
 *
 * @param {string} baseRef base branch name, e.g. "main".
 * @param {{ cwd?: string }} [options] repository to read; the process cwd by default.
 * @returns {string[] | null} paths, or null when the base could not be resolved.
 */
export function changedFiles(baseRef, options = {}) {
  const cwd = options.cwd;
  const base = `origin/${baseRef}`;
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], cwd);
  } catch {
    return null;
  }
  return parsePaths(git(["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`], cwd));
}

/**
 * Write one `<name>=<value>` where the workflow can read it, and echo it to the log.
 *
 * @param {string} name output name, e.g. "plan_only".
 * @param {boolean} value
 * @param {string} why one line, printed so a run explains itself without a rerun.
 */
function report(name, value, why) {
  stdout.write(`${name}=${value} (${why})\n`);
  const outputFile = env["GITHUB_OUTPUT"];
  if (outputFile !== undefined && outputFile !== "") {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

/**
 * Report every classification as `false` with one shared reason.
 *
 * The fail-safe path, and it writes ALL of them rather than only the one it was
 * thinking about: an output a job reads and this script never wrote arrives as the
 * empty string, and while `'' != 'true'` happens to be the safe direction today, a
 * classification that silently omits itself is one `== 'false'` away from inverting.
 *
 * @param {string} why
 */
function reportAllFalse(why) {
  report("plan_only", false, why);
  report("admin_only", false, why);
}

function main() {
  const eventName = env["GITHUB_EVENT_NAME"];
  const baseRef = env["BASE_REF"] ?? env["GITHUB_BASE_REF"] ?? "";

  if (eventName !== undefined && eventName !== "pull_request") {
    reportAllFalse(`event is ${eventName}, not pull_request`);
    return;
  }
  if (baseRef === "") {
    reportAllFalse("no base ref available");
    return;
  }

  let files;
  try {
    files = changedFiles(baseRef);
  } catch (error) {
    stdout.write(`::warning::ci-plan-only: diff failed (${String(error)})\n`);
    reportAllFalse("diff failed");
    return;
  }
  if (files === null) {
    stdout.write(`::warning::ci-plan-only: cannot resolve origin/${baseRef}\n`);
    reportAllFalse(`origin/${baseRef} not resolvable`);
    return;
  }

  // Quoted, not bare. An indented bare path renders ` plan/evil.ts` and `plan/evil.ts`
  // identically in a run log, and a leading space is the difference between prose and
  // a TypeScript file the fast lane must not skip. JSON.stringify makes the boundary
  // of every path visible, including tabs and non-ASCII.
  stdout.write(`Changed vs origin/${baseRef} (${files.length} path(s)):\n`);
  for (const path of files.slice(0, LOG_LIMIT)) stdout.write(`  ${JSON.stringify(path)}\n`);
  if (files.length > LOG_LIMIT) stdout.write(`  ... and ${files.length - LOG_LIMIT} more\n`);

  if (files.length === 0) {
    reportAllFalse("empty diff, so nothing was classified");
    return;
  }

  const fastLaneScope = [
    ...FAST_LANE_PREFIXES,
    ...FAST_LANE_MARKDOWN_PREFIXES.map((prefix) => `${prefix}**/*${FAST_LANE_MARKDOWN_SUFFIX}`),
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
