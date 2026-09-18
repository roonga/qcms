import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_ONLY_PREFIXES,
  FAST_LANE_FILES,
  FAST_LANE_PREFIXES,
  PLAN_PREFIX,
  changedFiles,
  isAdminOnly,
  isPlanOnly,
  parsePaths,
} from "./ci-plan-only.mjs";

/**
 * Tests for the CI fast-lane classifier.
 *
 * The asymmetry here is the whole point. A false negative (calling a plan-only PR
 * "code") costs ~20 minutes of runner time and nothing else. A false positive
 * (calling a code PR "plan-only") silences build, typecheck, lint, the unit suites
 * and all three end-to-end suites on a change that could break any of them, while
 * every required context still reports green. So every case below that is not
 * unambiguously prose resolves to `false`.
 */

describe("plan-only classification", () => {
  it("accepts a diff that is entirely under plan/", () => {
    expect(isPlanOnly(["plan/design-brief.md", "plan/conditional-flow-decision.md"])).toBe(true);
  });

  it("accepts a nested plan/ path", () => {
    expect(isPlanOnly(["plan/theme-palettes/candidate-3.css"])).toBe(true);
  });

  it("rejects a diff that is entirely code", () => {
    expect(isPlanOnly(["packages/core/src/rules.ts"])).toBe(false);
  });

  it("rejects a MIXED diff - plan/ plus a single code file", () => {
    // The case worth naming: the plan files dominate the diff by count, and the one
    // source file is exactly what the full suite exists to check.
    expect(
      isPlanOnly([
        "plan/admin-design-contracts.md",
        "plan/admin-ux-audit.md",
        "plan/design-brief.md",
        "packages/ui/src/theme.css",
      ]),
    ).toBe(false);
  });

  it("rejects a diff that also touches the workflow that implements the lane", () => {
    // Self-reference: a change to the fast lane must be proven by the full suite.
    expect(isPlanOnly(["plan/ci-notes.md", ".github/workflows/ci.yml"])).toBe(false);
  });

  it("rejects an EMPTY diff", () => {
    // "Saw nothing" must never read as "saw only prose". An empty list means the
    // classification did not work, not that the PR is harmless.
    expect(isPlanOnly([])).toBe(false);
    expect(isPlanOnly([""])).toBe(false);
  });

  it("does not treat a root path that merely STARTS WITH the word plan as plan/", () => {
    // The prefix is `plan/`, not `plan`. Without the separator these all pass as
    // prose, and `planner.ts` is source.
    expect(isPlanOnly(["planning.md"])).toBe(false);
    expect(isPlanOnly(["plans/roadmap.md"])).toBe(false);
    expect(isPlanOnly(["packages/core/src/planner.ts"])).toBe(false);
  });

  it("does not treat a plan/ directory nested under another root as plan/", () => {
    // Only the repo-root `plan/` is excluded by check-no-em-dash, check-ports and
    // check-lint-coverage; `docs/plan/` would be fully in scope for all three.
    expect(isPlanOnly(["docs/plan/notes.md"])).toBe(false);
    expect(isPlanOnly(["apps/admin/plan/notes.md"])).toBe(false);
  });

  it("still classifies plan/admin-theme as plan-only, which is why check:plan exists", () => {
    // plan/admin-theme/tokens.css is the SOURCE that check-admin-theme gates
    // apps/admin/app/theme.css against, so this diff takes the fast lane and the
    // fast lane has to run that gate. Recorded here so the two halves stay together.
    expect(isPlanOnly(["plan/admin-theme/tokens.css"])).toBe(true);
  });

  it("keeps the prefix anchored with a trailing separator", () => {
    expect(PLAN_PREFIX).toBe("plan/");
  });
});

/**
 * The instruction tree on the lane (issue #873).
 *
 * PR #868 changed `.claude/agents/task-reviewer.md` and `CLAUDE.md` and paid the full
 * matrix twice, about an hour of wall time, nearly all of it `browser-e2e` on a diff
 * with no browser, app or package code in it.
 *
 * What made that safe to fix is not that the files look like prose. It is that every
 * gate and test which READS one of them now runs inside `check:plan` (asserted at the
 * bottom of this file), and that every such reader lives OUTSIDE the lane - in
 * `scripts/`, `packages/` or `apps/` - so the pull request that adds the next one
 * takes a full run and gets to notice.
 */
