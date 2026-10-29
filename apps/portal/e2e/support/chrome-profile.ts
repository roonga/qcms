import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

/** Prefix for the per-launch profile directory. Recognisable in a stray `ls`. */
export const PROFILE_PREFIX = "qcms-lighthouse-";

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
