#!/usr/bin/env node
// @ts-check
/**
 * No machine-specific paths in committed content (issue #268).
 *
 * The rule is old and plainly stated: anyone can clone this repository into any parent
 * folder, so a committed file never assumes one. Nothing enforced it. There was no
 * `check:*` script, no lint rule and no CI step, so enforcement was review by whoever
 * happened to look - and it had already failed twice. PR #265 shipped 21 fixture strings
 * naming one developer's home directory, caught by an automated reviewer rather than by a
 * gate, and issue #248 records a Playwright spec writing literal Windows-shaped
 * directories, one of them carrying a person's name, into the repository root on every
 * run. The repository is public, which sets the cost of a miss.
 *
 * The parallel with R8 is exact, which is why this gate is modelled on
 * `scripts/check-ports.mjs` down to the shape of its exemption list. A rule that lives
 * only in prose decays, and the decay is invisible until someone reads the right diff on
 * the right day.
 *
 * ## What counts as machine-specific
 *
 * Four shapes, each one an absolute path that only resolves on the machine that wrote it:
 *
 *   1. a POSIX home directory naming a user
 *   2. a macOS home directory naming a user
 *   3. a drive-letter absolute path (a letter, a colon, then a separator)
 *   4. a WSL UNC host reference
 *
 * ## What deliberately does NOT count
 *
 *   - **A placeholder segment.** `~`, an angle-bracket placeholder, `${HOME}`, `$HOME`
 *     and `%USERPROFILE%` are the portable spellings the rule tells you to use, so a home
 *     directory written with one of them is the fix rather than the defect. This gate's
 *     own prose uses them for that reason, and scans cleanly over itself as a result. It
 *     is checked only on the segment immediately after the home root: a placeholder
 *     deeper in the path does not rescue a hard-coded user above it.
 *   - **Container-internal paths.** `/workspaces`, `/run` and the dev container's own
 *     fixed user home are properties of an image every contributor gets identically, not
 *     of one person's laptop. Only the last of those matches a pattern at all, and it is
 *     pinned in ALLOWED below rather than waved through by directory.
 *   - **`plan/`**, the scratch and history area, excluded here as it is by `check:ports`,
 *     `check:no-em-dash`, `check:adr-citations` and `check:vendor-pin`. Decided rather
 *     than inherited (#268 asked): it holds committed design HTML carrying base64 font
 *     blobs that no text scan reads usefully, and drafts that quote historical failures.
 *     `check:plan` does not run this gate.
 *   - **The vendored upstream component copy**, for the reason every other gate gives:
 *     it is not ours to edit, so a demand to change it is a demand nothing can satisfy.
 *   - **Files with no scanned extension**, `.gitignore` among them. Its Windows-shaped
 *     entry is the defensive ignore issue #248 added, which is the opposite of the defect.
 *
 * ## What it cannot see
 *
 * Written down because an unwritten limit is how a gate gets trusted past its reach.
 * A path assembled at runtime from fragments, a bare relative path that silently assumes
 * a parent directory name, and a home directory reached through a symlink are all out of
 * reach. Treat a clean run as "no machine path written in one of the four recognised
 * shapes", never as "no committed file assumes a location".
 *
 * Two limits are deliberate rather than incidental, and both are named beside the
 * patterns that hold them. **A drive path written with a doubled FORWARD slash is not
 * matched** - only the backslash run is allowed to double, because only backslashes are
 * escaped, and accepting a doubled forward slash starts matching `a://` shapes. **A
 * backslash run longer than four is not matched** either; four already covers a literal
 * nested twice, and a longer run is a regular expression rather than a path. Both are
 * false-negative directions, chosen so the gate stays believable enough to keep.
 *
 * It errs the other way once: a URL whose own path begins with the macOS home root reads
 * as a hit. No such URL is in the tree, and the answer if one arrives is an ALLOWED entry
 * with that reason rather than a weaker pattern.
 *
 * Usage:  node scripts/check-paths.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";
import { VENDORED_SOURCE_PATTERN } from "./vendored-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Tracked text this gate reads. Extensions rather than everything git lists, because the
 * catalogue also holds images, fonts and Playwright fixtures, and reading a binary as
 * UTF-8 yields replacement characters no pattern matches anyway.
 */
