import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_ONLY_PREFIXES,
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
 * Admin-only classification (issue #696).
 *
 * The asymmetry is milder than the plan-only lane's but the same shape. A false
 * negative costs the full browser suite on a PR that did not need it, which is what
 * happens today. A false positive runs only `admin-chromium` on a diff that CAN move
 * a portal surface, so a portal regression merges with a green required context.
 *
 * The trap worth being explicit about is `@qcms/ui` and `@qcms/core`: the two apps
 * share them, so "touches admin" and "cannot reach the portal" are different
 * questions and only the second one is safe.
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
    // The case the classification exists to get right. `@qcms/ui` renders both apps,
    // so an admin PR that also moves a control genuinely can break the portal.
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