describe("plan-only classification: the instruction tree", () => {
  it("accepts an agent or skill definition under .claude/", () => {
    expect(isPlanOnly([".claude/agents/task-reviewer.md", ".claude/skills/task/SKILL.md"])).toBe(
      true,
    );
  });

  it("accepts the three root instruction files", () => {
    expect(isPlanOnly(["CLAUDE.md"])).toBe(true);
    expect(isPlanOnly(["PROJECT_INSTRUCTIONS.md"])).toBe(true);
    expect(isPlanOnly(["CONTRIBUTING.md"])).toBe(true);
  });

  it("accepts the diff issue #873 was filed for", () => {
    expect(isPlanOnly([".claude/agents/task-reviewer.md", "CLAUDE.md"])).toBe(true);
  });

  it("REJECTS a .claude/ diff carrying one source file", () => {
    // The case the lane exists to get wrong-way-safe. The instruction files dominate
    // by count and the single `.ts` is exactly what the skipped suites check.
    expect(
      isPlanOnly([
        ".claude/agents/task-executor.md",
        ".claude/skills/next-issue/SKILL.md",
        "CLAUDE.md",
        "packages/core/src/rules.ts",
      ]),
    ).toBe(false);
  });

  it("REJECTS docs/, which several gates outside check:plan read", () => {
    // Proposed in #873 and deliberately left out. `docs/openapi/*.json` is an API
    // contract artifact proven by apps/api's `openapi-document.test.ts`, which needs a
    // build the lane does not do; `docs/SECURITY_DESIGN.md` §3.2 is parsed at RUNTIME
    // by `apps/api/e2e/security/matrix-coverage.e2e.ts`, which is the `api-e2e`
    // required context the lane reports green without running. Neither reader can be
    // moved into `check:plan`, so the whole tree stays code.
    expect(isPlanOnly(["docs/openapi/admin.json"])).toBe(false);
    expect(isPlanOnly(["docs/SECURITY_DESIGN.md"])).toBe(false);
    expect(isPlanOnly(["docs/PORTS.md"])).toBe(false);
    expect(isPlanOnly(["CLAUDE.md", "docs/features/README.md"])).toBe(false);
  });

  it("matches the root instruction files by EQUALITY, not as a prefix", () => {
    // As prefixes these would admit files no gate on the lane has been checked
    // against, and `apps/api/CONTRIBUTING.md` is read by the scaffolding generator.
    expect(isPlanOnly(["CLAUDE.md.bak"])).toBe(false);
    expect(isPlanOnly(["CONTRIBUTING.mdx"])).toBe(false);
    expect(isPlanOnly(["apps/api/CONTRIBUTING.md"])).toBe(false);
    expect(isPlanOnly(["apps/admin/CLAUDE.md"])).toBe(false);
  });

  it("keeps the .claude prefix anchored with its separator", () => {
    expect(FAST_LANE_PREFIXES).toEqual(["plan/", ".claude/"]);
    expect(FAST_LANE_FILES).toEqual(["CLAUDE.md", "PROJECT_INSTRUCTIONS.md", "CONTRIBUTING.md"]);
    expect(isPlanOnly([".claude-hooks/on-stop.mjs"])).toBe(false);
    expect(isPlanOnly([".claudeignore"])).toBe(false);
  });

  it("preserves a leading space rather than accepting it as an instruction file", () => {
    // The same defect the NUL parse exists for, asserted on the widened set: a
    // committed ` CLAUDE.md` is a real path, and a reader that trimmed would wave
    // through whatever it actually is.
    expect(isPlanOnly(parsePaths(" CLAUDE.md\0"))).toBe(false);
    expect(isPlanOnly(parsePaths(" .claude/evil.ts\0"))).toBe(false);
  });

  it("still rejects a diff that also touches the workflow or the classifier", () => {
    expect(isPlanOnly(["CLAUDE.md", ".github/workflows/ci.yml"])).toBe(false);
    expect(isPlanOnly([".claude/agents/dev-task.md", "scripts/ci-plan-only.mjs"])).toBe(false);
  });
});

/**
 * Admin-only classification (issue #696).
 *
 * The asymmetry is milder than the plan-only lane's but the same shape. A false
 * negative costs the full browser suite on a PR that did not need it, which is what
 * happens today. A false positive runs only `admin-chromium` on a diff that CAN move
 * a portal surface, so a portal regression merges with a green required context.
 *
 * The trap worth being explicit about is `@roonga/qcms-ui` and
 * `@roonga/qcms-core`: the two apps share them, so "touches admin" and "cannot reach
 * the portal" are different questions and only the second one is safe.
 */
