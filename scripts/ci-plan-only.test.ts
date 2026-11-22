import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_ONLY_PREFIXES,
  API_E2E_SUPPORT_PREFIX,
  DOCS_OFF_LANE,
  DOCS_OFF_LANE_PREFIXES,
  DOCS_PREFIX,
  FAST_LANE_FILES,
  FAST_LANE_PREFIXES,
  GITHUB_OFF_LANE_PREFIXES,
  GITHUB_PREFIX,
  HARNESS_SCRIPTS,
  PLAN_PREFIX,
  changedFiles,
  diffBase,
  isAdminOnly,
  isApiNeeded,
  isDocsLanePath,
  isFastLanePath,
  isGithubLanePath,
  isPlanOnly,
  isUiNeeded,
  mirrorSources,
  parsePaths,
} from "./ci-plan-only.mjs";

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
    expect(FAST_LANE_PREFIXES).toEqual(["plan/", ".claude/", "apps/site/", ".changeset/"]);
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

describe("plan-only classification: the static site", () => {
  it("accepts a diff confined to apps/site", () => {
    expect(isPlanOnly(["apps/site/src/content/docs/start/introduction.mdx"])).toBe(true);
    expect(isPlanOnly(["apps/site/astro.config.mjs", "apps/site/src/styles/custom.css"])).toBe(
      true,
    );
    expect(isPlanOnly(["apps/site/package.json", "docs/adr/core.md"])).toBe(true);
  });

  it("rejects a site diff that also moves the lockfile, which reaches every package", () => {
    expect(isPlanOnly(["apps/site/package.json", "pnpm-lock.yaml"])).toBe(false);
  });

  it("rejects a site diff that also touches a package the apps build on", () => {
    expect(isPlanOnly(["apps/site/src/styles/custom.css", "packages/ui/src/theme.css"])).toBe(
      false,
    );
  });

  it("keeps the prefix anchored to the directory", () => {
    expect(isPlanOnly(["apps/site"])).toBe(false);
    expect(isPlanOnly(["apps/sitemap/index.ts"])).toBe(false);
    expect(isPlanOnly(parsePaths(" apps/site/evil.ts\0"))).toBe(false);
  });

  it("is admin-only too, so the browser suite narrows rather than widening", () => {
    expect(isAdminOnly(["apps/site/src/content/docs/start/introduction.mdx"])).toBe(true);
    expect(isAdminOnly(["apps/site/package.json", "apps/admin/app/page.tsx"])).toBe(true);
  });
});

