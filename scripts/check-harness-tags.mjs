#!/usr/bin/env node
// @ts-check
/**
 * The needles are assembled from fragments rather than written out, so this file and
 * its test scan cleanly over themselves and need no self-exclusion. Do not write one
 * out: a gate that exempts itself has a hole the shape of its own source.
 *
 * `plan/` is in scope because generated prose lands there first.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";
import { VENDORED_SOURCE_PATTERN } from "./vendored-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Extensions, because reading a binary as UTF-8 matches no needle anyway. */
const TEXT_FILES =
  /\.(md|markdown|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|sh|css|html|txt|sql|toml|Dockerfile)$|(^|\/)(Dockerfile|\.env[^/]*)$/i;

/** Vendored upstream code is kept byte for byte, so it cannot be asked to change. */
const EXCLUDED = VENDORED_SOURCE_PATTERN;

const LT = "<";
const CLOSE = `${LT}/`;

const TAG_NAMES = ["function_calls", "invoke", "parameter"];

/**
 * Assembled from `LT`/`CLOSE` so no literal appears in this source. An opening tag
 * needs the lookahead for the delimiter after the name, or ordinary markup such as
 * `<parameterised>` would fail the gate. `content` is banned in its closing form only,
 * being the one name that is also plausible markup. The namespace prefix is listed
 * alone because it is unambiguous without a tag name.
 */
export const HARNESS_TAG_PATTERNS = [
  ...TAG_NAMES.flatMap((name) => [
    new RegExp(`${LT}${name}(?=[\\s/>])`),
    new RegExp(`${CLOSE}${name}>`),
  ]),
  new RegExp(`${CLOSE}content>`),
  new RegExp(`${LT}antml:`),
  new RegExp(`${CLOSE}antml:`),
];

export function harnessTagsIn(text) {
  const found = [];
  text.split("\n").forEach((line, index) => {
    for (const pattern of HARNESS_TAG_PATTERNS) {
      const match = pattern.exec(line);
      if (match !== null) {
        found.push({ tag: match[0], line: index + 1, excerpt: line.trim().slice(0, 80) });
      }
    }
  });
  return found;
}

export function main() {
  const files = trackedFilesUnder(REPO_ROOT, { match: TEXT_FILES }).filter(
    (file) => !EXCLUDED.test(file),
  );

  const violations = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue; // deleted-but-staged, a symlink, a directory entry from a submodule
    }
    for (const { tag, line, excerpt } of harnessTagsIn(text)) {
      violations.push(`  ${file}:${String(line)}  ${tag}  ${excerpt}`);
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-harness-tags: OK - no tool-call tag literals in ${String(files.length)} tracked text files.`,
    );
    return 0;
  }

  console.error("check-harness-tags: AI tool-call tag literal(s) in committed text:\n");
  for (const violation of violations.slice(0, 50)) console.error(violation);
  if (violations.length > 50) console.error(`  ... and ${String(violations.length - 50)} more`);
  console.error(
    [
      "",
      "These are the tags an agent's own tool call is wrapped in. Leaking one into a",
      "written file is a generation artifact, not content: it renders as junk on GitHub",
      "and QCMS is public. Delete the tag and check the end of the file it came from -",
      "the leak is almost always the last line or two of a long generated document.",
      "",
    ].join("\n"),
  );
  return 1;
}

// Guarded so an importing test triggers neither the scan nor the `process.exit`.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