describe("admin-only classification", () => {
  it("accepts a diff confined to the admin app", () => {
    expect(isAdminOnly(["apps/admin/app/(shell)/page.tsx", "apps/admin/e2e/forms.pw.ts"])).toBe(
      true,
    );
  });

  it("accepts an admin diff carrying prose, which is what an admin PR looks like", () => {
    expect(
      isAdminOnly([
        "apps/admin/components/forms/form-page-header.tsx",
        "docs/features/README.md",
        "plan/admin-ux-audit.md",
      ]),
    ).toBe(true);
  });

  it("REJECTS a diff touching the shared UI package", () => {
    // The case the classification exists to get right. `@roonga/qcms-ui` renders
    // both apps, so an admin PR that also moves a control can break the portal.
    expect(isAdminOnly(["apps/admin/app/page.tsx", "packages/ui/src/registry.tsx"])).toBe(false);
  });

  it("REJECTS a diff touching the shared core package", () => {
    expect(isAdminOnly(["apps/admin/app/page.tsx", "packages/core/src/rules.ts"])).toBe(false);
  });

  it("rejects anything that touches the portal, the API or the workflow itself", () => {
    expect(isAdminOnly(["apps/portal/app/page.tsx"])).toBe(false);
    expect(isAdminOnly(["apps/admin/app/page.tsx", "apps/api/src/routes/forms.ts"])).toBe(false);
    expect(isAdminOnly(["apps/admin/app/page.tsx", ".github/workflows/ci.yml"])).toBe(false);
    expect(isAdminOnly(["apps/admin/app/page.tsx", "playwright.config.ts"])).toBe(false);
    expect(isAdminOnly(["apps/admin/app/page.tsx", "pnpm-lock.yaml"])).toBe(false);
  });

  it("rejects an EMPTY diff, exactly as the plan-only lane does", () => {
    // "Saw nothing" must never read as "saw only the admin". Both classifications
    // inherit the fail-safe posture the `changes` job's own comment states.
    expect(isAdminOnly([])).toBe(false);
    expect(isAdminOnly([""])).toBe(false);
  });

  it("keeps every prefix anchored with a trailing separator", () => {
    // `apps/administration/` and `docsite/` are not in scope, and without the
    // separator both would classify as admin-only.
    expect(ADMIN_ONLY_PREFIXES).toEqual(["apps/admin/", "docs/", "plan/", ".claude/"]);
    expect(isAdminOnly(["apps/administration/page.tsx"])).toBe(false);
    expect(isAdminOnly(["docsite/index.html"])).toBe(false);
    expect(isAdminOnly(["apps/admin"])).toBe(false);
  });

  it("preserves a leading space rather than accepting it as an admin path", () => {
    // The same defect the NUL parse exists for, asserted on the second lane too.
    expect(isAdminOnly(parsePaths(" apps/admin/evil.ts\0"))).toBe(false);
  });

  it("classifies a plan-only diff as admin-only too, which changes nothing", () => {
    // `plan/` is inside both scopes, and `plan_only` is checked first in every job,
    // so the narrower lane never sees these. Recorded so the overlap is deliberate
    // rather than discovered.
    expect(isPlanOnly(["plan/notes.md"])).toBe(true);
    expect(isAdminOnly(["plan/notes.md"])).toBe(true);
  });

  it("holds the containment invariant: every fast-lane path is admin-only too", () => {
    // Not a convenience. A path the NARROW lane lets skip the browser suite entirely
    // must also be one the WIDE lane lets narrow it, or an admin PR carrying a
    // `CLAUDE.md` tweak pays for the whole portal suite while the same tweak on its
    // own pays for none of it. Asserted over the sets rather than over examples, so a
    // future entry in either list cannot break it quietly.
    for (const prefix of FAST_LANE_PREFIXES) {
      expect(isAdminOnly([`${prefix}some/file.md`])).toBe(true);
    }
    for (const file of FAST_LANE_FILES) {
      expect(isAdminOnly([file])).toBe(true);
    }
    expect(
      isAdminOnly(["apps/admin/app/page.tsx", "CLAUDE.md", ".claude/skills/task/SKILL.md"]),
    ).toBe(true);
  });
});

/**
 * The half of the lane that is not in this file: what `check:plan` actually runs.
 *
 * The classification above decides which pull requests skip the build, the unit
 * suites and the three end-to-end jobs. What makes that safe is `check:plan` running
 * every gate and test that reads a fast-lane path. The two halves are in different
 * files and nothing but this block ties them together - the same shape of hole
 * `check:ci-parity` exists for one level up, and the same fix.
 *
 * Read from `package.json` rather than restated, so this cannot pass over a lane that
 * has quietly lost a gate.
 */
