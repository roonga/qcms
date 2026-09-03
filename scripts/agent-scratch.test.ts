import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  laneSlug,
  main,
  parseArgs,
  resolveLane,
  resolveRoot,
  scratchPath,
} from "./agent-scratch.mjs";

/**
 * The lane-private scratch convention (issues #396, #602).
 *
 * The defect is that two lanes independently choose the same obvious log name in a
 * scratchpad that is shared rather than session-private, so one lane's evidence is
 * another lane's file. These tests pin the two properties that make that impossible:
 * two lanes never resolve to the same directory, and a path handed out for a named file
 * never carries a previous run's contents.
 */

const SCRIPT = fileURLToPath(new URL("agent-scratch.mjs", import.meta.url));

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** A real git working tree on `branch`, so lane resolution is exercised against git. */
function gitWorktree(branch: string): string {
  const directory = temporaryDirectory("qcms-agent-scratch-repo-");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  git("init", "--initial-branch", branch, "--quiet");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(join(directory, "file.txt"), "content\n", "utf8");
  git("add", "file.txt");
  git("commit", "--quiet", "-m", "initial");
  return directory;
}

describe("laneSlug", () => {
  it("turns a branch name into one safe path segment", () => {
    expect(laneSlug("fix/396-scratchpad")).toBe("fix-396-scratchpad");
    expect(laneSlug("feat/037-create-qcms-app-cli")).toBe("feat-037-create-qcms-app-cli");
  });

  it("refuses a name with nothing usable in it, rather than returning an empty segment", () => {
    // An empty segment would resolve to the shared root, which is the exact failure the
    // lane directory exists to remove: a silent fallback to the place everyone writes.
    expect(() => laneSlug("///")).toThrow(/no usable characters/);
  });
});

