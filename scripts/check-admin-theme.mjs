#!/usr/bin/env node
// @ts-check
/**
 * A colour written outside the token sheet looks right in whichever mode the author had
 * open and is wrong in the other two. The landed sheet is compared byte for byte with
 * its design copy because a hand-edit keeps the published contrast table while losing
 * the property it certifies. The naming check reads catalog VALUES only, so code
 * identifiers (`apps/admin`, `qcms-admin`) stay untouched.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const LANDED_SHEET = "apps/admin/app/theme.css";
export const PLAN_SHEET = "plan/admin-theme/tokens.css";
export const CATALOG = "apps/admin/lib/i18n/en.ts";

const SCAN_DIRS = ["apps/admin/app", "apps/admin/components"];
const SCAN_EXTENSIONS = [".css", ".ts", ".tsx"];

/**
 * Bounded on both sides, and a digits-only run of three or four characters is excluded,
 * so an issue reference such as `#513` is not read as a three-digit colour.
 */
const HEX = /(?<![\w#&])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|(?!\d{3,4}\b)[0-9a-fA-F]{3,4})\b/g;

/** A call reaching a token carries no colour of its own, so it is allowed. */
const COLOUR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"];

const TAILWIND_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const TAILWIND_PREFIX =
  "bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|accent|caret|divide|shadow|placeholder";
const TAILWIND_COLOUR = new RegExp(
  `\\b(?:${TAILWIND_PREFIX})-(?:${TAILWIND_PALETTE})(?:-\\d{2,3})?\\b`,
  "g",
);

/** Newlines are preserved so reported line numbers still point at the source. */
export function stripComments(text, includeLineComments) {
  const blank = (match) => "\n".repeat((match.match(/\n/g) ?? []).length);
  const withoutBlocks = text.replaceAll(/\/\*[\s\S]*?\*\//g, blank);
  return includeLineComments
    ? withoutBlocks.replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1")
    : withoutBlocks;
}

function balanced(line, start) {
  let depth = 1;
  for (let i = start; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) return line.slice(start, i);
  }
  return line.slice(start);
}

export function literalColourFunctions(line) {
  const found = [];
  for (const name of COLOUR_FUNCTIONS) {
    let from = 0;
    for (;;) {
      const at = line.indexOf(`${name}(`, from);
      if (at === -1) break;
      from = at + name.length + 1;
      // Whole word only: `to-rgb(` and `--brand-hsl(` are not calls to these functions.
      const before = at === 0 ? "" : line[at - 1];
      if (before !== "" && /[\w-]/.test(before)) continue;
      const args = balanced(line, from);
      if (!args.includes("var(--")) found.push(`${name}(${args})`);
    }
  }
  return found;
}

export function findLiteralColours(text) {
  return text
    .split("\n")
    .flatMap((line, index) =>
      [
        ...(line.match(HEX) ?? []),
        ...(line.match(TAILWIND_COLOUR) ?? []),
        ...literalColourFunctions(line),
      ].map((hit) => ({ line: index + 1, hit })),
    );
}

/** A string is a key when the next non-space character after it is a colon. */
export function catalogValues(source) {
  const stripped = stripComments(source, true);
  const values = [];
  for (const match of stripped.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    if (/^\s*:/.test(stripped.slice(match.index + match[0].length))) continue;
    values.push({ text: match[1] ?? "", line: stripped.slice(0, match.index).split("\n").length });
  }
  return values;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(`${ROOT}${dir}`)) {
    const relative = `${dir}/${entry}`;
    if (statSync(`${ROOT}${relative}`).isDirectory()) out.push(...walk(relative));
    else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) out.push(relative);
  }
  return out;
}

export function checkAdminTheme() {
  const problems = [];

  for (const relative of SCAN_DIRS.flatMap(walk)) {
    if (relative === LANDED_SHEET) continue;
    const source = stripComments(
      readFileSync(`${ROOT}${relative}`, "utf8"),
      !relative.endsWith(".css"),
    );
    for (const { line, hit } of findLiteralColours(source)) {
      problems.push(
        `${relative}:${line}  literal colour "${hit}" - use a var(--...) token from ${LANDED_SHEET}`,
      );
    }
  }

  if (
    readFileSync(`${ROOT}${LANDED_SHEET}`, "utf8") !== readFileSync(`${ROOT}${PLAN_SHEET}`, "utf8")
  ) {
    problems.push(
      `${LANDED_SHEET} has drifted from ${PLAN_SHEET}. The sheet is generated with a ` +
        `WCAG contrast gate: change the design in plan/admin-theme/build.mjs, run ` +
        `\`node build.mjs\` there, and copy the result back.`,
    );
  }

  for (const { text, line } of catalogValues(readFileSync(`${ROOT}${CATALOG}`, "utf8"))) {
    if (/admin/i.test(text)) {
      problems.push(
        `${CATALOG}:${line}  user-facing string names this app "admin": ${JSON.stringify(text)}`,
      );
    }
  }

  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkAdminTheme();
  if (problems.length > 0) {
    console.error("QCMS app theme check failed:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('QCMS app theme: tokens-only, sheet in sync, no user-facing "admin".');
}
