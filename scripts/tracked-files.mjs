import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

/**
 * Asked of git rather than walked: a directory walk enumerates the working directory,
 * which includes build output a gate would then read as source. `--others` keeps a new
 * unstaged file in scope, so a gate is not defeatable by not staging.
 */

const GIT = process.platform === "win32" ? "git.exe" : "git";

/** Room for a NUL-separated listing of a large tree. */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * @param {string} root
 * @param {{ match?: RegExp }} [options]
 * @returns {string[]}
 */
export function trackedFilesUnder(root, options = {}) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`trackedFilesUnder: not a directory: ${root}`);
  }

  // `RegExp.prototype.test` is stateful on a global or sticky pattern, so filtering with
  // one would silently drop roughly every second match. Refused rather than repaired.
  if (options.match !== undefined && (options.match.global || options.match.sticky)) {
    throw new Error(
      `trackedFilesUnder: match must not be global or sticky (got ${String(options.match)}); ` +
        "those flags make `test` stateful and silently drop paths",
    );
  }

  const listed = execFileSync(
    GIT,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    },
  );

  const all = listed.split("\0").filter((path) => path !== "");

  // A subprocess can fail open, leaving every assertion over an empty set vacuously true.
  if (all.length === 0) {
    throw new Error(`trackedFilesUnder: git listed no files under ${root}`);
  }

  const matched =
    options.match === undefined ? all : all.filter((path) => options.match?.test(path));
  return matched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
