import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_AGE_HOURS,
  DEFAULT_ROOT,
  classify,
  humanKb,
  linkedGitDir,
  main,
  parseArgs,
  primaryCheckout,
  scan,
} from "./prune-worktrees.mjs";

/**
 * The worktree orphan sweep (issue #735).
 *
 * What matters here is not that it deletes: it is what it refuses to delete. Every
 * refusal below corresponds to a directory that really sits under `.claude/worktrees`
 * in this repository, so a regression in one of them destroys real work or real data.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** A repository with a `.claude/worktrees` root, one live linked worktree in it. */
function fixture(): { repo: string; root: string; live: string } {
  const repo = temporaryDirectory("qcms-prune-repo-");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "--initial-branch", "main", "--quiet");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(join(repo, "file.txt"), "content\n", "utf8");
  git("add", "file.txt");
  git("commit", "--quiet", "-m", "initial");

  const root = join(repo, DEFAULT_ROOT);
  mkdirSync(root, { recursive: true });
  const live = join(root, "live-lane");
  git("worktree", "add", "--quiet", "-b", "feat/live", live);
  return { repo, root, live };
}

/** A directory that looks like a worktree whose git directory no longer exists. */
function detachedLeftover(root: string, name: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, ".git"),
    `gitdir: ${join(root, "..", "..", ".git", "worktrees", name)}\n`,
    "utf8",
  );
  writeFileSync(join(path, "package.json"), "{}\n", "utf8");
  return path;
}

const ANCIENT = Date.now() + DEFAULT_MIN_AGE_HOURS * 2 * 60 * 60 * 1000;

describe("classify", () => {
  it("keeps a registered worktree, which is a live lane", () => {
    const { live } = fixture();
    const entry = classify({
      name: "live-lane",
      path: live,
      registered: new Set([live]),
      minAgeMs: 0,
      now: ANCIENT,
    });
    expect(entry).toMatchObject({ verdict: "registered", removable: false });
  });

  it("keeps a directory that is not a worktree leftover at all", () => {
    // `.claude/worktrees/seat-mail` is the real case: a retired message store that has
    // no `.git` file and never was a checkout. A sweep that removed it would delete
    // data rather than reclaim space.
    const { root } = fixture();
    const path = join(root, "seat-mail");
    mkdirSync(join(path, "dev"), { recursive: true });
    const entry = classify({
      name: "seat-mail",
      path,
      registered: new Set(),
      minAgeMs: 0,
      now: ANCIENT,
    });
    expect(entry).toMatchObject({ verdict: "not-a-worktree", removable: false });
  });

  it("keeps an unregistered worktree that has uncommitted work", () => {
    const { repo, root } = fixture();
    const path = join(root, "dirty-lane");
    execFileSync("git", ["-C", repo, "worktree", "add", "--quiet", "-b", "feat/dirty", path]);
    writeFileSync(join(path, "file.txt"), "edited\n", "utf8");
    const entry = classify({
      name: "dirty-lane",
      path,
      registered: new Set(), // pretend git no longer lists it
      minAgeMs: 0,
      now: ANCIENT,
    });
    expect(entry).toMatchObject({ verdict: "uncommitted", removable: false });
    expect(entry.detail).toMatch(/uncommitted path/);
  });

  it("removes an unregistered worktree that is clean", () => {
    const { repo, root } = fixture();
    const path = join(root, "clean-lane");
    execFileSync("git", ["-C", repo, "worktree", "add", "--quiet", "-b", "feat/clean", path]);
    const entry = classify({
      name: "clean-lane",
      path,
      registered: new Set(),
      minAgeMs: 0,
      now: ANCIENT,
    });
    expect(entry).toMatchObject({ verdict: "orphan-clean", removable: true });
  });

  it("removes a leftover whose git directory is gone, which is the bulk of the accumulation", () => {
    const { root } = fixture();
    const path = detachedLeftover(root, "060-theme-scope");
    const entry = classify({
      name: "060-theme-scope",
      path,
      registered: new Set(),
      minAgeMs: 0,
      now: ANCIENT,
    });
    expect(entry).toMatchObject({ verdict: "orphan-detached", removable: true });
    expect(entry.detail).toMatch(/git directory gone/);
  });

  it("keeps anything modified inside the age window, whatever else is true of it", () => {
    // The safety net for a lane that is working right now: its directory is new, so it
    // is never swept even though nothing has registered it yet.
    const { root } = fixture();
    const path = detachedLeftover(root, "just-created");
    const entry = classify({
      name: "just-created",
      path,
      registered: new Set(),
      minAgeMs: DEFAULT_MIN_AGE_HOURS * 60 * 60 * 1000,
      now: Date.now(),
    });
    expect(entry).toMatchObject({ verdict: "recent", removable: false });
  });
});

