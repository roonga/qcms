import { describe, expect, it } from "vitest";

import { GIT_BIN_OVERRIDE_ENV_VAR, gitBinary, gitCandidates } from "./git-binary.ts";

/**
 * Tests for the git locator the two admin source-listing checks share (issue #1126).
 *
 * The property is that neither the candidate list nor the override can become a `PATH`
 * lookup, since avoiding one is the whole reason this module exists rather than a bare
 * `git`. Both halves of the override guard are driven, because a guard that only rejects
 * the easy case is the one that lets the real miss through.
 */

const WINDOWS_ENV = {
  ProgramFiles: "/fake/program-files",
  "ProgramFiles(x86)": "/fake/program-files-x86",
  LOCALAPPDATA: "/fake/local",
};

describe("gitCandidates", () => {
  it("probes only absolute paths, on either platform", () => {
    for (const platform of ["linux", "win32"] as const) {
      const candidates = gitCandidates(WINDOWS_ENV, platform);
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) expect(candidate).not.toBe("git");
    }
  });

  it("builds the Windows locations from the environment, never from a literal", () => {
    const candidates = gitCandidates(WINDOWS_ENV, "win32");
    expect(candidates.some((candidate) => candidate.includes("program-files"))).toBe(true);
    expect(candidates.some((candidate) => candidate.includes("local"))).toBe(true);
  });

  it("adds nothing Windows-shaped on POSIX", () => {
    expect(gitCandidates(WINDOWS_ENV, "linux")).toEqual(gitCandidates({}, "linux"));
    for (const candidate of gitCandidates(WINDOWS_ENV, "linux")) {
      expect(candidate).not.toContain("program-files");
    }
  });

  it("skips a Windows root the environment does not name", () => {
    expect(gitCandidates({}, "win32")).toEqual([]);
  });
});

describe("gitBinary", () => {
  it("refuses a relative override, which would be the PATH lookup being avoided", () => {
    expect(() => gitBinary({ [GIT_BIN_OVERRIDE_ENV_VAR]: "git" })).toThrow(/absolute path/);
  });

  it("refuses an absolute override that does not exist", () => {
    expect(() => gitBinary({ [GIT_BIN_OVERRIDE_ENV_VAR]: "/nowhere/git" })).toThrow(
      /does not exist/,
    );
  });

  it("names every probed location, and the override, when git is nowhere", () => {
    // Fake Windows roots, so the assertion holds on whatever host runs the suite.
    expect(() => gitBinary(WINDOWS_ENV, "win32")).toThrow(
      new RegExp(`no git binary at any of:.*program-files.*${GIT_BIN_OVERRIDE_ENV_VAR}`, "s"),
    );
  });

  it("finds git on the host this suite is running on", () => {
    // The case the two source-listing checks depend on, asserted where they run.
    expect(gitBinary()).toMatch(/git/);
  });
});
