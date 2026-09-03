#!/usr/bin/env node
// @ts-check
/**
 * Reject AI tool-call tag literals in committed text (issue #767).
 *
 * An agent writing a file emits its content inside tool-call tags. When the closing
 * tags leak into what was written, they land in the repository as literal markup: PRs
 * #758 and #762 committed a pair of them at the end of four deploy documents, where
 * they rendered as junk on GitHub and read as an unmistakable generation artifact in a
 * public repo. Every existing gate passed them - they are valid UTF-8, carry no control
 * character, contain no em dash, and Prettier reformats Markdown around them happily -
 * so the only thing standing between that class and `main` was whether a reviewer
 * scrolled to the end of a long generated file. Two of the four PRs in that batch
 * carried it.
 *
 * The needles are assembled from fragments rather than written out, so this file and
 * its test scan cleanly over themselves and need no self-exclusion. A gate that has to
 * exempt itself is a gate with a hole exactly the shape of its own source.
 *
 * Scope is every tracked text file, `plan/` included: the scratch area is where
 * generated prose lands first, so excluding it would exclude the likeliest source.
 * `check:plan` runs this gate for the same reason. Vendored upstream component sources
 * are excluded, as in the other gates: they are kept byte-for-byte and a demand to edit
 * them would be a demand the repository cannot meet.
 *
 * Usage:  node scripts/check-harness-tags.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";
import { VENDORED_SOURCE_PATTERN } from "./vendored-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Tracked text this gate reads. Extensions rather than a scan of everything, because
 * `git ls-files` also lists images, fonts and the Playwright fixtures, and reading a
 * binary as UTF-8 produces replacement characters that no needle can match anyway.
 */
const TEXT_FILES =
  /\.(md|markdown|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|sh|css|html|txt|sql|toml|Dockerfile)$|(^|\/)(Dockerfile|\.env[^/]*)$/i;

/**
 * Areas the other gates also skip: vendored upstream code kept byte-for-byte.
 *
 * The single definition in `scripts/vendored-source.mjs`, not a path typed here. This
 * used to exclude the whole of `packages/ui/src/components/`, four QCMS-owned subtrees
 * wider than the upstream copy (issue #775).
 */
const EXCLUDED = VENDORED_SOURCE_PATTERN;

const LT = "<";
const CLOSE = `${LT}/`;

/** The tag names a tool call is wrapped in. */
const TAG_NAMES = ["function_calls", "invoke", "parameter"];

/**
 * The banned shapes, assembled from `LT`/`CLOSE` so no literal appears in this source;
 * see the module comment for why that matters.
 *
 * An opening tag is matched without its closing bracket, since the leaks arrive with
 * an attribute list far more often than bare, but with a lookahead for the delimiter
 * that must follow the name: `<parameterised>` is ordinary markup and a gate that
 * failed on it would be switched off. A closing tag is matched whole.
 *
 * `content` is banned in its closing form only. It is the one name of the four that is
 * also a plausible element in real markup, and the closing tag is what leaked.
 *
 * The `antml:` namespace prefix is listed on its own because it is unambiguous without
 * a tag name: nothing else in this repository uses it, so a tag outside the three names
 * above is still caught.
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

/**
 * Every harness tag occurrence in `text`, with the line it sits on.
 *
 * @param {string} text
 * @returns {{ tag: string; line: number; excerpt: string }[]}
 */
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

/** Run the gate over the tracked tree. Returns the process exit code. */
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

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
