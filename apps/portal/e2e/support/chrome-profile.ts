/**
 * Where the Lighthouse gate's own Chrome keeps its temporary profile.
 *
 * Chrome needs a writable profile directory and picks one itself by default, which on a
 * shared host puts two seats in the same place and makes one of them fail for a reason
 * that has nothing to do with the page under test. So each run gets its own directory,
 * created fresh and removed afterwards.
 *
 * The temp root is probed rather than assumed, because the platform default is not always
 * writable in a container, and a profile that cannot be created has to fail with the
 * reason rather than as a bare Chrome launch error.
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