describe("linkedGitDir", () => {
  it("reads the git directory a linked worktree names, and nothing from a plain directory", () => {
    const { root, live } = fixture();
    expect(linkedGitDir(live)).toMatch(/worktrees[/\\]live-lane$/);
    const plain = join(root, "plain");
    mkdirSync(plain, { recursive: true });
    expect(linkedGitDir(plain)).toBeUndefined();
  });
});

describe("scan", () => {
  it("reports registrations whose directory has been deleted, which git prunes", () => {
    const { repo, root } = fixture();
    const path = join(root, "removed-by-hand");
    execFileSync("git", ["-C", repo, "worktree", "add", "--quiet", "-b", "feat/gone", path]);
    rmSync(path, { recursive: true, force: true });
    const result = scan({ repoRoot: repo, root: DEFAULT_ROOT, minAgeHours: 0, now: ANCIENT });
    expect(result.missing).toContain(path);
  });

  it("returns an empty set rather than throwing when the root does not exist", () => {
    const { repo } = fixture();
    expect(scan({ repoRoot: repo, root: "nowhere", minAgeHours: 0 }).entries).toEqual([]);
  });
});

describe("primaryCheckout", () => {
  it("answers with the primary checkout from inside a linked worktree", () => {
    const { repo, live } = fixture();
    expect(primaryCheckout(live)).toBe(primaryCheckout(repo));
  });
});

describe("main", () => {
  it("changes nothing without --apply, so the report is safe to run anywhere", () => {
    const { repo, root } = fixture();
    const orphan = detachedLeftover(root, "old-lane");
    const lines: string[] = [];
    const original = console.log;
    console.log = (message: string) => lines.push(message);
    try {
      expect(main(["--min-age-hours", "0"], repo)).toBe(0);
    } finally {
      console.log = original;
    }
    expect(existsSync(orphan)).toBe(true);
    expect(lines.join("\n")).toMatch(/orphan {2}old-lane/);
    expect(lines.join("\n")).toMatch(/Re-run with --apply/);
  });

  it("exits 1 under --strict when orphans remain, so it can be read as a drift check", () => {
    const { repo, root } = fixture();
    detachedLeftover(root, "old-lane");
    const original = console.log;
    console.log = () => {};
    try {
      expect(main(["--min-age-hours", "0", "--strict"], repo)).toBe(1);
    } finally {
      console.log = original;
    }
  });

  it("removes only the orphans under --apply, leaving the live lane and the data directory", () => {
    const { repo, root, live } = fixture();
    const orphan = detachedLeftover(root, "old-lane");
    const data = join(root, "seat-mail");
    mkdirSync(data, { recursive: true });
    const original = console.log;
    console.log = () => {};
    try {
      expect(main(["--min-age-hours", "0", "--apply"], repo)).toBe(0);
    } finally {
      console.log = original;
    }
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(data)).toBe(true);
  });
});

describe("parseArgs", () => {
  it("defaults to a report over the agent worktree root", () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      size: false,
      strict: false,
      root: DEFAULT_ROOT,
      minAgeHours: DEFAULT_MIN_AGE_HOURS,
    });
  });

  it("rejects an unusable age instead of sweeping with a NaN guard", () => {
    // `Number("soon")` is NaN, and every comparison against NaN is false, so an
    // unvalidated value would disable the age guard rather than fail.
    expect(() => parseArgs(["--min-age-hours", "soon"])).toThrow(/non-negative number/);
    expect(() => parseArgs(["--unknown"])).toThrow(/unknown option/);
  });
});

describe("humanKb", () => {
  it("scales to the unit a reader can act on", () => {
    expect(humanKb(512)).toBe("512 KB");
    expect(humanKb(1536)).toBe("1.5 MB");
    expect(humanKb(75 * 1024 * 1024)).toBe("75 GB");
  });
});

describe("the sweep is documented where the conductor reads", () => {
  // #735 asks for the cleanup pass AND for something that says when to run it. The
  // script alone would repeat the defect: a mechanism nothing ever invokes.
  it.each([".claude/skills/task/SKILL.md", ".claude/skills/next-task/SKILL.md"])(
    "%s names the sweep",
    (file) => {
      expect(readFileSync(join(REPO_ROOT, file), "utf8")).toContain("scripts/prune-worktrees.mjs");
    },
  );
});