const TEXT_FILES =
  /\.(md|markdown|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|sh|css|html|txt|sql|toml|Dockerfile)$|(^|\/)(Dockerfile|\.env[^/]*)$/i;

/** Scratch and vendored areas. See the module comment for the reasoning on each. */
const EXCLUDED = [/^plan\//, VENDORED_SOURCE_PATTERN];

/**
 * A path segment that names a variable rather than a person. These are the spellings the
 * rule endorses, so a home directory written with one is portable and not a hit.
 */
const PLACEHOLDER = /^(?:~|<|\$\{|\$[A-Za-z_]|%[A-Za-z_])/;

/**
 * Where a path counts as machine-specific.
 *
 * Every pattern captures the **identifying part** of the reference rather than the whole
 * of it: the user segment after a home root, the host after a UNC prefix. Two reasons.
 * The home segment has to be testable against {@link PLACEHOLDER} on its own, and the
 * capture is what an ALLOWED entry names, so an exemption can be written without putting
 * a resolvable machine path into this file - which would make the gate match itself, and
 * the fix for that must never be to exempt the gate. The full text is still reported.
 *
 * Every separator is written escaped, for the same self-scanning reason.
 *
 * @type {{ kind: string; re: RegExp; home?: boolean }[]}
 */
const PATTERNS = [
  { kind: "posix home", re: /\/home\/([^\s/"'`\\|]+)/g, home: true },
  { kind: "macos home", re: /\/Users\/([^\s/"'`\\|]+)/g, home: true },
  // A letter, a colon, a separator, and something that looks like a path segment. The
  // leading boundary rejects a URL scheme, whose colon is preceded by a word character.
  //
  // **The backslash run is one to four, and the forward slash is exactly one.** That
  // asymmetry is the fix for a fail-open this gate shipped with (PR #791 review): the
  // separator was one character and could not be followed by another, so the raw
  // spelling was caught while the ESCAPED spelling a committed TS, JS or JSON string
  // literal actually carries - two backslashes, or four inside a nested literal or a
  // regular expression - matched nothing. That is the commonest in-source spelling of
  // the shape, so the gate was blind to it in exactly the files most likely to carry
  // one. Only backslashes are doubled, because only backslashes are escaped; a Windows
  // path is never written with a doubled forward slash, and accepting one would start
  // matching `a://` shapes such as an object literal whose value is a regular
  // expression, which is how a gate earns the false positive that gets it switched off.
  { kind: "drive letter", re: /(?<![\w:])([A-Za-z]:(?:\\{1,4}|\/)[\w$.~-]+)/g },
  { kind: "wsl unc", re: /(?:\\{2}|\/{2})(wsl[\w.$-]*)/gi },
];

/**
 * Paths that are legitimately not machine-specific, pinned to the file that may say so.
 *
 * `file` is the **exact repo-relative path**, compared with `===`, for the reason
 * `check-ports.mjs` spells out at length: a substring test silently exempts any path that
 * merely contains an entry, so a real violation is waved through and the run still prints
 * OK, which is the one failure mode a gate exists to prevent and is invisible when it
 * happens.
 *
 * `match` is the captured text, not the whole path, so this list can carry an exemption
 * without writing a machine path into the gate's own source - the file would then match
 * itself, and the fix for that must never be to exempt the gate.
 *
 * **Every entry here fires**, and `check-paths.test.ts` fails if one stops. A dead
 * exemption is not harmless: it reads as evidence the gate inspects that file. If an
 * entry goes dead because the file was reworded, delete it rather than restoring the path.
 *
 * @type {{ file: string; kind: string; match: string; why: string }[]}
 */
export const ALLOWED = [
  {
    file: ".devcontainer/devcontainer.json",
    kind: "posix home",
    match: "vscode",
    why: "the dev container's own fixed user home (ADR-29). The image creates that user, so every contributor's container has this path identically: it is container-internal in the same sense as /workspaces, not a property of anyone's machine. The three uses are bind-mount targets and a config directory inside the container.",
  },
  {
    file: "scripts/devcontainer.sh",
    kind: "wsl unc",
    match: "wsl.localhost",
    why: "a comment naming the UNC shape Docker Desktop reports on Windows, to explain why the script reads the POSIX form instead. Documentation of the shape, not a path anything resolves.",
  },
];

/**
 * The exemption reason for `file` and a captured match, when one applies.
 *
 * Exact repo-relative path, never a substring or suffix. See ALLOWED above for why.
 *
 * @param {string} file repo-relative path, as git reports it.
 * @param {string} kind the pattern that fired.
 * @param {string} match the captured text.
 * @returns {string | undefined}
 */
export function exemption(file, kind, match) {
  return ALLOWED.find((rule) => rule.file === file && rule.kind === kind && rule.match === match)
    ?.why;
}

/**
 * Every machine-specific path in `text`, with the line it sits on.
 *
 * `match` is the captured identifying part, which is what an exemption names; `text` is
 * the whole reference as written, which is what the failure prints.
 *
 * @param {string} text
 * @returns {{ kind: string; match: string; text: string; line: number }[]}
 */
export function pathsIn(text) {
  const found = [];
  text.split("\n").forEach((line, index) => {
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      let hit;
      while ((hit = pattern.re.exec(line)) !== null) {
        const captured = hit[1] ?? "";
        if (captured === "") continue;
        if (pattern.home === true && PLACEHOLDER.test(captured)) continue;
        found.push({ kind: pattern.kind, match: captured, text: hit[0], line: index + 1 });
      }
    }
  });
  return found;
}

/** @returns {string[]} tracked files this gate covers, repo-relative. */
export function scanned() {
  return trackedFilesUnder(REPO_ROOT, { match: TEXT_FILES }).filter(
    (file) => !EXCLUDED.some((pattern) => pattern.test(file)),
  );
}

/** Run the gate over the tracked tree. @returns {number} process exit code */
export function main() {
  const violations = [];
  const files = scanned();

  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const { kind, match, text: written, line } of pathsIn(text)) {
      if (exemption(file, kind, match) !== undefined) continue;
      violations.push(`  ${file}:${String(line)}  ${written}  (matched as: ${kind})`);
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-paths: OK - no machine-specific path in ${String(files.length)} tracked text files.`,
    );
    return 0;
  }

  console.error("check-paths: machine-specific path(s) in committed content:\n");
  for (const violation of violations.slice(0, 50)) console.error(violation);
  if (violations.length > 50) console.error(`  ... and ${String(violations.length - 50)} more`);
  console.error(
    [
      "",
      "Anyone can clone this repository into any parent folder, so a committed file never",
      "assumes one, and the repository is public. Derive the location instead: `import.meta`",
      "or `process.cwd()` in code, a repo-relative path in prose, `${HOME}` or `~` where a",
      "home directory is genuinely unavoidable, and an angle-bracket placeholder when the",
      "point is to SHOW the shape rather than to resolve it. A fixture needing a path builds",
      "one at runtime rather than committing a literal - that is what PR #265's lane did",
      "instead of allowlisting its own test file.",
      "",
      "If a path is genuinely not machine-specific (a container-internal location that every",
      "contributor's image has identically), add it to ALLOWED in this script with the reason,",
      "pinned to the one file that may say so. Never exempt this gate's own source.",
    ].join("\n"),
  );
  return 1;
}

// Only when run as a command, so `check-paths.test.ts` can import the pure helpers above
// without the scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