describe("resolveLane", () => {
  it("keys on the checked-out branch, so one lane owns one directory", () => {
    expect(resolveLane(gitWorktree("fix/602-stale-gate-log"), {})).toBe("fix-602-stale-gate-log");
  });

  it("keys a detached HEAD on its SHA rather than a shared fallback name", () => {
    const directory = gitWorktree("main");
    const head = execFileSync("git", ["-C", directory, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", directory, "checkout", "--quiet", "--detach", "HEAD"]);
    expect(resolveLane(directory, {})).toBe(`detached-${head}`);
  });

  it("lets a second agent on the same branch take its own lane through QCMS_AGENT_LANE", () => {
    // A reviewer runs the gates independently on the branch its executor is working on.
    // Without an override the two would share a directory and reproduce #602 inside one
    // branch, so the override is part of the convention rather than an escape hatch.
    const directory = gitWorktree("fix/396-scratchpad");
    expect(resolveLane(directory, { QCMS_AGENT_LANE: "fix/396-scratchpad review" })).toBe(
      "fix-396-scratchpad-review",
    );
  });

  it("refuses a directory that is not a working tree instead of guessing a lane", () => {
    expect(() => resolveLane(temporaryDirectory("qcms-agent-scratch-plain-"), {})).toThrow(
      /not a git working tree/,
    );
  });
});

describe("resolveRoot", () => {
  it("honours QCMS_AGENT_SCRATCH_ROOT and otherwise uses the platform temp directory", () => {
    expect(resolveRoot({ QCMS_AGENT_SCRATCH_ROOT: "/var/tmp/scratch" })).toBe("/var/tmp/scratch");
    expect(resolveRoot({})).toBe(join(tmpdir(), "qcms-agent-scratch"));
  });
});

describe("scratchPath", () => {
  it("gives two lanes two directories, which is the whole fix", () => {
    const root = temporaryDirectory("qcms-agent-scratch-root-");
    const environment = { QCMS_AGENT_SCRATCH_ROOT: root };
    const first = scratchPath({
      directory: process.cwd(),
      environment,
      lane: "fix/396-a",
      name: "verify.log",
    });
    const second = scratchPath({
      directory: process.cwd(),
      environment,
      lane: "fix/602-b",
      name: "verify.log",
    });
    expect(first).not.toBe(second);
    expect(first).toBe(join(root, "fix-396-a", "verify.log"));
    expect(second).toBe(join(root, "fix-602-b", "verify.log"));
  });

  it("creates the lane directory so a redirect into it cannot fail", () => {
    const root = temporaryDirectory("qcms-agent-scratch-root-");
    const directory = scratchPath({
      directory: process.cwd(),
      environment: { QCMS_AGENT_SCRATCH_ROOT: root },
      lane: "fix/735-worktrees",
    });
    expect(existsSync(directory)).toBe(true);
  });

  it("removes a leftover file at the path, so a stale log cannot be read as this run's", () => {
    // #602's second acceptance criterion. The lane found `verify.log` from a previous
    // run and briefly read a result from a previous day as its own.
    const root = temporaryDirectory("qcms-agent-scratch-root-");
    const environment = { QCMS_AGENT_SCRATCH_ROOT: root };
    const lane = "fix/602-stale";
    mkdirSync(join(root, "fix-602-stale"), { recursive: true });
    writeFileSync(join(root, "fix-602-stale", "verify.log"), "a green from 2026-08-20\n", "utf8");

    const path = scratchPath({
      directory: process.cwd(),
      environment,
      lane,
      name: "verify.log",
    });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a name that would reach outside the lane directory", () => {
    const root = temporaryDirectory("qcms-agent-scratch-root-");
    for (const name of ["../verify.log", "nested/verify.log", "..", ""]) {
      expect(() =>
        scratchPath({
          directory: process.cwd(),
          environment: { QCMS_AGENT_SCRATCH_ROOT: root },
          lane: "fix/396",
          name,
        }),
      ).toThrow(/single path segment/);
    }
  });

  it("prints the lane key on request without touching the filesystem", () => {
    const root = join(temporaryDirectory("qcms-agent-scratch-root-"), "unused");
    expect(
      scratchPath({
        directory: process.cwd(),
        environment: { QCMS_AGENT_SCRATCH_ROOT: root },
        lane: "fix/396",
        printLane: true,
      }),
    ).toBe("fix-396");
    expect(existsSync(root)).toBe(false);
  });
});

describe("parseArgs", () => {
  it("reads the file name, the lane override and the lane-only flag", () => {
    expect(parseArgs([])).toEqual({ printLane: false });
    expect(parseArgs(["verify.log"])).toEqual({ printLane: false, name: "verify.log" });
    expect(parseArgs(["--lane", "x", "browser.log"])).toEqual({
      printLane: false,
      lane: "x",
      name: "browser.log",
    });
    expect(parseArgs(["--print-lane"])).toEqual({ printLane: true });
  });

  it("rejects an unknown option rather than treating it as a file name", () => {
    expect(() => parseArgs(["--seat", "0"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--lane"])).toThrow(/requires a value/);
  });
});

describe("as a command", () => {
  it("prints one absolute path on stdout, so a shell can capture it", () => {
    const root = temporaryDirectory("qcms-agent-scratch-root-");
    const worktree = gitWorktree("fix/396-command");
    const output = execFileSync("node", [SCRIPT, "verify.log"], {
      cwd: worktree,
      encoding: "utf8",
      env: { ...process.env, QCMS_AGENT_SCRATCH_ROOT: root, QCMS_AGENT_LANE: "" },
    });
    expect(output.trim()).toBe(join(root, "fix-396-command", "verify.log"));
    expect(output.split("\n").filter((line) => line !== "")).toHaveLength(1);
  });

  it("reports an error and returns a non-zero code instead of printing a usable path", () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      expect(main(["--nope"], process.cwd(), {})).toBe(1);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toMatch(/unknown option/);
  });
});

describe("the convention is written where an agent meets it", () => {
  // #602's third acceptance criterion: the rule has to live in the instructions an
  // executor is actually briefed with, not only in a retro line. A test rather than a
  // habit, because the agent files are edited far more often than this script is.
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const briefings = [
    ".claude/agents/task-executor.md",
    ".claude/agents/task-reviewer.md",
    ".claude/agents/dev-task.md",
    ".claude/skills/task/SKILL.md",
    ".claude/skills/next-issue/SKILL.md",
    "CONTRIBUTING.md",
  ];

  it.each(briefings)("%s tells the reader to use the lane scratch helper", (file) => {
    expect(readFileSync(join(REPO_ROOT, file), "utf8")).toContain("scripts/agent-scratch.mjs");
  });
});
