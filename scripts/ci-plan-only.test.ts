import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_ONLY_PREFIXES,
  DOCS_OFF_LANE,
  DOCS_PREFIX,
  FAST_LANE_FILES,
  FAST_LANE_PREFIXES,
  MARKDOWN_SUFFIX,
  PLAN_PREFIX,
  changedFiles,
  isAdminOnly,
  isDocsMarkdown,
  isFastLanePath,
  isPlanOnly,
  parsePaths,
} from "./ci-plan-only.mjs";

/**
 * The asymmetry these cases are built around: a false negative costs runner time, while
 * a false positive silences every suite on a change that could break it and still
 * reports each required context green.
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
    expect(isPlanOnly(["plan/ci-notes.md", ".github/workflows/ci.yml"])).toBe(false);
  });

  it("rejects an EMPTY diff", () => {
    expect(isPlanOnly([])).toBe(false);
    expect(isPlanOnly([""])).toBe(false);
  });

  it("does not treat a root path that merely STARTS WITH the word plan as plan/", () => {
    expect(isPlanOnly(["planning.md"])).toBe(false);
    expect(isPlanOnly(["plans/roadmap.md"])).toBe(false);
    expect(isPlanOnly(["packages/core/src/planner.ts"])).toBe(false);
  });

  it("does not treat a plan/ directory nested under another root as plan/", () => {
    // A nested `plan/` is in scope for the text gates that exempt the repo-root one.
    expect(isPlanOnly(["apps/admin/plan/notes.md"])).toBe(false);
    expect(isPlanOnly(["packages/core/plan/notes.md"])).toBe(false);
  });

  it("still classifies plan/admin-theme as plan-only, which is why check:plan exists", () => {
    // This path is the source `check:admin-theme` gates the admin's own theme against,
    // so the lane has to keep running that gate.
    expect(isPlanOnly(["plan/admin-theme/tokens.css"])).toBe(true);
  });

  it("keeps the prefix anchored with a trailing separator", () => {
    expect(PLAN_PREFIX).toBe("plan/");
  });
});

describe("plan-only classification: the instruction tree", () => {
  it("accepts an agent or skill definition under .claude/", () => {
    expect(isPlanOnly([".claude/agents/task-reviewer.md", ".claude/skills/task/SKILL.md"])).toBe(
      true,
    );
  });

  it("accepts the settings file and a hook script, per the 2026-09-19 ruling", () => {
    expect(isPlanOnly([".claude/settings.json"])).toBe(true);
    expect(isPlanOnly([".claude/settings.local.json"])).toBe(true);
    expect(isPlanOnly([".claude/hooks/on-stop.sh"])).toBe(true);
    expect(isPlanOnly([".claude/hooks/x.py"])).toBe(true);
    expect(isPlanOnly([".claude/hooks/probe.mjs"])).toBe(true);
    expect(isPlanOnly([".claude/agents/task-executor"])).toBe(true);
  });

  it("accepts a diff mixing agent definitions with the settings file", () => {
    expect(
      isPlanOnly([
        ".claude/agents/task-executor.md",
        ".claude/skills/next-issue/SKILL.md",
        ".claude/settings.json",
      ]),
    ).toBe(true);
  });

  it("does not classify on an extension, in either direction", () => {
    expect(isPlanOnly([".claude/x.md/evil.sh"])).toBe(true);
    expect(isPlanOnly([".claude/skills/task.md/settings.json"])).toBe(true);
    expect(isPlanOnly([".claude/notes.MD"])).toBe(true);
    expect(isPlanOnly([".claude/notes.markdown"])).toBe(true);
    expect(isPlanOnly([".claude/hooks/on-stop.md"])).toBe(true);
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
    expect(
      isPlanOnly([
        ".claude/agents/task-executor.md",
        ".claude/skills/next-issue/SKILL.md",
        "CLAUDE.md",
        "packages/core/src/rules.ts",
      ]),
    ).toBe(false);
  });

  it("matches the root instruction files by EQUALITY, not as a prefix", () => {
    expect(isPlanOnly(["CLAUDE.md.bak"])).toBe(false);
    expect(isPlanOnly(["CONTRIBUTING.mdx"])).toBe(false);
    expect(isPlanOnly(["apps/api/CONTRIBUTING.md"])).toBe(false);
    expect(isPlanOnly(["apps/admin/CLAUDE.md"])).toBe(false);
  });

  it("keeps the .claude prefix anchored with its separator", () => {
    expect(FAST_LANE_PREFIXES).toEqual(["plan/", ".claude/"]);
    expect(FAST_LANE_FILES).toEqual(["CLAUDE.md", "PROJECT_INSTRUCTIONS.md", "CONTRIBUTING.md"]);
    expect(isPlanOnly([".claude-hooks/on-stop.mjs"])).toBe(false);
    expect(isPlanOnly([".claude-notes/x.md"])).toBe(false);
    expect(isPlanOnly([".claude-evil/x.ts"])).toBe(false);
    expect(isPlanOnly([".claudeignore"])).toBe(false);
    expect(isPlanOnly([".claudeX"])).toBe(false);
    expect(isPlanOnly([".claude"])).toBe(false);
    expect(isPlanOnly(["apps/api/.claude/x.ts"])).toBe(false);
  });

  it("preserves a leading space rather than accepting it as a lane path", () => {
    expect(isPlanOnly(parsePaths(" CLAUDE.md\0"))).toBe(false);
    expect(isPlanOnly(parsePaths(" .claude/evil.md\0"))).toBe(false);
  });

  it("still rejects a diff that also touches the workflow or the classifier", () => {
    expect(isPlanOnly(["CLAUDE.md", ".github/workflows/ci.yml"])).toBe(false);
    expect(isPlanOnly([".claude/agents/dev-task.md", "scripts/ci-plan-only.mjs"])).toBe(false);
  });
});

describe("plan-only classification: Markdown under docs/", () => {
  it("accepts docs Markdown, at the root of the tree and nested", () => {
    expect(isPlanOnly(["docs/PORTS.md"])).toBe(true);
    expect(isPlanOnly(["docs/features/README.md"])).toBe(true);
    expect(isPlanOnly(["docs/adr/README.md", "docs/deploy/fly.md"])).toBe(true);
    expect(isPlanOnly(["docs/ownership-seam.md"])).toBe(true);
  });

  it("accepts the diff shape issue #1139 was filed for", () => {
    expect(isPlanOnly(["docs/RETRO.md", "docs/features/README.md", "CLAUDE.md"])).toBe(true);
  });

  it("REJECTS a MIXED diff - docs Markdown plus a single app file", () => {
    expect(
      isPlanOnly([
        "docs/features/README.md",
        "docs/DEVELOPER_GUIDE.md",
        "docs/RETRO.md",
        "apps/admin/app/(shell)/page.tsx",
      ]),
    ).toBe(false);
    expect(isPlanOnly(["docs/PORTS.md", "packages/core/src/rules.ts"])).toBe(false);
    expect(isPlanOnly(["docs/PORTS.md", "scripts/ports.mjs"])).toBe(false);
  });

  it("refuses anything non-Markdown under docs/, so the artifacts keep the full run", () => {
    expect(isPlanOnly(["docs/openapi/admin.json"])).toBe(false);
    expect(isPlanOnly(["docs/openapi/respondent.json"])).toBe(false);
    expect(isPlanOnly(["docs/diagram.svg"])).toBe(false);
    expect(isPlanOnly(["docs/sample.csv"])).toBe(false);
    expect(isPlanOnly(["docs/features/README.md", "docs/openapi/admin.json"])).toBe(false);
  });

  it("refuses the shapes the separator and the exact extension exist to refuse", () => {
    expect(isPlanOnly(["docs.md"])).toBe(false);
    expect(isPlanOnly(["docs"])).toBe(false);
    expect(isPlanOnly(["docs-x/a.md"])).toBe(false);
    expect(isPlanOnly(["docsite/a.md"])).toBe(false);
    expect(isPlanOnly(["docs/a.mdx"])).toBe(false);
    expect(isPlanOnly(["docs/a.MD"])).toBe(false);
    expect(isPlanOnly(["docs/a.markdown"])).toBe(false);
    expect(isPlanOnly(["docs/a.md/evil.sh"])).toBe(false);
    expect(isPlanOnly(["apps/admin/docs/a.md"])).toBe(false);
  });

  it("preserves a leading space rather than accepting it as a docs path", () => {
    expect(isPlanOnly(parsePaths(" docs/PORTS.md\0"))).toBe(false);
  });

  it("keeps the prefix and the extension anchored", () => {
    expect(DOCS_PREFIX).toBe("docs/");
    expect(MARKDOWN_SUFFIX).toBe(".md");
  });

  it("holds back the one docs document a full-lane context reads", () => {
    expect(DOCS_OFF_LANE).toEqual(["docs/SECURITY_DESIGN.md"]);
    expect(isPlanOnly(["docs/SECURITY_DESIGN.md"])).toBe(false);
    expect(isPlanOnly(["docs/features/README.md", "docs/SECURITY_DESIGN.md"])).toBe(false);
    // An entry the rule would not otherwise admit is dead prose, not an exclusion.
    for (const held of DOCS_OFF_LANE) {
      expect(held.startsWith(DOCS_PREFIX)).toBe(true);
      expect(held.endsWith(MARKDOWN_SUFFIX)).toBe(true);
    }
  });

  it("is the same question isFastLanePath answers, for a docs path", () => {
    // Separate exports, and the second is what both classifications call, so a rule added
    // to one and not the other is a real failure mode.
    expect(isDocsMarkdown("docs/PORTS.md")).toBe(true);
    expect(isFastLanePath("docs/PORTS.md")).toBe(true);
    expect(isDocsMarkdown("docs/SECURITY_DESIGN.md")).toBe(false);
    expect(isFastLanePath("docs/SECURITY_DESIGN.md")).toBe(false);
    expect(isDocsMarkdown("plan/notes.md")).toBe(false);
    expect(isFastLanePath("plan/notes.md")).toBe(true);
  });
});

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
    expect(isAdminOnly([])).toBe(false);
    expect(isAdminOnly([""])).toBe(false);
  });

  it("keeps every prefix anchored with a trailing separator", () => {
    expect(ADMIN_ONLY_PREFIXES).toEqual(["apps/admin/", "docs/", "plan/", ".claude/"]);
    expect(isAdminOnly(["apps/administration/page.tsx"])).toBe(false);
    expect(isAdminOnly(["docsite/index.html"])).toBe(false);
    expect(isAdminOnly(["apps/admin"])).toBe(false);
  });

  it("narrows the browser suite for the whole of .claude/, as the fast lane admits it", () => {
    expect(isAdminOnly([".claude/settings.json"])).toBe(true);
    expect(isAdminOnly([".claude/hooks/on-stop.sh"])).toBe(true);
    expect(isAdminOnly([".claude/agents/task-reviewer.md"])).toBe(true);
    expect(isAdminOnly(["apps/admin/app/page.tsx", ".claude/settings.json"])).toBe(true);
    expect(isAdminOnly(["apps/admin/app/page.tsx", ".claude/agents/dev-task.md"])).toBe(true);
  });

  it("preserves a leading space rather than accepting it as an admin path", () => {
    expect(isAdminOnly(parsePaths(" apps/admin/evil.ts\0"))).toBe(false);
  });

  it("classifies a plan-only diff as admin-only too, which changes nothing", () => {
    // The overlap is deliberate: `plan_only` is checked first in every job, so the
    // narrower lane never reaches these.
    expect(isPlanOnly(["plan/notes.md"])).toBe(true);
    expect(isAdminOnly(["plan/notes.md"])).toBe(true);
  });

  it("holds the containment invariant: every fast-lane path is admin-only too", () => {
    for (const prefix of FAST_LANE_PREFIXES) {
      expect(isAdminOnly([`${prefix}some/file.md`])).toBe(true);
      expect(isAdminOnly([`${prefix}some/file.sh`])).toBe(true);
    }
    for (const file of FAST_LANE_FILES) {
      expect(isAdminOnly([file])).toBe(true);
    }
    expect(isAdminOnly(["docs/features/README.md"])).toBe(true);
    expect(isAdminOnly(["docs/SECURITY_DESIGN.md"])).toBe(true);
    expect(isAdminOnly(["docs/openapi/admin.json"])).toBe(true);
    expect(
      isAdminOnly(["apps/admin/app/page.tsx", "CLAUDE.md", ".claude/skills/task/SKILL.md"]),
    ).toBe(true);
  });
});

/**
 * What makes skipping those suites safe is `check:plan` running every gate that reads a
 * lane path, and nothing but this block ties the two halves together. Read from
 * `package.json` rather than restated, so a lane that lost a gate cannot pass.
 */
