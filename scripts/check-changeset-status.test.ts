import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { baseBranchFrom, classify } from "./check-changeset-status.mjs";

const REPO_ROOT = new URL("../", import.meta.url);

const DIVERGED = 'Failed to find where HEAD diverged from "main". Does "main" exist?';
const NOT_IN_WORKSPACE = "Found changeset dev-seed-command for package qcms which is not in the";

describe("baseBranchFrom", () => {
  it("reads the configured branch", () => {
    expect(baseBranchFrom(JSON.stringify({ baseBranch: "trunk" }))).toBe("trunk");
  });

  it("falls back to what changesets itself defaults to", () => {
    expect(baseBranchFrom(JSON.stringify({}))).toBe("master");
  });

  it("reads this repository's own config", () => {
    const text = readFileSync(fileURLToPath(new URL(".changeset/config.json", REPO_ROOT)), "utf8");
    expect(baseBranchFrom(text)).toBe("main");
  });
});

describe("classify", () => {
  it("passes a zero exit", () => {
    expect(classify({ code: 0, output: "Packages to be bumped:", baseBranchResolves: true })).toBe(
      "ok",
    );
  });

  it("forgives the diverge failure only where the base branch is genuinely absent", () => {
    expect(classify({ code: 1, output: DIVERGED, baseBranchResolves: false })).toBe("no-base-ref");
  });

  it("does not forgive a diverge message when the base branch resolves", () => {
    expect(classify({ code: 1, output: DIVERGED, baseBranchResolves: true })).toBe("failed");
  });

  it("fails on the release-plan error even with no base branch", () => {
    // Raised by `assembleReleasePlan`, which runs before any git work, so it reaches a
    // checkout with no `main` too and the forgiveness must not swallow it there.
    expect(classify({ code: 1, output: NOT_IN_WORKSPACE, baseBranchResolves: false })).toBe(
      "failed",
    );
  });

  it("fails on an unrecognised error", () => {
    expect(
      classify({ code: 1, output: "some new changesets error", baseBranchResolves: false }),
    ).toBe("failed");
  });
});
