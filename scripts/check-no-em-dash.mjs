#!/usr/bin/env node
// @ts-check
/**
 * No-em-dash gate (branding/style, 2026-07-21).
 *
 * The em dash (U+2014) is banned in QCMS prose, comments, and UI strings: it
 * reads as an AI-generated tell and QCMS is public. Use a colon, comma,
 * parentheses, a period, or a spaced hyphen ( - ) instead. The en dash
 * (U+2013) is allowed for numeric ranges (e.g. "R1-R7"); the hyphen (-) is
 * always fine.
 *
 * Deny-by-default over tracked prose/source/config: .md .ts .tsx .js .jsx .mjs
 * .cjs .yml .yaml (vendored a2ra components excluded). This file references the
 * banned glyph only via its codepoint, so it scans cleanly over itself.
 *
 * Usage:  node scripts/check-no-em-dash.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Node on Windows won't resolve `git` -> `git.exe` via execFile without a shell.
const GIT = process.platform === "win32" ? "git.exe" : "git";
const EM_DASH = String.fromCharCode(0x2014);

const GLOBS = ["*.md", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.yml", "*.yaml"];

function tracked() {
  const out = execFileSync(GIT, ["ls-files", "-z", ...GLOBS, ":!packages/ui/src/components/**"], {
    encoding: "utf8",
  });
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
