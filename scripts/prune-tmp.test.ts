import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_AGE_MINUTES,
  TEMP_PREFIXES,
  classify,
  countInodes,
  main,
  matchPrefix,
  parseArgs,
  scan,
  withinRoot,
} from "./prune-tmp.mjs";

/**
 * The temporary-directory sweep (issue #918).
 *
 * Every test here runs against a fake temporary root, never the real one: the whole
 * subject is a recursive delete under a directory shared by every process on the
 * machine, so a test that pointed at the real `os.tmpdir()` would be the exact accident
 * the script exists to avoid. As with the worktree sweep, what matters is less that it
 * deletes than what it refuses to delete, and each refusal below is a directory that
 * really sits in `/tmp` on the development host.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway directory standing in for `os.tmpdir()`. */
function fakeTmp(): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-prune-tmp-fixture-"));
  temporaryRoots.push(root);
  return root;
}

/** A directory of `files` files under `root`, as a stamped workspace looks. */
function workspace(root: string, name: string, files = 3): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  for (let index = 0; index < files; index += 1) {
    writeFileSync(join(path, `file-${String(index)}.txt`), "content\n", "utf8");
  }
  return path;
}

/**
 * Backdate an entry, and every immediate child of it, by `minutes`.
 *
 * The children matter: the age guard reads the newest mtime among a directory and its
 * top-level entries, so ageing only the directory would leave it looking new.
 */
function age(path: string, minutes: number): string {
  const when = new Date(Date.now() - minutes * 60 * 1000);
  let children: string[];
  try {
    children = readdirSync(path);
  } catch {
    children = [];
  }
  for (const child of children) utimesSync(join(path, child), when, when);
  utimesSync(path, when, when);
  return path;
}

const GUARD_MS = DEFAULT_MIN_AGE_MINUTES * 60 * 1000;