describe("plan-only classification: the docs/ tree", () => {
  it("accepts docs Markdown, at the root of the tree and nested", () => {
    expect(isPlanOnly(["docs/PORTS.md"])).toBe(true);
    expect(isPlanOnly(["docs/features/README.md"])).toBe(true);
    expect(isPlanOnly(["docs/adr/README.md", "docs/deploy/fly.md"])).toBe(true);
    expect(isPlanOnly(["docs/ownership-seam.md"])).toBe(true);
  });

  it("accepts the diff shape issue #1139 was filed for", () => {
    expect(isPlanOnly(["docs/RETRO.md", "docs/features/README.md", "CLAUDE.md"])).toBe(true);
  });

  it("accepts non-Markdown docs, which only check:plan's own gates read", () => {
    expect(isPlanOnly(["docs/use-cases/manifest.json"])).toBe(true);
    expect(isPlanOnly(["docs/workspace-access-guide.html"])).toBe(true);
    expect(isPlanOnly(["docs/diagram.svg", "docs/a.mdx"])).toBe(true);
  });

  it("REJECTS a MIXED diff - docs plus a single app file", () => {
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

  it("refuses the OpenAPI contract, which a build regenerates and compares", () => {
    expect(DOCS_OFF_LANE_PREFIXES).toEqual(["docs/openapi/"]);
    expect(isPlanOnly(["docs/openapi/admin.json"])).toBe(false);
    expect(isPlanOnly(["docs/openapi/respondent.json"])).toBe(false);
    expect(isPlanOnly(["docs/features/README.md", "docs/openapi/admin.json"])).toBe(false);
  });

  it("refuses the shapes the separator exists to refuse", () => {
    expect(isPlanOnly(["docs.md"])).toBe(false);
    expect(isPlanOnly(["docs"])).toBe(false);
    expect(isPlanOnly(["docs-x/a.md"])).toBe(false);
    expect(isPlanOnly(["docsite/a.md"])).toBe(false);
    expect(isPlanOnly(["apps/admin/docs/a.md"])).toBe(false);
    expect(isPlanOnly(["docs/openapi-x/a.json"])).toBe(true);
  });

  it("preserves a leading space rather than accepting it as a docs path", () => {
    expect(isPlanOnly(parsePaths(" docs/PORTS.md\0"))).toBe(false);
  });

  it("keeps the prefix anchored", () => {
    expect(DOCS_PREFIX).toBe("docs/");
  });

  it("holds back the one docs document a full-lane context reads", () => {
    expect(DOCS_OFF_LANE).toEqual(["docs/SECURITY_DESIGN.md"]);
    expect(isPlanOnly(["docs/SECURITY_DESIGN.md"])).toBe(false);
    expect(isPlanOnly(["docs/features/README.md", "docs/SECURITY_DESIGN.md"])).toBe(false);
    for (const held of DOCS_OFF_LANE) {
      expect(held.startsWith(DOCS_PREFIX)).toBe(true);
    }
  });

  it("is the same question isFastLanePath answers, for a docs path", () => {
    expect(isDocsLanePath("docs/PORTS.md")).toBe(true);
    expect(isFastLanePath("docs/PORTS.md")).toBe(true);
    expect(isDocsLanePath("docs/SECURITY_DESIGN.md")).toBe(false);
    expect(isFastLanePath("docs/SECURITY_DESIGN.md")).toBe(false);
    expect(isDocsLanePath("plan/notes.md")).toBe(false);
    expect(isFastLanePath("plan/notes.md")).toBe(true);
  });
});

describe("plan-only classification: changesets and repository metadata", () => {
  it("accepts a changeset-only diff", () => {
    expect(isPlanOnly([".changeset/admin-claim-page.md"])).toBe(true);
    expect(isPlanOnly([".changeset/config.json", ".changeset/README.md"])).toBe(true);
    expect(isPlanOnly([".changesets/x.md", ".changeset"])).toBe(false);
  });

  it("accepts dependabot and other non-workflow .github files", () => {
    expect(isPlanOnly([".github/dependabot.yml"])).toBe(true);
    expect(isPlanOnly([".github/codeql/codeql-config.yml"])).toBe(true);
    expect(isGithubLanePath(".github/ISSUE_TEMPLATE/bug.md")).toBe(true);
  });

  it("keeps workflows and the composite actions they run on the full suite", () => {
    expect(GITHUB_PREFIX).toBe(".github/");
    expect(GITHUB_OFF_LANE_PREFIXES).toEqual([".github/workflows/", ".github/actions/"]);
    expect(isPlanOnly([".github/workflows/ci.yml"])).toBe(false);
    expect(isPlanOnly([".github/actions/test-postgres-image/action.yml"])).toBe(false);
    expect(isPlanOnly([".github/dependabot.yml", ".github/workflows/e2e.yml"])).toBe(false);
    expect(isPlanOnly([".githubx/dependabot.yml", ".github"])).toBe(false);
    expect(isPlanOnly(parsePaths(" .github/dependabot.yml\0"))).toBe(false);
  });

  it("runs the changeset gates on the lane, through check:all inside check:plan", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { scripts: Record<string, string> };
    const checkAll = (manifest.scripts["check:all"] ?? "").split("&&").map((x) => x.trim());
    expect(checkAll).toContain("pnpm check:changeset");
    expect(checkAll).toContain("pnpm check:changeset-status");
    expect(manifest.scripts["check:plan"]).toMatch(/^pnpm check:all &&/);
  });
});

describe("the create-qcms-app template mirror", () => {
  it("maps a templates/common path only when its source is in the same diff", () => {
    const mirror = "packages/create-qcms-app/templates/common/apps/admin/app/page.tsx";
    expect(mirrorSources(["apps/admin/app/page.tsx", mirror])).toEqual([
      "apps/admin/app/page.tsx",
      "apps/admin/app/page.tsx",
    ]);
    expect(mirrorSources([mirror])).toEqual([mirror]);
    const solo = "packages/create-qcms-app/templates/solo/docker/Caddyfile";
    expect(mirrorSources(["docker/Caddyfile", solo])).toEqual(["docker/Caddyfile", solo]);
  });

  it("never puts a template-only path on the fast lane", () => {
    const templateDoc = "packages/create-qcms-app/templates/common/docs/x.md";
    expect(isPlanOnly([templateDoc])).toBe(false);
    expect(isPlanOnly(["docs/PORTS.md", templateDoc])).toBe(false);
    expect(isPlanOnly(["packages/create-qcms-app/templates/common/CLAUDE.md"])).toBe(false);
    expect(isAdminOnly([templateDoc])).toBe(false);
    expect(isUiNeeded([templateDoc])).toBe(true);
    expect(isApiNeeded([templateDoc])).toBe(true);
    expect(isAdminOnly(["packages/create-qcms-app/templates/common/apps/admin/app/page.tsx"])).toBe(
      false,
    );
  });

  it("keeps an admin change and its mirror on the admin lane", () => {
    expect(
      isAdminOnly([
        "apps/admin/app/page.tsx",
        "packages/create-qcms-app/templates/common/apps/admin/app/page.tsx",
        ".changeset/admin-page.md",
      ]),
    ).toBe(true);
  });

  it("still widens to the full suite when the mirror carries a shared package", () => {
    expect(
      isAdminOnly(["packages/create-qcms-app/templates/common/packages/ui/src/theme.css"]),
    ).toBe(false);
    expect(isAdminOnly(["packages/create-qcms-app/src/scaffold.ts"])).toBe(false);
  });

  it("classifies a mirrored prose path as prose", () => {
    expect(
      isPlanOnly(["docs/PORTS.md", "packages/create-qcms-app/templates/common/docs/PORTS.md"]),
    ).toBe(true);
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
    expect(ADMIN_ONLY_PREFIXES).toEqual([
      "apps/admin/",
      "docs/",
      "plan/",
      ".claude/",
      "apps/site/",
      ".changeset/",
    ]);
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
    expect(segments).toContain("pnpm check:all");
  });

  it("prettier-checks every path the lane admits, in the PRETTIER segment", () => {
    // Anchor to Prettier's segment; a plan target in ESLint does not prove Prettier coverage.
    const prettier = segments.find((segment) => segment.startsWith("prettier --check"));
    expect(prettier).toBeDefined();
    for (const target of [...FAST_LANE_PREFIXES, DOCS_PREFIX, GITHUB_PREFIX, ...FAST_LANE_FILES]) {
      expect(prettier).toContain(target.replace(/\/$/, ""));
    }
  });

  it("runs the tooling test project, which is where the readers of this tree live", () => {
    expect(segments).toContain("pnpm test:tooling:no-build");
  });

  it("excludes exactly the tooling files that need a build, and says which", () => {
    const noBuild = manifest.scripts["test:tooling:no-build"] ?? "";
    expect(noBuild).toContain("--project tooling");
    expect(noBuild).toContain("sql-capture.test.ts");
    expect(noBuild).toContain("check-bff-config-guards.test.ts");
    expect(noBuild).toContain("builder-facts-schema.test.ts");
    expect(noBuild.match(/--exclude/g) ?? []).toHaveLength(4);
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
    GITHUB_PREFIX,
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
    {
      file: "apps/site/astro.config.mjs",
      line: 'editLink: { baseUrl: "https://github.com/roonga/qcms/edit/main/apps/site/" },',
      why: "builds a github.com edit URL; reads nothing from that path",
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
 * Use a real repository to verify git's NUL-separated output preserves leading spaces in paths.
 */
describe("ui_needed: whether the browser suite can observe the diff", () => {
  it("skips the suite for a diff of lane paths, changesets, docker, loose scripts and unit tests", () => {
    expect(isUiNeeded([".changeset/x.md", "docs/PORTS.md"])).toBe(false);
    expect(isUiNeeded(["docker/api.Dockerfile", "docker/Caddyfile"])).toBe(false);
    expect(
      isUiNeeded(["packages/create-qcms-app/templates/common/docker/api.Dockerfile.tmpl"]),
    ).toBe(false);
    expect(isUiNeeded(["packages/create-qcms-app/templates/solo/docker/Caddyfile"])).toBe(false);
    expect(isUiNeeded(["scripts/check-comments.mjs", "scripts/check-comments.test.ts"])).toBe(
      false,
    );
    expect(isUiNeeded(["packages/core/src/rules.test.ts", "apps/admin/lib/x.test.tsx"])).toBe(
      false,
    );
    expect(isUiNeeded(["apps/api/e2e/security/matrix-coverage.e2e.ts"])).toBe(false);
  });

  it("runs the suite for anything the harness imports or the apps render", () => {
    expect(isUiNeeded(["apps/portal/app/page.tsx"])).toBe(true);
    expect(isUiNeeded(["apps/admin/app/page.tsx"])).toBe(true);
    expect(isUiNeeded(["apps/api/src/routes/forms.ts"])).toBe(true);
    expect(isUiNeeded(["packages/ui/src/theme.css"])).toBe(true);
    expect(isUiNeeded([`${API_E2E_SUPPORT_PREFIX}index.ts`])).toBe(true);
    expect(isUiNeeded(["apps/portal/e2e/support/port-seat.test.ts"])).toBe(true);
    expect(isUiNeeded(["scripts/ports.mjs"])).toBe(true);
    expect(isUiNeeded(["scripts/next-build.mjs", "docs/PORTS.md"])).toBe(true);
    expect(isUiNeeded(["playwright.config.ts"])).toBe(true);
    expect(isUiNeeded(["pnpm-lock.yaml"])).toBe(true);
    expect(isUiNeeded([".github/workflows/ci.yml"])).toBe(true);
  });

  it("runs the suite for an empty or unreadable diff", () => {
    expect(isUiNeeded([])).toBe(true);
    expect(isUiNeeded([""])).toBe(true);
    expect(isUiNeeded(parsePaths(" scripts/check-comments.mjs\0"))).toBe(true);
  });

  it("runs the suite for a template mirror of a rendered app", () => {
    expect(isUiNeeded(["packages/create-qcms-app/templates/common/apps/portal/app/page.tsx"])).toBe(
      true,
    );
  });
});

describe("api_needed: whether the API suite can observe the diff", () => {
  it("skips the suite for frontend-only, docker, loose-script and lane diffs", () => {
    expect(isApiNeeded(["apps/admin/app/page.tsx", "apps/portal/app/page.tsx"])).toBe(false);
    expect(isApiNeeded(["packages/ui/src/theme.css", ".changeset/ui.md"])).toBe(false);
    expect(isApiNeeded(["docker/portal.Dockerfile", "scripts/check-comments.mjs"])).toBe(false);
    expect(isApiNeeded(["packages/a2ui-compiler/src/x.test.ts"])).toBe(false);
  });

  it("runs the suite for the API, its packages, dependencies and the security matrix", () => {
    expect(isApiNeeded(["apps/api/src/routes/forms.ts"])).toBe(true);
    expect(isApiNeeded(["apps/api/src/routes/forms.test.ts"])).toBe(true);
    expect(isApiNeeded(["apps/api/e2e/security/matrix-coverage.e2e.ts"])).toBe(true);
    expect(isApiNeeded(["packages/db/src/schema.ts"])).toBe(true);
    expect(isApiNeeded(["packages/core/src/rules.ts"])).toBe(true);
    expect(isApiNeeded(["packages/observability/src/logger.ts"])).toBe(true);
    expect(isApiNeeded(["docs/SECURITY_DESIGN.md"])).toBe(true);
    expect(isApiNeeded(["pnpm-lock.yaml"])).toBe(true);
    expect(isApiNeeded(["apps/admin/package.json"])).toBe(true);
    expect(isApiNeeded(["package.json"])).toBe(true);
    expect(isApiNeeded([".nvmrc"])).toBe(true);
  });

  it("treats a path it does not know as needed", () => {
    expect(isApiNeeded(["packages/a2ui-compiler/src/mapping.ts"])).toBe(true);
    expect(isApiNeeded(["packages/csv/src/index.ts"])).toBe(true);
    expect(isApiNeeded(["scripts/env-reference.mjs"])).toBe(true);
    expect(isApiNeeded(["vitest.config.ts"])).toBe(true);
    expect(isApiNeeded([])).toBe(true);
  });
});

/**
 * Recomputes the relative-import closure of the browser and API harnesses and the workspace
 * builds, so a new script import or a support file outside the held-back tree fails here
 * rather than letting a suite skip a change it runs.
 */
describe("the end-to-end suites import nothing the classifier calls unneeded", () => {
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const IMPORT = /(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;
  const BUILD_SCRIPTS = /node (?:\.\.\/\.\.\/)?(scripts\/[\w.-]+\.mjs)/g;

  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((file) => file !== ""),
  );

  const resolve = (from: string, spec: string): string | undefined => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    return [
      base,
      base.replace(/\.js$/, ".ts"),
      base.replace(/\.js$/, ".tsx"),
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}/index.ts`,
    ].find((candidate) => tracked.has(candidate));
  };

  const closure = (entries: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!SOURCE.test(file)) continue;
      const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const match of text.matchAll(IMPORT)) {
        const target = resolve(file, match[1]!);
        if (target !== undefined) queue.push(target);
      }
    }
    return seen;
  };

  const sources = (pattern: RegExp): string[] =>
    [...tracked].filter(
      (file) => SOURCE.test(file) && pattern.test(file) && !/\.test\.tsx?$/.test(file),
    );

  const buildScripts = (): string[] => {
    const found = new Set<string>(["scripts/compose-e2e.mjs", "scripts/compose-seed.mjs"]);
    for (const manifest of [...tracked].filter((file) => file.endsWith("package.json"))) {
      if (manifest.includes("/templates")) continue;
      const scripts =
        (
          JSON.parse(readFileSync(path.join(REPO_ROOT, manifest), "utf8")) as {
            scripts?: Record<string, string>;
          }
        ).scripts ?? {};
      for (const name of ["build", "prebuild", "postbuild"]) {
        for (const match of (scripts[name] ?? "").matchAll(BUILD_SCRIPTS)) found.add(match[1]!);
      }
    }
    return [...found];
  };

  it("holds every root script either harness or a build imports in HARNESS_SCRIPTS", () => {
    const reached = closure([
      ...sources(
        /^(?:apps\/(?:portal|admin|api)\/|packages\/(?!create-qcms-app\/templates)|playwright[^/]*\.ts$)/,
      ),
      ...buildScripts(),
    ]);
    const scripts = [...reached].filter((file) => file.startsWith("scripts/")).sort();
    expect(scripts.filter((file) => !HARNESS_SCRIPTS.includes(file))).toEqual([]);
    expect(scripts).toContain("scripts/next-build.mjs");
    expect(scripts).toContain("scripts/ports.mjs");
  });

  it("calls nothing the browser harness imports unneeded", () => {
    const reached = closure([
      ...sources(/^(?:apps\/(?:portal|admin)\/|playwright\.config\.ts$)/),
      ...buildScripts(),
    ]);
    expect(reached.size).toBeGreaterThan(50);
    expect([...reached].filter((file) => !isUiNeeded([file]))).toEqual([]);
  });

  it("calls nothing the API harness imports unneeded", () => {
    const reached = closure([...sources(/^apps\/api\//), ...buildScripts()]);
    expect(reached.size).toBeGreaterThan(50);
    expect([...reached].filter((file) => !isApiNeeded([file]))).toEqual([]);
  });

  /**
   * A tooling test reaching app or package source loads a built workspace package through it, and
   * the plan-only lane builds nothing, so such a test belongs on the no-build exclusion list rather
   * than left to turn `check:plan` red on the next prose-only pull request.
   */
  it("excludes from the no-build tooling run every tooling test that reaches built source", () => {
    const BUILT = /^(?:apps\/|packages\/[^/]+\/src\/)/;
    const noBuild =
      (
        JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
          scripts: Record<string, string>;
        }
      ).scripts["test:tooling:no-build"] ?? "";
    const reaching = [...tracked]
      .filter((file) => /^scripts\/.*\.test\.tsx?$/.test(file))
      .filter((file) => [...closure([file])].some((reached) => BUILT.test(reached)))
      .sort();
    expect(reaching.length).toBeGreaterThan(0);
    expect(reaching.filter((file) => !noBuild.includes(path.posix.basename(file)))).toEqual([]);
  });
});

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

  it("diffs a merge queue entry from its base commit, covering every queued change", () => {
    const baseSha = git(["rev-parse", "HEAD"]).trim();
    write("plan/first.md", "prose\n");
    commit("first queued PR");
    write("packages/core/src/rules.ts", "export const rules = 1;\n");
    commit("second queued PR");
    const files = changedFiles("", { cwd: repo, baseSha });
    expect(files).toEqual(["packages/core/src/rules.ts", "plan/first.md"]);
    expect(isPlanOnly(files!)).toBe(false);
  });
});

/**
 * Runs the classifier as the workflow does, for a pull request and for a merge queue entry,
 * and reads back what it writes to `GITHUB_OUTPUT`.
 */
describe("the classifier's outputs for each event", () => {
  const SCRIPT = fileURLToPath(new URL("./ci-plan-only.mjs", import.meta.url));
  let repo: string;
  let baseSha: string;

  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  const commitFiles = (files: readonly string[]): void => {
    for (const file of files) {
      const absolute = path.join(repo, file);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${file}\n`);
    }
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
      "change",
    ]);
  };

  const outputs = (environment: Record<string, string>): Record<string, string> => {
    const outputFile = path.join(repo, "..", `${path.basename(repo)}.out`);
    writeFileSync(outputFile, "");
    execFileSync(process.execPath, [SCRIPT], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: outputFile, ...environment },
    });
    const text = readFileSync(outputFile, "utf8");
    rmSync(outputFile, { force: true });
    return Object.fromEntries(
      text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split("=") as [string, string]),
    );
  };

  const branch = (name: string, files: readonly string[]): void => {
    git(["checkout", "-q", "-B", name, baseSha]);
    commitFiles(files);
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "qcms-ci-outputs-"));
    git(["init", "-q", "-b", "main"]);
    commitFiles(["README.md"]);
    baseSha = git(["rev-parse", "HEAD"]).trim();
    git(["update-ref", "refs/remotes/origin/main", baseSha]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const PR = { GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "main" };
  const queue = (): Record<string, string> => ({
    GITHUB_EVENT_NAME: "merge_group",
    MERGE_GROUP_BASE_SHA: baseSha,
  });

  it("skips both suites for a docker and scripts diff, on a PR and in the queue", () => {
    branch("docker", ["docker/api.Dockerfile", "scripts/check-comments.mjs"]);
    for (const environment of [PR, queue()]) {
      expect(outputs(environment)).toEqual({
        plan_only: "false",
        admin_only: "false",
        ui_needed: "false",
        api_needed: "false",
      });
    }
  });

  it("runs only the browser suite for an admin diff with its mirror and changeset", () => {
    branch("admin", [
      "apps/admin/app/page.tsx",
      "packages/create-qcms-app/templates/common/apps/admin/app/page.tsx",
      ".changeset/admin.md",
    ]);
    for (const environment of [PR, queue()]) {
      expect(outputs(environment)).toEqual({
        plan_only: "false",
        admin_only: "true",
        ui_needed: "true",
        api_needed: "false",
      });
    }
  });

  it("runs only the API suite for an API end-to-end test change", () => {
    branch("api-e2e", ["apps/api/e2e/security/matrix-coverage.e2e.ts"]);
    for (const environment of [PR, queue()]) {
      expect(outputs(environment)).toMatchObject({ ui_needed: "false", api_needed: "true" });
    }
  });

  it("takes the fast lane for changesets and dependabot, in the queue too", () => {
    branch("prose", [".changeset/x.md", ".github/dependabot.yml", "docs/use-cases/manifest.json"]);
    for (const environment of [PR, queue()]) {
      expect(outputs(environment)).toMatchObject({ plan_only: "true", ui_needed: "false" });
    }
  });

  it("covers every PR in a queue entry, so one code change runs both suites", () => {
    branch("stacked", ["docker/api.Dockerfile"]);
    commitFiles(["packages/core/src/rules.ts"]);
    expect(outputs(queue())).toMatchObject({ ui_needed: "true", api_needed: "true" });
  });

  it("runs every suite for a push or a queue entry without a base SHA", () => {
    const full = { plan_only: "false", admin_only: "false", ui_needed: "true", api_needed: "true" };
    expect(outputs({ GITHUB_EVENT_NAME: "push" })).toEqual(full);
    expect(outputs({ GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE_SHA: "" })).toEqual(full);
  });
});

describe("choosing the diff base for the event", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("uses the base branch for a pull request", () => {
    expect(diffBase({ GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "main" })).toEqual({
      base: "origin/main",
      options: {},
      baseRef: "main",
    });
  });

  it("uses the queue's base commit for a merge group", () => {
    expect(diffBase({ GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE_SHA: sha })).toEqual({
      base: sha,
      options: { baseSha: sha },
      baseRef: "",
    });
  });

  it("runs the full suite for a merge group without a usable base SHA", () => {
    expect(diffBase({ GITHUB_EVENT_NAME: "merge_group" })).toHaveProperty("skip");
    expect(
      diffBase({ GITHUB_EVENT_NAME: "merge_group", MERGE_GROUP_BASE_SHA: "main" }),
    ).toHaveProperty("skip");
  });

  it("runs the full suite for a push or a manual run", () => {
    expect(diffBase({ GITHUB_EVENT_NAME: "push", GITHUB_BASE_REF: "main" })).toHaveProperty("skip");
    expect(diffBase({ GITHUB_EVENT_NAME: "workflow_dispatch" })).toHaveProperty("skip");
  });
});