describe("check:plan covers what the lane skips", () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { scripts: Record<string, string> };
  const checkPlan = manifest.scripts["check:plan"] ?? "";
  const segments = checkPlan.split("&&").map((segment) => segment.trim());

  it("runs the whole check:all gate set, not a hand-picked subset", () => {
    // Naming the whole set rather than the gates that read the tree today is what makes
    // a gate added later cover the lane for free.
    expect(segments).toContain("pnpm check:all");
  });

  it("prettier-checks every path the lane admits, in the PRETTIER segment", () => {
    // Anchored to the `prettier --check` segment, not the whole script: `plan` also
    // appears in `eslint plan`, which made a looser version of this partly vacuous.
    const prettier = segments.find((segment) => segment.startsWith("prettier --check"));
    expect(prettier).toBeDefined();
    for (const target of [...FAST_LANE_PREFIXES, DOCS_PREFIX, ...FAST_LANE_FILES]) {
      expect(prettier).toContain(target.replace(/\/$/, ""));
    }
  });

  it("runs the tooling test project, which is where the readers of this tree live", () => {
    expect(segments).toContain("pnpm test:tooling:no-build");
  });

  it("excludes exactly the tooling files that need a build, and says which", () => {
    // A new build dependency should fail here loudly rather than join this list quietly.
    const noBuild = manifest.scripts["test:tooling:no-build"] ?? "";
    expect(noBuild).toContain("--project tooling");
    expect(noBuild).toContain("sql-capture.test.ts");
    expect(noBuild).toContain("check-bff-config-guards.test.ts");
    expect(noBuild.match(/--exclude/g) ?? []).toHaveLength(3);
    expect(noBuild).toContain("node_modules");
  });
});

