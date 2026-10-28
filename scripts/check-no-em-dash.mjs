#!/usr/bin/env node
// @ts-check
/**
 * The banned glyph is referenced here only by its codepoint, so this file scans cleanly
 * over itself. Do not write it out.
 *
 * `.json` is deliberately out of scope: the append-only golden corpus (ADR-18) carries
 * em dashes inside frozen fixture data that must never be edited.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { VENDORED_SOURCE_PATHSPEC } from "./vendored-source.mjs";

// Node's execFile on Windows does not resolve `git` to `git.exe` without a shell.
const GIT = process.platform === "win32" ? "git.exe" : "git";
const EM_DASH = String.fromCharCode(0x2014);

const GLOBS = [
  "*.md",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.yml",
  "*.yaml",
  "*.sh",
];

function tracked() {
  const out = execFileSync(
    GIT,
    ["ls-files", "-z", ...GLOBS, VENDORED_SOURCE_PATHSPEC, ":!plan/**"],
    { encoding: "utf8" },
  );
  return out.split("\0").filter((p) => p !== "");
}

const violations = [];
for (const file of tracked()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!text.includes(EM_DASH)) continue;
  text.split("\n").forEach((line, i) => {
    if (line.includes(EM_DASH)) {
      violations.push(`  ${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    `check-no-em-dash: em dash (${EM_DASH}) is banned in QCMS prose/comments/strings:\n`,
  );
  for (const v of violations.slice(0, 50)) console.error(v);
  if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`);
  console.error("\nUse a colon, comma, parentheses, a period, or a spaced hyphen ( - ) instead.");
  console.error("The en dash is fine for ranges; the hyphen (-) is always fine.");
  process.exit(1);
}

console.log("check-no-em-dash: OK - no em dashes in tracked prose/source.");