describe("TEMP_PREFIXES", () => {
  it("names a creator for every prefix, and every committed creator still exists", () => {
    expect(TEMP_PREFIXES.length).toBeGreaterThan(0);
    for (const { prefix, creator } of TEMP_PREFIXES) {
      expect(prefix).not.toBe("");
      expect(creator).not.toBe("");
      // A creator that reads as a repository path has to be one, or the list has gone
      // stale and the sweep is removing directories nothing in the tree still makes.
      if (/^[\w./-]+\.(?:ts|mjs|sh)$/.test(creator)) {
        expect(existsSync(join(REPO_ROOT, creator)), `${creator} (for ${prefix})`).toBe(true);
      }
    }
  });

  it("lists each prefix once", () => {
    const prefixes = TEMP_PREFIXES.map((entry) => entry.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("matchPrefix", () => {
  it("claims a scaffold workspace", () => {
    expect(matchPrefix("qcms-scaffold-Ab12Cd")?.prefix).toBe("qcms-scaffold-");
  });

  it("gives a nested name to the longest matching prefix, so it is reported once", () => {
    const match = matchPrefix("qcms-scaffold-e2e-Ab12Cd");
    expect(match?.prefix).toBe("qcms-scaffold-e2e-");
    expect(match?.creator).toBe("packages/create-qcms-app/scripts/scaffold-e2e.mjs");
  });

  it("claims the agent loop's session log, which is a file rather than a directory", () => {
    expect(matchPrefix("agent-loop-session-Ab12Cd")?.creator).toBe("scripts/agent-loop.sh");
  });

  it("claims nothing this repository does not create", () => {
    // Both really sit in `/tmp` on the development host. Neither is ours to remove.
    expect(matchPrefix("playwright_chromiumdev_profile-Ab12Cd")).toBeUndefined();
    expect(matchPrefix("systemd-private-abc")).toBeUndefined();
  });

  it("claims nothing from the bare prefix alone, which names no run", () => {
    expect(matchPrefix("qcms-scaffold-")).toBeUndefined();
  });

  it("matches the basename, so a parent directory cannot lend its prefix", () => {
    expect(matchPrefix("qcms-scaffold-Ab12Cd/etc")).toBeUndefined();
  });
});

describe("withinRoot", () => {
  it("accepts a child", () => {
    expect(withinRoot("/base", "/base/child")).toBe(true);
  });

  it("rejects the root itself, which this sweep never removes", () => {
    expect(withinRoot("/base", "/base")).toBe(false);
  });

  it("rejects a sibling whose path merely starts with the root's characters", () => {
    expect(withinRoot("/base", "/base-other/child")).toBe(false);
  });

  it("rejects an escape through a parent segment", () => {
    expect(withinRoot("/base", "/base/../etc/passwd")).toBe(false);
  });
});

describe("classify", () => {
  const at = (root: string, name: string, now = Date.now()) =>
    classify({ name, root, minAgeMs: GUARD_MS, now });

  it("ignores a name no prefix claims", () => {
    const root = fakeTmp();
    age(workspace(root, "playwright_chromiumdev_profile-keep"), DEFAULT_MIN_AGE_MINUTES * 10);
    expect(at(root, "playwright_chromiumdev_profile-keep")).toBeUndefined();
  });

  it("marks a claimed workspace older than the guard removable", () => {
    const root = fakeTmp();
    age(workspace(root, "qcms-scaffold-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    const entry = at(root, "qcms-scaffold-old");
    expect(entry?.verdict).toBe("stale");
    expect(entry?.removable).toBe(true);
    expect(entry?.kind).toBe("directory");
  });

  it("keeps one younger than the guard, which may be a run in progress", () => {
    const root = fakeTmp();
    workspace(root, "qcms-scaffold-live");
    const entry = at(root, "qcms-scaffold-live");
    expect(entry?.verdict).toBe("recent");
    expect(entry?.removable).toBe(false);
  });

  it("keeps an old directory whose top-level entry was just written", () => {
    // A long install writes into a workspace whose own mtime stopped moving hours ago.
    const root = fakeTmp();
    const path = age(workspace(root, "qcms-scaffold-installing"), DEFAULT_MIN_AGE_MINUTES * 4);
    writeFileSync(join(path, "just-written.txt"), "now\n", "utf8");
    expect(at(root, "qcms-scaffold-installing")?.verdict).toBe("recent");
  });

  it("marks a claimed stale file removable, and calls it a file", () => {
    const root = fakeTmp();
    const path = join(root, "agent-loop-session-old");
    writeFileSync(path, "log\n", "utf8");
    age(path, DEFAULT_MIN_AGE_MINUTES * 4);
    const entry = at(root, "agent-loop-session-old");
    expect(entry?.verdict).toBe("stale");
    expect(entry?.kind).toBe("file");
    expect(entry?.removable).toBe(true);
  });

  it("keeps a symbolic link whatever its age, and never follows it", () => {
    const root = fakeTmp();
    const real = age(workspace(root, "real-tree"), DEFAULT_MIN_AGE_MINUTES * 10);
    const link = join(root, "qcms-scaffold-link");
    symlinkSync(real, link);
    const entry = at(root, "qcms-scaffold-link");
    expect(entry?.verdict).toBe("symlink");
    expect(entry?.removable).toBe(false);
  });

  it("refuses a claimed name that resolves outside the root", () => {
    const root = fakeTmp();
    const entry = at(root, join("..", "qcms-scaffold-escape"));
    expect(entry?.verdict).toBe("outside");
    expect(entry?.removable).toBe(false);
  });

  it("keeps something that is neither a directory nor a regular file", () => {
    const root = fakeTmp();
    // A dangling link is still a link: `lstat` sees it, and nothing follows it.
    symlinkSync(join(root, "gone"), join(root, "qcms-render-dangling"));
    expect(at(root, "qcms-render-dangling")?.removable).toBe(false);
  });
});

describe("scan", () => {
  it("reports only claimed names, sorted, with the rest untouched", () => {
    const root = fakeTmp();
    age(workspace(root, "qcms-scaffold-e2e-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    age(workspace(root, "qcms-render-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    workspace(root, "qcms-scaffold-live");
    age(workspace(root, "org.chromium.Chromium.xyz"), DEFAULT_MIN_AGE_MINUTES * 4);

    const { entries } = scan({ tmpRoot: root, minAgeMinutes: DEFAULT_MIN_AGE_MINUTES });
    expect(entries.map((entry) => entry.name)).toEqual([
      "qcms-render-old",
      "qcms-scaffold-e2e-old",
      "qcms-scaffold-live",
    ]);
    expect(entries.filter((entry) => entry.removable).map((entry) => entry.name)).toEqual([
      "qcms-render-old",
      "qcms-scaffold-e2e-old",
    ]);
  });

  it("reports nothing for a root that does not exist", () => {
    expect(scan({ tmpRoot: join(fakeTmp(), "absent"), minAgeMinutes: 60 }).entries).toEqual([]);
  });
});

describe("countInodes", () => {
  it("counts the directory itself and everything under it", () => {
    const root = fakeTmp();
    const path = workspace(root, "qcms-scaffold-counted", 3);
    mkdirSync(join(path, "nested"));
    writeFileSync(join(path, "nested", "deep.txt"), "x\n", "utf8");
    expect(countInodes(path)).toBe(6); // the directory, 3 files, `nested`, and its file
  });
});

describe("parseArgs", () => {
  it("defaults to a report with the documented guard", () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      count: false,
      strict: false,
      minAgeMinutes: DEFAULT_MIN_AGE_MINUTES,
    });
  });

  it("moves the guard", () => {
    expect(parseArgs(["--min-age-minutes", "240"]).minAgeMinutes).toBe(240);
  });

  it("rejects a guard that is not a non-negative number", () => {
    expect(() => parseArgs(["--min-age-minutes", "soon"])).toThrow(/non-negative/);
    expect(() => parseArgs(["--min-age-minutes", "-1"])).toThrow(/non-negative/);
    expect(() => parseArgs(["--min-age-minutes"])).toThrow(/non-negative/);
  });

  it("rejects an unknown option rather than ignoring it", () => {
    expect(() => parseArgs(["--force"])).toThrow(/unknown option/);
  });
});

describe("main", () => {
  it("changes nothing without --apply", () => {
    const root = fakeTmp();
    const stale = age(workspace(root, "qcms-scaffold-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    expect(main([], root)).toBe(0);
    expect(existsSync(stale)).toBe(true);
  });

  it("removes the stale entries and keeps everything else", () => {
    const root = fakeTmp();
    const stale = age(workspace(root, "qcms-scaffold-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    const staleFile = join(root, "agent-loop-session-old");
    writeFileSync(staleFile, "log\n", "utf8");
    age(staleFile, DEFAULT_MIN_AGE_MINUTES * 4);
    const live = workspace(root, "qcms-scaffold-live");
    const unclaimed = age(workspace(root, "playwright_chromiumdev_profile-x"), 60 * 24);

    expect(main(["--apply", "--count"], root)).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(unclaimed)).toBe(true);
  });

  it("removes a link's name never, and its target never", () => {
    const root = fakeTmp();
    const real = age(workspace(root, "real-tree"), DEFAULT_MIN_AGE_MINUTES * 10);
    const link = join(root, "qcms-scaffold-link");
    symlinkSync(real, link);

    expect(main(["--apply"], root)).toBe(0);
    expect(existsSync(link)).toBe(true);
    expect(existsSync(join(real, "file-0.txt"))).toBe(true);
  });

  it("honours a wider guard by keeping what a narrower one would remove", () => {
    const root = fakeTmp();
    const stale = age(workspace(root, "qcms-scaffold-old"), 90);
    expect(main(["--apply", "--min-age-minutes", "240"], root)).toBe(0);
    expect(existsSync(stale)).toBe(true);
    expect(main(["--apply", "--min-age-minutes", "30"], root)).toBe(0);
    expect(existsSync(stale)).toBe(false);
  });

  it("removes nothing when the guard is the whole window", () => {
    const root = fakeTmp();
    const stale = age(workspace(root, "qcms-scaffold-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    expect(main(["--apply", "--min-age-minutes", "100000"], root)).toBe(0);
    expect(existsSync(stale)).toBe(true);
  });

  it("fails under --strict while stale entries remain, and passes once they are gone", () => {
    const root = fakeTmp();
    age(workspace(root, "qcms-scaffold-old"), DEFAULT_MIN_AGE_MINUTES * 4);
    expect(main(["--strict"], root)).toBe(1);
    expect(main(["--apply"], root)).toBe(0);
    expect(main(["--strict"], root)).toBe(0);
  });

  it("reports a bad option as a usage error", () => {
    expect(main(["--force"], fakeTmp())).toBe(2);
  });
});