describe("check:plan covers what the lane skips", () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { scripts: Record<string, string> };
  const checkPlan = manifest.scripts["check:plan"] ?? "";

  it("runs the whole check:all gate set, not a hand-picked subset", () => {
    // Every text gate that reads the fast-lane tree is in `check:all`:
    // `check:no-em-dash`, `check:paths`, `check:ports`, `check:vendor-pin` and
    // `check:adr-citations` all scan tracked Markdown outside `plan/`, which is
    // exactly `.claude/**` and the three root files. Naming the whole set rather than
    // those five is what makes a gate added later cover the lane for free - and
    // `pnpm check:all` costs about 13 seconds against a tree with no build in it.
    expect(checkPlan).toContain("pnpm check:all");
  });

  it("prettier-checks every path the lane admits", () => {
    // `pnpm lint` (which the lane skips) is what normally runs `prettier --check .`.
    for (const target of [...FAST_LANE_PREFIXES, ...FAST_LANE_FILES]) {
      expect(checkPlan).toContain(target.replace(/\/$/, ""));
    }
  });

  it("runs the tooling test project, which is where the readers of this tree live", () => {
    // `scripts/agent-scratch.test.ts` asserts that six briefing files name the scratch
    // helper and that none of them spells the lane override as an unexported prefix;
    // `scripts/prune-worktrees.test.ts` asserts two skill files name the sweep. Both
    // are in `pnpm test`, which the lane skips, and both are broken by an ordinary
    // edit to a file the lane admits. The whole project runs rather than those two
    // files, so a test added later is covered without anyone updating a list.
    expect(checkPlan).toContain("pnpm test:tooling:no-build");
  });

  it("excludes exactly one tooling file from the lane, and says which", () => {
    // `scripts/sql-capture.test.ts` refuses to run until `packages/db` is built, and
    // building is the cost the lane exists to avoid. It reads nothing the lane admits.
    // Any OTHER tooling test that grows a build dependency fails `check:plan` loudly,
    // which is the direction that can be fixed rather than the one that goes unnoticed.
    const noBuild = manifest.scripts["test:tooling:no-build"] ?? "";
    expect(noBuild).toContain("--project tooling");
    expect(noBuild).toContain("sql-capture.test.ts");
    expect(noBuild.match(/--exclude/g) ?? []).toHaveLength(2);
    expect(noBuild).toContain("node_modules");
  });
});

describe("path parsing", () => {
  it("splits on NUL and drops the trailing empty field", () => {
    expect(parsePaths("plan/a.md\0plan/b.md\0")).toEqual(["plan/a.md", "plan/b.md"]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parsePaths("")).toEqual([]);
    expect(parsePaths("\0")).toEqual([]);
  });

  it("PRESERVES a leading space rather than trimming it away", () => {
    // The defect this replaced: `.split("\n").map(trim)` turned " plan/evil.ts" into
    // "plan/evil.ts", which classifies as prose. Trimming is not a tidy-up here, it is
    // a rewrite of the path git recorded.
    expect(parsePaths(" plan/evil.ts\0")).toEqual([" plan/evil.ts"]);
    expect(isPlanOnly(parsePaths(" plan/evil.ts\0"))).toBe(false);
  });

  it("preserves a newline inside a path", () => {
    // NUL separation is the only reason this is representable at all.
    expect(parsePaths("plan/a\nb.md\0")).toEqual(["plan/a\nb.md"]);
  });
});

/**
 * The layer the leading-space defect actually lived in.
 *
 * `isPlanOnly([" plan/evil.ts"])` was always correct; the bug was that
 * `changedFiles` never handed it that string. So this exercises a real repository
 * with a real commit at a path git does not quote, and asserts the byte sequence
 * survives the whole way to the classification.
 */
describe("changedFiles against a real repository", () => {
  let repo: string;

  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  const commit = (message: string): void => {
    git(["add", "-A"]);
    git([
      "-c",
      "user.name=Code Owner",
      "-c",
      "user.email=code-owner@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      message,
    ]);
  };

  const write = (relative: string, body: string): void => {
    const absolute = path.join(repo, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "qcms-ci-plan-only-"));
    git(["init", "-q", "-b", "main"]);
    write("README.md", "base\n");
    commit("base");
    // Stand in for the remote-tracking ref the workflow's checkout provides.
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("reads an ordinary plan-only change as plan-only", () => {
    write("plan/note.md", "prose\n");
    commit("plan note");
    const files = changedFiles("main", { cwd: repo });
    expect(files).toEqual(["plan/note.md"]);
    expect(isPlanOnly(files!)).toBe(true);
  });

  it("does NOT treat a committed path with a leading space as plan-only", () => {
    // ` plan/evil.ts` is a legal, committable path. `git diff --name-only` leaves it
    // unquoted because a space is not a character git escapes, so a newline-split
    // reader that trims sees `plan/evil.ts` and waves a TypeScript file through with
    // build, typecheck, lint, every test suite and check:lint-coverage skipped.
    write(" plan/evil.ts", "export const evil = 1;\n");
    commit("leading space");
    const files = changedFiles("main", { cwd: repo });
    expect(files).toContain(" plan/evil.ts");
    expect(files).not.toContain("plan/evil.ts");
    expect(isPlanOnly(files!)).toBe(false);
  });

  it("returns null for a base ref that does not resolve", () => {
    expect(changedFiles("no-such-branch", { cwd: repo })).toBeNull();
  });
});
