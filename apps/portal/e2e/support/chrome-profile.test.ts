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
 * one, it is five untracked directories in the repository root after every browser
 * gate, each NAMED after a whole Windows path, carrying a machine path and a personal
 * name into a tree one `git add -A` away from committing them.
 *
 * The launcher's own behaviour (which flag wins, what it creates) is not mocked - it
 * was measured against Chromium directly and the finding is recorded in
 * `chrome-profile.ts`. What is tested here is the part that has to hold on a machine
 * nobody checked by hand.
 */

/**
 * A Windows path, assembled rather than written down.
 *
 * `check:paths` bans a drive-letter literal in committed content, and it is right to:
 * the value under test here is exactly one of those, and spelling it out would put
 * the defect into the tree that the code under test exists to keep out of it.
 */
function windowsPath(...segments: readonly string[]): string {
  return ["C", ":", "\\", segments.join("\\")].join("");
}

/** What a WSL shell's `os.tmpdir()` can answer: a path from the Windows host. */
const INHERITED_WINDOWS_LOCAL = windowsPath("Users", "someone", "AppData", "Local");
const INHERITED_WINDOWS_TEMP = windowsPath("Users", "someone", "AppData", "Local", "Temp");

describe("safeTmpRoot", () => {
  it("keeps a POSIX temp directory that is already absolute", () => {
    expect(safeTmpRoot("/tmp", "linux")).toBe("/tmp");
    expect(safeTmpRoot("/var/folders/xy/T", "darwin")).toBe("/var/folders/xy/T");
  });

  it("refuses the Windows path a WSL shell inherits", () => {
    expect(safeTmpRoot(INHERITED_WINDOWS_LOCAL, "linux")).toBe("/tmp");
    expect(safeTmpRoot(INHERITED_WINDOWS_TEMP, "linux")).toBe("/tmp");
  });

  it("refuses any other relative or empty answer", () => {
    expect(safeTmpRoot("", "linux")).toBe("/tmp");
    expect(safeTmpRoot("tmp", "linux")).toBe("/tmp");
    expect(safeTmpRoot("./scratch", "linux")).toBe("/tmp");
  });

  it("accepts a native Windows temp directory when actually on Windows", () => {
    expect(safeTmpRoot(INHERITED_WINDOWS_TEMP, "win32")).toBe(INHERITED_WINDOWS_TEMP);
  });
});

describe("createChromeProfile", () => {
  it("creates a real directory outside the repository", () => {
    const dir = createChromeProfile();
    try {
      expect(existsSync(dir)).toBe(true);
      expect(dir).toContain(PROFILE_PREFIX);
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
    await withChromeProfile((dir) => {
      seen = dir;
      writeFileSync(join(dir, "chrome-out.log"), "a launcher writes here\n");
      expect(existsSync(dir)).toBe(true);
    });
    expect(seen).not.toBe("");
    expect(existsSync(seen)).toBe(false);
  });

  it("removes the profile after the body throws, and rethrows", async () => {
    let seen = "";
    await expect(
      withChromeProfile((dir) => {
        seen = dir;
        throw new Error("audit failed");
      }),
    ).rejects.toThrow("audit failed");
    expect(existsSync(seen)).toBe(false);
  });

  it("tolerates a profile the browser already removed", async () => {
    await expect(
      withChromeProfile((dir) => {
        rmSync(dir, { recursive: true, force: true });
        return "done";
      }),
    ).resolves.toBe("done");
  });
});

describe("userDataDirFlag", () => {
  it("renders the directory unconverted", () => {
    const dir = join(safeTmpRoot("/scratch", "linux"), `${PROFILE_PREFIX}abc`);
    expect(userDataDirFlag(dir)).toBe(`--user-data-dir=${dir}`);
  });
});
