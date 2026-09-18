import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_ONLY_PREFIXES,
  FAST_LANE_FILES,
  FAST_LANE_MARKDOWN_PREFIXES,
  FAST_LANE_MARKDOWN_SUFFIX,
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
 * gate and test which READS one of them runs inside `check:plan` (asserted lower down),
 * and that no reader lives in `apps/` or `packages/`, which the lane does not run at
 * all (asserted lower down too, by a scan rather than by a comment).
 *
 * The set is narrower than the first version of this pull request: only MARKDOWN under
 * `.claude/`. That is not a line between inert text and executable text - an agent
 * definition's frontmatter sets that agent's `tools:` grant and `model:`, which the
 * lane now lets through in about a minute, and which is the surface #873 asked for. It
 * is a line around `.claude/settings.json` and hook scripts, which configure the
 * harness for the whole repository, and whether a one-minute merge window may carry
 * those is the Code Owner's call.
 */
describe("plan-only classification: the instruction tree", () => {
  it("accepts an agent or skill definition under .claude/", () => {
    expect(isPlanOnly([".claude/agents/task-reviewer.md", ".claude/skills/task/SKILL.md"])).toBe(
      true,
    );
  });

  it("REJECTS everything under .claude/ that is not Markdown", () => {
    // Narrowed in the review of PR #952, and the reason is not that these files can
    // break a build - nothing reads them, so the full suite was equally blind. It is
    // that they configure the harness for the WHOLE repository (a hook command, a
    // permission list, a default permission mode) rather than one agent, that
    // `protect-main` requires zero approving reviews and has no CODEOWNERS, so the four
    // contexts are the only platform-enforced gate, and that the lane takes that window
    // from roughly 30-55 minutes to about one. The Markdown next door is not inert
    // either - its frontmatter carries `tools:` and `model:` - but that surface is what
    // #873 asked for, where these were admitted by accident in the first version.
    expect(isPlanOnly([".claude/settings.json"])).toBe(false);
    expect(isPlanOnly([".claude/settings.local.json"])).toBe(false);
    expect(isPlanOnly([".claude/hooks/on-stop.sh"])).toBe(false);
    expect(isPlanOnly([".claude/hooks/x.py"])).toBe(false);
    expect(isPlanOnly([".claude/hooks/probe.mjs"])).toBe(false);
    expect(isPlanOnly([".claude/agents/task-executor"])).toBe(false);
  });

  it("REJECTS a MIXED diff - .claude/ Markdown plus one file that is not", () => {
    // The realistic shape: a settings change carried along with the agent edits it
    // goes with. One path outside the set is enough to run everything.
    expect(
      isPlanOnly([
        ".claude/agents/task-executor.md",
        ".claude/skills/next-issue/SKILL.md",
        ".claude/settings.json",
      ]),
    ).toBe(false);
  });

  it("reads the .md suffix off the WHOLE path, so a directory cannot fake it", () => {
    // `x.md` is a legal directory name. Testing the last segment's extension would be
    // the same thing; testing "is this path inside something called .md" would not.
    expect(isPlanOnly([".claude/x.md/evil.sh"])).toBe(false);
    expect(isPlanOnly([".claude/skills/task.md/settings.json"])).toBe(false);
    expect(isPlanOnly([".claude/x.md/notes.md"])).toBe(true);
  });

  it("takes the suffix lowercase and exact, because the lane's own gates do", () => {
    // Not fussiness. `check-no-em-dash`, `check-ports`, `check-vendor-pin` and
    // `check-lint-coverage` select their input with a case-sensitive `git ls-files`
    // pathspec of `*.md`, so `.MD` names a file those gates never open. Admitting it
    // would admit an unscanned file, which is the one thing the lane must not do.
    expect(isPlanOnly([".claude/notes.MD"])).toBe(false);
    expect(isPlanOnly([".claude/notes.Md"])).toBe(false);
    expect(isPlanOnly([".claude/notes.markdown"])).toBe(false);
    expect(FAST_LANE_MARKDOWN_SUFFIX).toBe(".md");
  });

  it("accepts the three root instruction files", () => {
    expect(isPlanOnly(["CLAUDE.md"])).toBe(true);
    expect(isPlanOnly(["PROJECT_INSTRUCTIONS.md"])).toBe(true);
    expect(isPlanOnly(["CONTRIBUTING.md"])).toBe(true);
  });

  it("accepts the diff issue #873 was filed for", () => {
    expect(isPlanOnly([".claude/agents/task-reviewer.md", "CLAUDE.md"])).toBe(true);
  });

  it("REJECTS a MIXED diff - .claude/ and CLAUDE.md plus a single source file", () => {
    // The case the lane exists to get wrong-way-safe, and the source file is what
    // makes it `false`: the instruction files dominate by count and the single `.ts`
    // is exactly what the skipped suites check. Named the way the `plan/` sibling
    // above is named, so the assertion and the title say the same thing (Copilot,
    // PR #952).
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
    expect(FAST_LANE_PREFIXES).toEqual(["plan/"]);
    expect(FAST_LANE_MARKDOWN_PREFIXES).toEqual([".claude/"]);
    expect(FAST_LANE_FILES).toEqual(["CLAUDE.md", "PROJECT_INSTRUCTIONS.md", "CONTRIBUTING.md"]);
    expect(isPlanOnly([".claude-hooks/on-stop.mjs"])).toBe(false);
    expect(isPlanOnly([".claude-notes/x.md"])).toBe(false);
    expect(isPlanOnly([".claudeignore"])).toBe(false);
  });

  it("preserves a leading space rather than accepting it as an instruction file", () => {
    // The same defect the NUL parse exists for, asserted on the widened set: a
    // committed ` CLAUDE.md` is a real path, and a reader that trimmed would wave
    // through whatever it actually is.
    expect(isPlanOnly(parsePaths(" CLAUDE.md\0"))).toBe(false);
    expect(isPlanOnly(parsePaths(" .claude/evil.md\0"))).toBe(false);
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
    expect(ADMIN_ONLY_PREFIXES).toEqual(["apps/admin/", "docs/", "plan/"]);
    expect(isAdminOnly(["apps/administration/page.tsx"])).toBe(false);
    expect(isAdminOnly(["docsite/index.html"])).toBe(false);
    expect(isAdminOnly(["apps/admin"])).toBe(false);
  });

  it("REJECTS the .claude/ files held back pending the Code Owner ruling", () => {
    // `.claude/` is not a prefix in ADMIN_ONLY_PREFIXES, and this is the reason
    // (delta review of PR #952). On the rendering question it belongs there - a hook
    // script cannot move a portal screen - but `browser-e2e` is the SLOWEST required
    // context, so it is the one that sets the merge window, and the window for these
    // files is exactly what the open decision is about. Admitting them here would
    // narrow that window from the whole browser suite to `--project admin-chromium`,
    // which is a change to the thing being ruled on.
    expect(isAdminOnly([".claude/settings.json"])).toBe(false);
    expect(isAdminOnly([".claude/settings.local.json"])).toBe(false);
    expect(isAdminOnly([".claude/hooks/on-stop.sh"])).toBe(false);
    expect(isAdminOnly(["apps/admin/app/page.tsx", ".claude/settings.json"])).toBe(false);
  });

  it("still narrows the browser suite for Markdown under .claude/", () => {
    // The other half: the narrowing an admin PR carrying agent-file edits should keep.
    expect(isAdminOnly([".claude/agents/task-reviewer.md"])).toBe(true);
    expect(isAdminOnly(["apps/admin/app/page.tsx", ".claude/agents/dev-task.md"])).toBe(true);
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
    for (const prefix of [...FAST_LANE_PREFIXES, ...FAST_LANE_MARKDOWN_PREFIXES]) {
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
  /** The `&&`-chained commands, so an assertion can name the one it means. */
  const segments = checkPlan.split("&&").map((segment) => segment.trim());

  it("runs the whole check:all gate set, not a hand-picked subset", () => {
    // Every text gate that reads the fast-lane tree is in `check:all`:
    // `check:no-em-dash`, `check:paths`, `check:ports`, `check:vendor-pin` and
    // `check:adr-citations` all scan tracked Markdown outside `plan/`, which is
    // exactly `.claude/**/*.md` and the three root files. Naming the whole set rather
    // than those five is what makes a gate added later cover the lane for free - and
    // `pnpm check:all` costs about 13 seconds against a tree with no build in it.
    expect(segments).toContain("pnpm check:all");
  });

  it("prettier-checks every path the lane admits, in the PRETTIER segment", () => {
    // `pnpm lint` (which the lane skips) is what normally runs `prettier --check .`.
    //
    // Anchored to the `prettier --check` command rather than to the whole script,
    // which is how this assertion was first written and was partly vacuous: `plan`
    // also appears in `eslint plan`, so deleting it from the Prettier arguments left
    // the test green (review of PR #952).
    const prettier = segments.find((segment) => segment.startsWith("prettier --check"));
    expect(prettier).toBeDefined();
    for (const target of [
      ...FAST_LANE_PREFIXES,
      ...FAST_LANE_MARKDOWN_PREFIXES,
      ...FAST_LANE_FILES,
    ]) {
      expect(prettier).toContain(target.replace(/\/$/, ""));
    }
  });

  it("runs the tooling test project, which is where the readers of this tree live", () => {
    // `scripts/agent-scratch.test.ts` asserts that each briefing file names the scratch
    // helper and that none of them spells the lane override as an unexported prefix;
    // `scripts/prune-worktrees.test.ts` asserts two skill files name the sweep. Both
    // are in `pnpm test`, which the lane skips, and both are broken by an ordinary
    // edit to a file the lane admits. The whole project runs rather than those two
    // files, so a test added later is covered without anyone updating a list.
    expect(segments).toContain("pnpm test:tooling:no-build");
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

/**
 * The argument the lane rests on, turned from prose into a pin (review of PR #952).
 *
 * `check:plan` covers the gates and tests that read a lane path TODAY. What makes that
 * durable is a second property, which was only ever asserted in a comment: no reader of
 * a lane path lives in `apps/` or `packages/`, the trees the lane does not run. Those
 * are the readers the lane could not see, and the reviewer's sweep at 24d2e7af found
 * none - but nothing failed when the next one was added.
 *
 * The scan is deliberately narrow so it is worth keeping green:
 *
 *   - **Quoted occurrences only, backticks included.** A needle counts when it sits
 *     inside a `'`, `"` or backtick string. Template literals are in because that is a
 *     shape this repository genuinely uses for this kind of read -
 *     `apps/api/src/openapi-document.test.ts:30` reads its contract artifact that way -
 *     and the first version of this scan was blind to them (delta review of PR #952).
 *   - **Lines that OPEN with a comment marker are skipped**, which is what keeps the
 *     backtick half from drowning in prose: this repository writes paths in running
 *     commentary with backticks, and all five extra hits the backtick added were JSDoc
 *     continuation lines. Measured over the tracked tree at the time of writing: three
 *     hits either way, the same three. The residual is a backticked lane path inside a
 *     TRAILING comment on a code line, which would be a false positive; the failure is
 *     loud and the allowlist is the fix.
 *   - **`plan/` is not a needle.** It predates #873 and its documents are cited in
 *     dozens of component comments, many of them inside JSX where no comment-marker
 *     rule holds (62 such lines when this was written). The property this pins is the
 *     one #873 introduced.
 *   - **A hit is a question, not a verdict.** The allowed entries below name
 *     `CONTRIBUTING.md` and `CLAUDE.md` as APP-RELATIVE strip rules - what a scaffolded
 *     project must not ship - and never read the repository root's copy. They are
 *     scoped to the exact line text, so a later root read in the same file is still a
 *     failure rather than something hiding behind an existing reason.
 */
describe("no reader of a lane path lives where the lane cannot see it", () => {
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const COMMENT_OPENER = /^(?:\/\/|\/\*|\*|\{\/\*)/;

  /**
   * The pattern the scan uses, built once so the self-test below exercises the real one.
   *
   * @param needles paths whose quoted appearance is the thing being looked for.
   */
  const laneLiteralPattern = (needles: readonly string[]): RegExp =>
    new RegExp(
      needles
        .map(
          (needle) =>
            `["'\`][^"'\`]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"'\`]*["'\`]`,
        )
        .join("|"),
    );

  /** One line that may name a lane path, and why it is not a read of our own copy. */
  const ALLOWED = [
    {
      file: "packages/create-qcms-app/scripts/sync-templates.mjs",
      line: '"CONTRIBUTING.md",',
      why: "APP_EXCLUDED_PATHS: an app-relative name the scaffold drops, never read from the root",
    },
    {
      file: "packages/create-qcms-app/scripts/sync-templates.test.ts",
      line: '"CONTRIBUTING.md",',
      why: "asserts the same app-relative strip rule",
    },
    {
      file: "packages/create-qcms-app/scripts/sync-templates.test.ts",
      line: '"CLAUDE.md",',
      why: "asserts the same app-relative strip rule",
    },
  ];

  const scan = (): { found: string[]; matched: Set<string> } => {
    const pattern = laneLiteralPattern([...FAST_LANE_FILES, ...FAST_LANE_MARKDOWN_PREFIXES]);
    const tracked = execFileSync("git", ["ls-files", "-z", "apps", "packages", "tooling"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((file) => file !== "" && SOURCE.test(file));

    const found: string[] = [];
    const matched = new Set<string>();
    for (const file of tracked) {
      const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
      text.split("\n").forEach((raw, index) => {
        const line = raw.trim();
        if (COMMENT_OPENER.test(line)) return;
        if (!pattern.test(line)) return;
        const allowed = ALLOWED.find((entry) => entry.file === file && entry.line === line);
        if (allowed !== undefined) {
          matched.add(`${allowed.file} ${allowed.line}`);
          return;
        }
        found.push(`${file}:${String(index + 1)}  ${line}`);
      });
    }
    return { found, matched };
  };

  it("finds no unlisted lane literal under apps/ or packages/", () => {
    const { found } = scan();

    // The message is the point of the test: whoever trips it has to answer one
    // question, and the answer decides between three fixes.
    expect(
      found,
      [
        "A file the fast lane does not run names a fast-lane path in a string literal.",
        "Ask whether it READS the repository's own copy at that path:",
        "  - it does      -> it must run on the lane, or the path must leave the lane",
        "                    (scripts/ci-plan-only.mjs, CONTRIBUTING 'The instruction and plan fast lane')",
        "  - it does not  -> add it to ALLOWED here with its exact line text and the reason",
        "Hits:",
        ...found,
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps no stale allowlist entry, so each one still stands for something", () => {
    // An entry whose line has moved or gone is an exemption nobody is watching, and it
    // would silently cover the next line that happens to match it.
    const { matched } = scan();
    for (const entry of ALLOWED) {
      expect(
        matched,
        `${entry.file} no longer has the line '${entry.line}' (${entry.why})`,
      ).toContain(`${entry.file} ${entry.line}`);
    }
  });

  it("would notice a reader added under apps/, quoted or in a template literal", () => {
    // The scan is only worth having if it can fail, and this exercises the SAME builder
    // the scan uses rather than a copy of the pattern (delta review of PR #952).
    // Synthetic lines rather than a write into the tree, so nothing has to be cleaned up.
    const pattern = laneLiteralPattern(["CLAUDE.md", ".claude/"]);
    expect(pattern.test('const brief = readFileSync("../../CLAUDE.md", "utf8");')).toBe(true);
    expect(pattern.test("const brief = readFileSync(`../../CLAUDE.md`, 'utf8');")).toBe(true);
    expect(pattern.test("const p = new URL(`${root}/.claude/agents/x.md`, base);")).toBe(true);
    expect(pattern.test("const brief = readFileSync(join(root, 'CLAUDE.md'));")).toBe(true);
    // And the shapes it must NOT flag: prose, wherever the comment marker opens the line.
    expect(COMMENT_OPENER.test("// the trap `CLAUDE.md` describes")).toBe(true);
    expect(
      COMMENT_OPENER.test("* documented in `apps/api/CONTRIBUTING.md`, not a dependency"),
    ).toBe(true);
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
