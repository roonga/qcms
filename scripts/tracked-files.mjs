import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

/**
 * The repository's file catalogue, asked of git rather than walked (issues #629, #635, #641).
 *
 * A test or gate that asserts a property of "every X in this codebase" has to enumerate X
 * from somewhere. Reading the directory tree enumerates the **working directory**, which is
 * not the same set: `verify:browser`, `pnpm dev:admin` and `pnpm dev:portal` all leave
 * `apps/<app>/.next-dev` behind, a production build leaves `.next`, and both leave a
 * generated `next-env.d.ts` and agent instruction files beside them. A walk reads all of it
 * as source, which is how one gate came to be a stable red in any checkout that had run the
 * browser suite and a stable green on CI, which has no prior dev build.
 *
 * `.gitignore` is the one catalogue this repository maintains of what is generated rather
 * than authored, and git is how it is read. A skip list inside a test is a second copy that
 * only ever lags: the one that failed had `.next` in it while the dev server had been
 * building into `.next-dev` since issue #54.
 *
 * `--cached --others --exclude-standard` is tracked files plus files that are new and not
 * ignored, so a source file added and not yet staged is still in scope. Without `--others`
 * a gate is defeatable by not staging.
 *
 * A subprocess is the cost, which the walks were written to avoid. It buys a claim about
 * the repository rather than about the machine the suite happens to be running on.
 */

/** `git.exe` on Windows, `git` everywhere else. Matches the other tooling scripts. */
const GIT = process.platform === "win32" ? "git.exe" : "git";

/** Room for a NUL-separated listing of a large tree. */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Every file git knows about under `root`, as paths relative to `root`.
 *
 * @param {string} root Absolute path to the directory to enumerate.
 * @param {{ match?: RegExp }} [options] `match` is tested against each relative path.
 * @returns {string[]} Relative, slash-separated paths, sorted.
 */
export function trackedFilesUnder(root, options = {}) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`trackedFilesUnder: not a directory: ${root}`);
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

  // A walk fails loudly when it is pointed somewhere wrong; a subprocess can fail *open*,
  // returning nothing from the wrong working directory and leaving every assertion over the
  // set vacuously true. An empty enumeration is never a legitimate answer here, so it is an
  // error rather than a silent all-clear.
  if (all.length === 0) {
    throw new Error(`trackedFilesUnder: git listed no files under ${root}`);
  }

  const matched =
    options.match === undefined ? all : all.filter((path) => options.match?.test(path));
  return matched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
