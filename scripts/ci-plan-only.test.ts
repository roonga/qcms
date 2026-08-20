import { describe, expect, it } from "vitest";

import { PLAN_PREFIX, isPlanOnly } from "./ci-plan-only.mjs";

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
    expect(isPlanOnly(["plan/memory/project-state.md", "plan/pr-review-loop.md"])).toBe(true);
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
        "plan/memory/project-state.md",
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
