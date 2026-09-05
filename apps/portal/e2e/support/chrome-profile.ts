/**
 * Where the Lighthouse gate's own Chrome keeps its temporary profile (issue #248).
 *
 * ## The defect
 *
 * Every `pnpm verify:browser` on a WSL host left five untracked directories at the
 * repository root whose NAMES were whole Windows paths, of the shape
 * `<drive>:\<user profile>\AppData\Local\lighthouse.<random>` - backslashes and all,
 * as one directory name.
 *
 * They are one careless `git add -A` from putting a machine-specific path and a
 * personal name into committed content, both of which this repository bans outright,
 * and nothing ever removed them - one set per run, for as long as the gate has
 * existed. A `.gitignore` entry would hide that and keep littering the tree, so the
 * write is stopped instead.
 *
 * ## Two writes, not one
 *
 * The Lighthouse audit drives a SECOND, separate Chrome through `chrome-launcher`,
 * and on WSL `chrome-launcher`'s `getPlatform()` answers `"wsl"` rather than
 * `"linux"`. That changes two things, and both had to be addressed:
 *
 *  1. **The profile it creates.** With no `userDataDir` option it calls its own
 *     `makeTmpDir()`, whose `wsl` branch overwrites `process.env.TEMP` with the
 *     Windows host's `LOCALAPPDATA` and then takes the `win32` path, so the profile
 *     is `mkdtemp`ed under a Windows drive path. Nothing on Linux interprets the
 *     backslashes, so the whole string becomes ONE relative directory under the
 *     process cwd - the repository root, for `pnpm verify:browser`. Passing any
 *     `userDataDir` skips `makeTmpDir()` entirely, which closes this half.
 *
 *  2. **The flag it passes to Chrome.** `chrome-launcher` assumes a WSL caller is
 *     launching the *Windows* Chrome, so it rewrites the directory through
 *     `wslpath -w`, turning `/tmp/x` into the UNC form under the distribution's
 *     `wsl.localhost` share. The browser here is Playwright's **Linux** Chromium,
 *     which takes that as a relative name and creates it under the cwd. Measured on
 *     this repository, the cwd was left with a directory named after the UNC form -
 *     the same defect wearing a different name, so passing `userDataDir` alone is
 *     not a fix.
 *
 * The second half is closed by appending our own `--user-data-dir` to `chromeFlags`.
 * `chrome-launcher` pushes its (converted) flag first and the caller's `chromeFlags`
 * after it, and Chrome's command line keeps the LAST value of a repeated switch. Also
 * measured rather than assumed: launching Chromium with the converted flag followed
 * by the POSIX one populates the POSIX directory and leaves the cwd empty, and with
 * the converted flag alone the cwd gains the backslashed directory.
 *
 * Passing `userDataDir` also turns OFF `chrome-launcher`'s own cleanup (it removes
 * only a directory it made), so the caller owns removal. {@link withChromeProfile} is
 * the supported entry point because it is the shape that cannot forget.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

/** Prefix for the per-launch profile directory. Recognisable in a stray `ls`. */
export const PROFILE_PREFIX = "qcms-lighthouse-";

/**
 * A temp root this platform can actually create a directory under.
 *
 * `os.tmpdir()` is trusted only when it is absolute *for the running platform*. On
 * POSIX that rules out an inherited Windows path (`TMPDIR`/`TMP`/`TEMP` are what
 * `os.tmpdir()` reads there, and a WSL shell can inherit the host's): a drive-letter
 * path is not absolute under `posix.isAbsolute`, which is exactly the test that has
 * to fire. On Windows the same call accepts the native path and rejects nothing real.
 *
 * A relative answer is never merely inconvenient here - it is a write into the
 * working tree - so the fallback is unconditional rather than a warning. The Windows
 * fallback is derived from the home directory rather than written down, because a
 * committed drive-letter literal is the very thing `check:paths` bans and this module
 * exists to stop.
 *
 * @param candidate what `os.tmpdir()` reports; injectable so the WSL case is testable.
 * @param platform `process.platform`; injectable for the same reason.
 */
export function safeTmpRoot(
  candidate: string = tmpdir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const onWindows = platform === "win32";
  const absolute = onWindows ? win32.isAbsolute(candidate) : posix.isAbsolute(candidate);
  if (candidate !== "" && absolute) return candidate;
  return onWindows ? win32.join(homedir(), "AppData", "Local", "Temp") : "/tmp";
}

/** Create one profile directory under the safe temp root and return its path. */
export function createChromeProfile(): string {
  return mkdtempSync(join(safeTmpRoot(), PROFILE_PREFIX));
}

/**
 * The flag that has to come after `chrome-launcher`'s own, so the browser uses the
 * directory we created rather than the `wslpath`-converted spelling of it.
 */
export function userDataDirFlag(userDataDir: string): string {
  return `--user-data-dir=${userDataDir}`;
}

/**
 * Run `body` with a freshly created Chrome profile directory, then remove it.
 *
 * Removal is best-effort for the reason the launch teardown already records: a
 * just-killed Chrome can still hold its profile files (EPERM on Windows), and the
 * audit is complete by then. A leaked directory under the OS temp root is the
 * operating system's problem; a leaked directory in the working tree was the bug.
 */
export async function withChromeProfile<T>(
  body: (userDataDir: string) => T | Promise<T>,
): Promise<T> {
  const userDataDir = createChromeProfile();
  try {
    return await body(userDataDir);
  } finally {
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10 });
    } catch {
      /* best-effort: the OS reclaims its own temp root */
    }
  }
}
