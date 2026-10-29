#!/usr/bin/env node
// @ts-check
/**
 * A resolution check, not a semantic one: it can only say that a cited decision exists.
 * The reverse direction is reported rather than failed, because failing on an uncited
 * decision would make deleting the last citation of a binding one impossible.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";
import { VENDORED_SOURCE_PATTERN } from "./vendored-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const INDEX = "docs/adr/README.md";

/** Machine-readable formats are out: a number inside a fixture is data, not a citation. */
const TEXT_FILES = /\.(md|markdown|ts|tsx|mts|cts|js|jsx|mjs|cjs|ya?ml|sh|css|sql)$/i;

/**
 * `plan/` drafts may cite numbering a later decision superseded, and the vendored
 * sources are upstream's, kept byte for byte.
 */
const EXCLUDED = [/^plan\//, VENDORED_SOURCE_PATTERN];

/**
 * Do not add an example here: an example is itself a citation, and this gate reads its
 * own source, so the first version of this comment failed the gate.
 */
const CITATION = /\bADR-(\d{1,3})\b/g;

/**
 * Read from the index rather than from the record documents' own headings: a decision
 * missing from the index is undiscoverable whatever its document says.
 *
 * @param {string} indexText
 * @returns {Set<string>}
 */
export function definedAdrs(indexText) {
  const defined = new Set();
  for (const line of indexText.split("\n")) {
    // Anchored on the row's first cell, so a number in a title or in prose is not a
    // definition.
    const match = /^\|\s*ADR-(\d{1,3})\s*\|/.exec(line);
    if (match?.[1] !== undefined) defined.add(normalize(match[1]));
  }
  return defined;
}

/**
 * `07` and `7` are the same decision, so zero padding must not read as missing.
 *
 * @param {string} digits
 * @returns {string}
 */
function normalize(digits) {
  return String(Number(digits));
}

/**
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

// Guarded so an importing test triggers neither the scan nor the `process.exit`.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
