import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROFILE_PREFIX,
  createChromeProfile,
  safeTmpRoot,
  userDataDirFlag,
  withChromeProfile,
} from "./chrome-profile.js";

/**
 * The Lighthouse gate must not write into the working tree (issue #248).
 *
 * Everything below is about one property: whatever this machine claims its temp
 * directory is, the profile path this module hands the browser is absolute for the
 * platform actually running. A relative answer here is not a slow test or an ugly
 * one, it is five untracked `C:\Users\<name>\...` directories in the repository root
 * after every browser gate, carrying a machine path and a personal name into a tree
 * one `git add -A` away from committing them.
 *
 * The launcher's own behaviour (which flag wins, what it creates) is not mocked - it
 * was measured against Chromium directly and the finding is recorded in
 * `chrome-profile.ts`. What is tested here is the part that has to hold on a machine
 * nobody checked by hand.
 */

describe("safeTmpRoot", () => {
  it("keeps a POSIX temp directory that is already absolute", () => {
    expect(safeTmpRoot("/tmp", "linux")).toBe("/tmp");
    expect(safeTmpRoot("/var/folders/xy/T", "darwin")).toBe("/var/folders/xy/T");
  });

  it("refuses the Windows path a WSL shell inherits", () => {
    // The exact shape of the defect: `os.tmpdir()` on POSIX reads TMPDIR/TMP/TEMP,
    // and chrome-launcher's own wsl branch goes further and assigns LOCALAPPDATA to
    // TEMP. Either way Node is handed a string that is not a path on this platform,
    // and `mkdtemp` then makes ONE directory whose name contains backslashes.
    expect(safeTmpRoot("C:\\Users\\someone\\AppData\\Local", "linux")).toBe("/tmp");
    expect(safeTmpRoot("C:\\Users\\someone\\AppData\\Local\\Temp", "linux")).toBe("/tmp");
  });

  it("refuses any other relative or empty answer", () => {
    // Not a WSL-only guard. An empty or relative TMPDIR is just as much a write into
    // the cwd, and the cwd of this gate is the repository root.
    expect(safeTmpRoot("", "linux")).toBe("/tmp");
    expect(safeTmpRoot("tmp", "linux")).toBe("/tmp");
    expect(safeTmpRoot("./scratch", "linux")).toBe("/tmp");
  });

  it("accepts a native Windows temp directory when actually on Windows", () => {
    // The same string that must be refused on Linux is the correct answer on win32,
    // which is why the test is platform-specific rather than a blanket ban.
    expect(safeTmpRoot("C:\\Users\\someone\\AppData\\Local\\Temp", "win32")).toBe(
      "C:\\Users\\someone\\AppData\\Local\\Temp",
    );
  });
});

describe("createChromeProfile", () => {
  it("creates a real directory outside the repository", () => {
    const dir = createChromeProfile();
    try {
      expect(existsSync(dir)).toBe(true);
      expect(dir).toContain(PROFILE_PREFIX);
      // The property that matters, stated directly: nothing lands under the repo.
      const repoRoot = new URL("../../../../", import.meta.url).pathname;
      expect(dir.startsWith(repoRoot)).toBe(false);
      if (process.platform !== "win32") expect(posix.isAbsolute(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("withChromeProfile", () => {
  it("removes the profile after the body resolves", async () => {
    let seen = "";
    await withChromeProfile(async (dir) => {
      seen = dir;
      writeFileSync(join(dir, "chrome-out.log"), "a launcher writes here\n");
      expect(existsSync(dir)).toBe(true);
    });
    expect(seen).not.toBe("");
    expect(existsSync(seen)).toBe(false);
  });

  it("removes the profile after the body throws, and rethrows", async () => {
    // A failed audit is the common case for this gate, and a profile leaked per
    // failure is how a temp root fills up over a day of red runs.
    let seen = "";
    await expect(
      withChromeProfile(async (dir) => {
        seen = dir;
        throw new Error("audit failed");
      }),
    ).rejects.toThrow("audit failed");
    expect(existsSync(seen)).toBe(false);
  });

  it("tolerates a profile the browser already removed", async () => {
    // `rmSync(..., { force: true })` is what makes teardown idempotent. A Chrome that
    // cleaned up after itself must not turn a completed audit red in the `finally`.
    await expect(
      withChromeProfile(async (dir) => {
        rmSync(dir, { recursive: true, force: true });
        return "done";
      }),
    ).resolves.toBe("done");
  });
});

describe("userDataDirFlag", () => {
  it("renders the directory unconverted", () => {
    // The point of the repeated flag: chrome-launcher pushes the `wslpath -w` form
    // first, this one comes after it in `chromeFlags`, and Chrome keeps the last
    // value of a repeated switch.
    expect(userDataDirFlag("/tmp/qcms-lighthouse-abc")).toBe(
      "--user-data-dir=/tmp/qcms-lighthouse-abc",
    );
  });
});
