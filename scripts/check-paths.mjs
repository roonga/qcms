#!/usr/bin/env node
// @ts-check
/**
 * A clean run means no machine path written in one of the four recognised shapes, never
 * that no committed file assumes a location: a path assembled at runtime, a bare relative
 * path or a home directory reached through a symlink are all out of reach.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";
import { VENDORED_SOURCE_PATTERN } from "./vendored-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const TEXT_FILES =
  /\.(md|markdown|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|sh|css|html|txt|sql|toml|Dockerfile)$|(^|\/)(Dockerfile|\.env[^/]*)$/i;

const EXCLUDED = [/^plan\//, VENDORED_SOURCE_PATTERN];

/** The portable spellings the rule endorses, so a home directory using one is not a hit. */
const PLACEHOLDER = /^(?:~|<|\$\{|\$[A-Za-z_]|%[A-Za-z_])/;

/**
 * Each pattern captures the identifying part only, and every separator is written
 * escaped, so this file carries no resolvable machine path: the gate scans itself.
 */
const PATTERNS = [
  { kind: "posix home", re: /\/home\/([^\s/"'`\\|]+)/g, home: true },
  { kind: "macos home", re: /\/Users\/([^\s/"'`\\|]+)/g, home: true },
  // The backslash run is one to four and the forward slash exactly one: a committed
  // string literal carries the escaped spelling, and a doubled forward slash would start
  // matching `a://` shapes.
  { kind: "drive letter", re: /(?<![\w:])([A-Za-z]:(?:\\{1,4}|\/)[\w$.~-]+)/g },
  { kind: "wsl unc", re: /(?:\\{2}|\/{2})(wsl[\w.$-]*)/gi },
];

/**
 * `match` is the captured text rather than the whole path, so an exemption can be written
 * without putting a resolvable machine path in this file. Every entry must still fire:
 * `check-paths.test.ts` fails on a dead one.
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

export function exemption(file, kind, match) {
  return ALLOWED.find((rule) => rule.file === file && rule.kind === kind && rule.match === match)
    ?.why;
}

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

export function scanned() {
  return trackedFilesUnder(REPO_ROOT, { match: TEXT_FILES }).filter(
    (file) => !EXCLUDED.some((pattern) => pattern.test(file)),
  );
}

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
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
