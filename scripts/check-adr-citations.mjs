#!/usr/bin/env node
// @ts-check
/**
 * Every cited ADR resolves to a defined record (issue #734, rider from #180).
 *
 * ADR numbers are the repository's densest cross-reference: over fourteen hundred
 * citations across documents, comments, tests and commit-adjacent prose, each of them
 * an assertion that a decision by that number exists and says what the citing line
 * implies. Nothing checked that. A citation could name a number that was never
 * allocated, or one that a restructure dropped, and the only way to find out was to go
 * looking - which is the shape of #180, where the record itself had drifted from the
 * documents citing it.
 *
 * Since PR #720 the record lives in `docs/adr/` behind a stable index, so the check is
 * cheap: parse the index, scan the tree, and fail on a citation with no entry. The
 * reverse direction is reported rather than failed - a decision nobody cites is a
 * documentation observation, not a defect, and failing on it would make deleting the
 * last citation of a still-binding decision impossible.
 *
 * This is a resolution check, not a semantic one. It cannot tell whether a line citing
 * ADR-22 is describing ADR-22; it can only tell you that ADR-22 exists. That limit is
 * the reason to keep it cheap.
 *
 * Usage:  node scripts/check-adr-citations.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The index that defines the record. `docs/PROJECT_GOAL.md` §6 points here. */
const INDEX = "docs/adr/README.md";

/**
 * Tracked text a citation can plausibly be written in. The same set the other prose
 * gates read, minus the machine-readable formats: a number inside a JSON fixture is
 * data, not a citation.
 */
const TEXT_FILES = /\.(md|markdown|ts|tsx|mts|cts|js|jsx|mjs|cjs|ya?ml|sh|css|sql)$/i;

/**
 * Scratch and vendored areas, excluded for the reasons `scripts/check-ports.mjs` gives
 * for the same two: `plan/` is a working and history area whose older drafts may cite
 * numbering that a later decision superseded, and the vendored component sources are
 * upstream's, kept byte-for-byte.
 */
const EXCLUDED = [/^plan\//, /^packages\/ui\/src\/components\//];

/**
 * A citation: the prefix, a hyphen, one to three digits. Case-sensitive, because the
 * repository spells it one way.
 *
 * Written without an example, which is not fussiness: an example is a citation, and
 * the first run of this gate failed on its own doc comment. That is the gate working,
 * and the fix is to describe the shape rather than to exempt the file that defines it.
 */
const CITATION = /\bADR-(\d{1,3})\b/g;

/**
 * The ADR numbers the index defines, as written.
 *
 * Read from the index table's leading cell rather than from headings in the three
 * record documents: the index is the thing `docs/PROJECT_GOAL.md` sends a reader to,
 * so a decision missing from it is undiscoverable whatever its own document says.
 *
 * @param {string} indexText
 * @returns {Set<string>}
 */
export function definedAdrs(indexText) {
  const defined = new Set();
  for (const line of indexText.split("\n")) {
    // A table row: `| ADR-01 | Title | core |`. Anchored on the first cell so a number
    // mentioned in a title or in the prose above the table is not a definition.
    const match = /^\|\s*ADR-(\d{1,3})\s*\|/.exec(line);
    if (match?.[1] !== undefined) defined.add(normalize(match[1]));
  }
  return defined;
}

/**
 * `07` and `7` are the same decision. Compared as numbers so a zero-padding difference
 * between a citation and the index is not reported as a missing record.
 *
 * @param {string} digits
 * @returns {string}
 */
function normalize(digits) {
  return String(Number(digits));
}

/**
 * Every ADR citation in `text`, with the line it sits on.
 *
 * @param {string} text
 * @returns {{ adr: string; line: number }[]}
 */
export function citationsIn(text) {
  const found = [];
  text.split("\n").forEach((line, index) => {
    CITATION.lastIndex = 0;
    let match;
    while ((match = CITATION.exec(line)) !== null) {
      const digits = match[1];
      if (digits !== undefined) found.push({ adr: normalize(digits), line: index + 1 });
    }
  });
  return found;
}

/** Run the gate over the tracked tree. Returns the process exit code. */
export function main() {
  const indexText = readFileSync(join(REPO_ROOT, INDEX), "utf8");
  const defined = definedAdrs(indexText);
  if (defined.size === 0) {
    console.error(`check-adr-citations: ${INDEX} defines no ADR rows - has the index moved?`);
    return 1;
  }

  const files = trackedFilesUnder(REPO_ROOT, { match: TEXT_FILES }).filter(
    (file) => !EXCLUDED.some((pattern) => pattern.test(file)),
  );

  const unresolved = [];
  const cited = new Set();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const { adr, line } of citationsIn(text)) {
      cited.add(adr);
      if (!defined.has(adr)) unresolved.push(`  ${file}:${String(line)}  ADR-${adr}`);
    }
  }

  // Reported, never failed: see the module comment.
  const uncited = [...defined]
    .filter((adr) => !cited.has(adr))
    .sort((a, b) => Number(a) - Number(b));

  if (unresolved.length > 0) {
    console.error(`check-adr-citations: citation(s) with no record in ${INDEX}:\n`);
    for (const line of unresolved.slice(0, 50)) console.error(line);
    if (unresolved.length > 50) console.error(`  ... and ${String(unresolved.length - 50)} more`);
    console.error(
      [
        "",
        `Either the number is wrong, or the decision exists and is missing from the index.`,
        `Decisions are recorded in docs/adr/{core,portal,admin}.md and indexed in ${INDEX};`,
        "adding one means a row in that table, which is what makes it findable at all.",
        "",
      ].join("\n"),
    );
    return 1;
  }

  console.log(
    `check-adr-citations: OK - every ADR cited across ${String(files.length)} tracked files ` +
      `resolves to one of ${String(defined.size)} records in ${INDEX}.`,
  );
  if (uncited.length > 0) {
    console.log(
      `check-adr-citations: note - defined but never cited: ${uncited.map((adr) => `ADR-${adr}`).join(", ")}`,
    );
  }
  return 0;
}

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
