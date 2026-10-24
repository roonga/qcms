#!/usr/bin/env node
// @ts-check
/**
 * Allowed: tab, line feed, carriage return. Everything else below 0x20, plus DEL, is
 * rejected: a control character in source renders the file as binary in a diff, so it
 * passes every other gate and cannot be reviewed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Node's execFile on Windows does not resolve `git` to `git.exe` the way a shell does.
const GIT = process.platform === "win32" ? "git.exe" : "git";

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mjs", "*.mts", "*.js", "*.jsx", "*.json", "*.md"];
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
// eslint-disable-next-line no-control-regex
const DISALLOWED = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function tracked() {
  const out = execFileSync(GIT, ["ls-files", "-z", ...SOURCE_GLOBS], { encoding: "utf8" });
  return out.split("\0").filter((p) => p !== "");
}

const violations = [];
for (const file of tracked()) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted-but-staged, symlink, etc.
  }
  const text = buf.toString("latin1");
  if (!DISALLOWED.test(text)) continue;
  for (let i = 0; i < buf.length; i++) {
    const code = buf[i];
    if ((code <= 0x1f && !ALLOWED.has(code)) || code === 0x7f) {
      const line = text.slice(0, i).split("\n").length;
      violations.push(`${file}:${line}  control char 0x${code.toString(16).padStart(2, "0")}`);
      break; // one report per file is enough to fail and locate it
    }
  }
}

if (violations.length > 0) {
  console.error("check-no-control-chars: disallowed control character(s) in tracked source:\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nControl chars (except tab/LF/CR) make diffs unreviewable and are almost always");
  console.error("an accident (a NUL delimiter, a paste artifact). Remove them.");
  process.exit(1);
}

console.log("check-no-control-chars: OK - no disallowed control characters in tracked source.");