/**
 * Pins that no reader of a lane path lives in `apps/` or `packages/`. The scan is deliberately narrow:
 * it counts a needle only inside a quoted string and skips lines opening with a comment marker. Each
 * allowlist entry is scoped to an exact line, so a later read in the same file still fails.
 */
describe("no reader of a lane path lives where the lane cannot see it", () => {
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const COMMENT_OPENER = /^(?:\/\/|\/\*|\*|\{\/\*)/;

  const laneLiteralPattern = (needles: readonly string[]): RegExp =>
    new RegExp(
      needles
        .map(
          (needle) =>
            `["'\`][^"'\`]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"'\`]*["'\`]`,
        )
        .join("|"),
    );

  const NEEDLES = [
    ...FAST_LANE_FILES,
    ...FAST_LANE_PREFIXES.filter((prefix) => prefix !== PLAN_PREFIX),
  ];

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
    const pattern = laneLiteralPattern(NEEDLES);
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
    // An entry whose line has moved is an exemption nobody is watching, and it would
    // silently cover the next line that happens to match it.
    const { matched } = scan();
    for (const entry of ALLOWED) {
      expect(
        matched,
        `${entry.file} no longer has the line '${entry.line}' (${entry.why})`,
      ).toContain(`${entry.file} ${entry.line}`);
    }
  });

  it("would notice a reader added under apps/, quoted or in a template literal", () => {
    // Exercises the same builder the scan uses, so a copy of the pattern cannot make the
    // scan vacuous without this failing.
    const pattern = laneLiteralPattern(["CLAUDE.md", ".claude/"]);
    expect(pattern.test('const brief = readFileSync("../../CLAUDE.md", "utf8");')).toBe(true);
    expect(pattern.test("const brief = readFileSync(`../../CLAUDE.md`, 'utf8');")).toBe(true);
    expect(pattern.test("const p = new URL(`${root}/.claude/agents/x.md`, base);")).toBe(true);
    expect(pattern.test("const brief = readFileSync(join(root, 'CLAUDE.md'));")).toBe(true);
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
    expect(parsePaths(" plan/evil.ts\0")).toEqual([" plan/evil.ts"]);
    expect(isPlanOnly(parsePaths(" plan/evil.ts\0"))).toBe(false);
  });

  it("preserves a newline inside a path", () => {
    expect(parsePaths("plan/a\nb.md\0")).toEqual(["plan/a\nb.md"]);
  });
});

/**
 * Against a real repository on purpose: the classification was always correct on a
 * leading-space path, and the defect was in the layer that never handed it one.
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
    // Stands in for the remote-tracking ref the workflow's checkout provides.
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
